/* Metronome: Web Audio look-ahead scheduling (sample-accurate), accent on beat 1, optional subdivision clicks,
   4 synthesized sounds (click / cowbell / woodblock / beep), volume + "loud" mode through a limiter,
   count-in bar with a distinct sound, optional gap mode (X bars click / Y bars silent – the clock keeps running). Falls back to a silent visual clock when Web Audio is unavailable. */
(function(){
"use strict";
var RT = window.RT;

var LOOKAHEAD = 0.12, TICK_MS = 25;
var m = RT.metro = {
  bpm: 80, sub: 1, meter: 4, running: false,
  ctx: null, next: 0, tick: 0, timer: null, queue: [], countLeft: 0, gen: 0, bar: -1, gapOn: false,
  gap: {on:false, play:3, mute:1},
  beatFns: [], log: []
};
function normGap(g){
  g = RT.isObj(g) ? g : {};
  function n(v,d){ v=Math.round(+v); return v>=1 && v<=16 ? v : d; }
  return {on:g.on===true, play:n(g.play,3), mute:n(g.mute,1)};
}
(function(){ var s=RT.readJSON(RT.KEYS.metro,{}); if(s && s.bpm) m.bpm=RT.clampBpm(s.bpm); m.gap=normGap(s && s.gap); })();
function saveMetro(){ RT.writeJSON(RT.KEYS.metro, {bpm:m.bpm, gap:m.gap}); }
// pure: is bar n (0 = first bar after the count-in) silent under gap setting g?
RT.gapSilent = function(n, g){ return !!(g && g.on) && n >= 0 && (n % (g.play + g.mute)) >= g.play; };

function ensureAudio(){
  var AC = window.AudioContext || window.webkitAudioContext;
  if(!AC) return null;
  try{
    if(!m.ctx) m.ctx = new AC();
    if(m.ctx.state === "suspended") m.ctx.resume();
  }catch(e){ m.ctx = null; }
  return m.ctx;
}
RT.ensureAudio = ensureAudio;
// audio clock when audio runs, wall clock otherwise (keeps visuals going on devices without Web Audio)
var t0 = Date.now();
function now(){ return (m.ctx && m.ctx.state === "running") ? m.ctx.currentTime : (Date.now()-t0)/1000; }

/* ---------- metronome voices (all synthesized, no audio files) ----------
   level: 3 count-in, 2 accent (beat 1), 1 beat, 0 subdivision. Every sound is higher + louder on the accent.
   Output chain per context: voices → volume gain → DynamicsCompressor as a brick-wall limiter → destination,
   so "loud" mode (drum kit + earbuds) can push the level hard without clipping. */
var PITCH = [0.8, 1, 1.5, 1.26], LEVEL = [0.35, 0.75, 1, 0.85];
var LOUD_GAIN = 3.2;
function noiseBuf(c){
  if(c.__rtNoise) return c.__rtNoise;
  var b = c.createBuffer(1, Math.round(c.sampleRate*0.25), c.sampleRate), d = b.getChannelData(0);
  for(var i=0;i<d.length;i++) d[i] = Math.random()*2-1;
  return (c.__rtNoise = b);
}
// percussive envelope on a fresh gain node: near-instant attack, exponential decay
function env(c, dest, time, peak, decay){
  var g = c.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time+0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, time+decay);
  g.connect(dest); return g;
}
function osc(c, dest, type, freq, time, dur){
  var o = c.createOscillator(); o.type = type; o.frequency.value = freq;
  o.connect(dest); o.start(time); o.stop(time+dur+0.02); return o;
}
function noise(c, dest, time, dur, type, freq, q){
  var n = c.createBufferSource(), f = c.createBiquadFilter();
  n.buffer = noiseBuf(c); f.type = type; f.frequency.value = freq; if(q) f.Q.value = q;
  n.connect(f); f.connect(dest); n.start(time); n.stop(time+dur+0.02); return n;
}
function voice(c, dest, time, level, sound, loud){
  var p = PITCH[level], a = LEVEL[level], k = loud ? 1 : 0, d;
  if(sound === "beep"){ // the original v2 sound: sine beats, square accent, triangle count-in
    var type = level===2 ? "square" : (level===3 ? "triangle" : (k ? "triangle" : "sine"));
    var f = level===3 ? 2200 : level===2 ? 1760 : (level===1 ? 1100 : 820);
    var peak = level===3 ? 0.45 : level===2 ? 0.5 : (level===1 ? 0.38 : 0.16);
    d = level>=2 ? 0.06 : 0.04;
    osc(c, env(c, dest, time, peak*(k?1.6:1), d), type, f, time, d);
    if(k) osc(c, env(c, dest, time, peak*0.5, d*0.7), "square", f*2, time, d);
  } else if(sound === "cowbell"){ // 808-style: two detuned squares through a band-pass
    d = (level===0 ? 0.08 : 0.16) + k*0.06;
    var bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2400*p; bp.Q.value = 1.2;
    bp.connect(env(c, dest, time, a*(0.7+k*0.5), d));
    osc(c, bp, "square", 560*p, time, d); osc(c, bp, "square", 845*p, time, d);
    if(k) noise(c, env(c, dest, time, a*0.5, 0.012), time, 0.012, "highpass", 3000);
  } else if(sound === "woodblock"){ // pitched knock with a fast downward pitch blip + tiny noise attack
    d = (level===0 ? 0.035 : 0.06) + k*0.02;
    var g = env(c, dest, time, a*(0.85+k*0.4), d), o = osc(c, g, k ? "triangle" : "sine", 1100*p, time, d);
    o.frequency.setValueAtTime(1600*p, time); o.frequency.exponentialRampToValueAtTime(1050*p, time+0.012);
    noise(c, env(c, dest, time, a*(0.35+k*0.4), 0.008), time, 0.01, "bandpass", 2500*p, 1.5);
    if(k) osc(c, env(c, dest, time, a*0.35, d*0.6), "sine", 2750*p, time, d);
  } else { // "click" (default): sharp metallic tick – inharmonic squares (hi-hat style) + high noise transient
    d = (level===0 ? 0.02 : 0.035) + k*0.02;
    var hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2500*p;
    var rs = [1, 1.342, 1.787, 2.405].concat(k ? [3.1, 4.07] : []);
    hp.connect(env(c, dest, time, a*(0.9+k*0.6)/rs.length*1.6, d));
    rs.forEach(function(r){ osc(c, hp, "square", 1250*p*r, time, d); });
    noise(c, env(c, dest, time, a*(0.35+k*0.35), 0.006+k*0.006), time, 0.015, "highpass", 4000*p);
    if(k) osc(c, env(c, dest, time, a*0.7, 0.03), "triangle", 1000*p, time, 0.03); // body so it cuts through cymbals
  }
}
// gain stage for the volume slider (perceptual curve) and limiter settings for the current mode
function outGain(vol, loud){ var v = Math.max(0, Math.min(100, +vol||0))/100; return v*v*(loud ? LOUD_GAIN : 1); }
// safety net after the compressor: linear up to 0.8, then a smooth knee that never passes 0.98
// (the compressor alone lets the first milliseconds of a sharp transient overshoot)
var SAFE_CURVE = (function(){
  var n = 2049, cv = new Float32Array(n);
  for(var i=0;i<n;i++){ var x = (i/(n-1)*2-1)*2, ax = Math.abs(x); // shaper input is pre-scaled by 0.5 → covers ±2
    cv[i] = (x<0?-1:1) * (ax <= 0.8 ? ax : 0.8 + 0.18*Math.tanh((ax-0.8)/0.18)); }
  return cv;
})();
function makeOut(c){
  var vol = c.createGain(), lim = c.createDynamicsCompressor(), post = c.createGain(), safe = c.createWaveShaper();
  lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
  safe.curve = SAFE_CURVE;
  vol.connect(lim); lim.connect(post); post.connect(safe); safe.connect(c.destination);
  return {vol:vol, lim:lim, post:post, safe:safe};
}
function setOut(o, s, c){
  var t = c.currentTime, g = outGain(s.metroVolume, s.metroLoud);
  o.vol.gain.cancelScheduledValues(t); o.vol.gain.setValueAtTime(g, t);
  o.lim.threshold.value = s.metroLoud ? -10 : -4; // loud: squeeze harder (the compressor adds its own make-up gain)
  o.post.gain.value = 0.5 * (s.metroLoud ? 0.8 : 0.9); // 0.5 = pre-scale for the safety curve
}
// exposed for tests (render offline) and the settings preview
RT.metroAudio = {voice:voice, makeOut:makeOut, setOut:setOut, outGain:outGain};
function out(c){
  if(!m.out || m.out.ctx !== c){ m.out = makeOut(c); m.out.ctx = c; setOut(m.out, RT.settings, c); }
  return m.out;
}
m.applySound = function(){ var c = m.ctx; if(c) setOut(out(c), RT.settings, c); };
function click(time, level){
  var c = m.ctx; if(!c || c.state !== "running") return;
  var s = RT.settings, o = out(c);
  try{ voice(c, o.vol, time, level, s.metroSound, s.metroLoud === true); }catch(e){ console.error(e); }
}
/* short sample bar for the settings screen: accent + 3 beats in the chosen sound */
m.preview = function(){
  m.log.push({ev:"preview", sound:RT.settings.metroSound});
  var c = ensureAudio(); if(!c || m.running) return;
  var go = function(){ if(c.state !== "running") return; m.applySound(); var t = c.currentTime+0.05, b = 60/Math.max(60, m.bpm);
    for(var i=0;i<4;i++) click(t+i*b, i===0 ? 2 : 1); };
  if(c.state === "running") go(); else if(c.resume) c.resume().then(go, function(){});
};

function scheduler(){
  var t = now();
  if(m.next < t - 0.25) m.next = t + 0.02; // fell behind (tab was asleep) → resync instead of a burst
  while(m.next < t + LOOKAHEAD){
    var counting = m.countLeft > 0;
    var sub = counting ? 1 : m.sub;
    var perBar = m.meter * sub, k = m.tick % perBar;
    var isBeat = k % sub === 0, beatIdx = Math.floor(k / sub);
    var subOn = RT.settings.subClicks !== false;
    if(!counting && k===0) m.bar++;
    var silent = !counting && m.gapOn && RT.gapSilent(m.bar, m.gap);
    if(silent){ /* scheduled silence: keep time, no click */ }
    else if(counting) click(m.next, 3);
    else if(isBeat) click(m.next, k===0 ? 2 : 1);
    else if(subOn) click(m.next, 0);
    if(isBeat) m.queue.push({time:m.next, beat:beatIdx, count:counting, silent:silent});
    m.next += 60 / m.bpm / sub;
    m.tick++;
    if(counting){ m.countLeft--; if(m.countLeft === 0) m.tick = 0; }
  }
}
function draw(){
  if(!m.running) return;
  var t = now(), cur = null;
  while(m.queue.length && m.queue[0].time <= t){ cur = m.queue.shift(); }
  if(cur) m.beatFns.forEach(function(fn){ fn(cur.beat, cur.count, cur.silent); });
  requestAnimationFrame(draw);
}

/* start({countIn:n, onReady:fn, gap:bool}) – onReady fires when the count-in bar is over (first real downbeat);
   gap:true applies the saved gap setting (practice routine only, never the measurement) */
m.start = function(opts){
  opts = opts || {};
  ensureAudio();
  if(m.running) m.stop(true);
  m.running = true; m.tick = 0; m.queue = []; m.gen++; m.bar = -1; m.gapOn = !!opts.gap;
  m.countLeft = opts.countIn || 0;
  m.next = now() + 0.06;
  m.timer = setInterval(scheduler, TICK_MS); scheduler();
  requestAnimationFrame(draw);
  var gen = m.gen;
  if(opts.onReady){
    var ms = (m.countLeft * 60000 / m.bpm) + 60;
    setTimeout(function(){ if(m.running && m.gen === gen) opts.onReady(); }, ms);
  }
  m.log.push({ev:"start", bpm:m.bpm, countIn:opts.countIn||0});
  emitState();
};
m.stop = function(quiet){
  if(!m.running) return;
  m.running = false; clearInterval(m.timer); m.timer = null; m.queue = []; m.gen++;
  m.beatFns.forEach(function(fn){ fn(-1, false, false); });
  if(!quiet) m.log.push({ev:"stop"});
  emitState();
};
m.setBpm = function(v){
  m.bpm = RT.clampBpm(v);
  saveMetro();
  emitState();
  return m.bpm;
};
m.setSub = function(v){ v=+v; if([1,2,3,4].indexOf(v)<0) v=1; if(m.sub!==v){ m.sub=v; if(m.countLeft===0) m.tick=0; } };
m.setGap = function(g){ m.gap = normGap(Object.assign({}, m.gap, g)); saveMetro(); emitState(); return m.gap; };
m.onBeat = function(fn){ m.beatFns.push(fn); };
var stateFns = [];
m.onState = function(fn){ stateFns.push(fn); };
function emitState(){ stateFns.forEach(function(fn){ fn(); }); }

/* soft bell chimes: "end" (step over), "done" (routine over), "mark" (measurement button) */
RT.chime = function(kind){
  m.log.push({ev:"chime", kind:kind});
  var c = ensureAudio(); if(!c || c.state !== "running") return;
  var notes = kind==="done" ? [784,988,1175,1568] : kind==="mark" ? [1319] : [1319,988];
  var gap = kind==="done" ? 0.16 : 0.2, s0 = c.currentTime+0.03;
  var out = c.createGain(); out.gain.value = 0.9; out.connect(c.destination);
  notes.forEach(function(f,i){
    var t = s0 + i*gap;
    [[1,0.2],[2.01,0.05],[3.0,0.02]].forEach(function(h){
      var o=c.createOscillator(), g=c.createGain();
      o.type="sine"; o.frequency.value=f*h[0];
      g.gain.setValueAtTime(0.0001,t);
      g.gain.exponentialRampToValueAtTime(h[1],t+0.015);
      g.gain.exponentialRampToValueAtTime(0.0001,t+(kind==="done"&&i===notes.length-1?2.0:1.1));
      o.connect(g); g.connect(out); o.start(t); o.stop(t+2.2);
    });
  });
};

/* Screen Wake Lock with fallback (muted looping canvas-stream video keeps many tablets awake) */
var wake = {sentinel:null, video:null, want:false, mode:"none"};
RT.wake = wake;
function fallbackOn(){
  try{
    if(!wake.video){
      var cv=document.createElement("canvas"); cv.width=cv.height=2;
      var g=cv.getContext("2d"), v=document.createElement("video");
      v.muted=true; v.setAttribute("playsinline",""); v.loop=true;
      v.style.cssText="position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;left:0";
      if(cv.captureStream){ v.srcObject=cv.captureStream(1); setInterval(function(){ if(wake.want){ g.fillStyle=Math.random()<.5?"#000":"#111"; g.fillRect(0,0,2,2);} },1000); }
      document.body.appendChild(v); wake.video=v;
    }
    var p=wake.video.play(); if(p&&p.catch) p.catch(function(){});
    wake.mode="fallback";
  }catch(e){ wake.mode="none"; }
}
RT.keepAwake = function(on){
  wake.want = !!on;
  if(on){
    if(navigator.wakeLock && navigator.wakeLock.request){
      if(wake.sentinel) return;
      navigator.wakeLock.request("screen").then(function(s){
        wake.sentinel=s; wake.mode="wakelock";
        s.addEventListener("release",function(){ wake.sentinel=null; });
      }).catch(fallbackOn);
    } else fallbackOn();
  } else {
    if(wake.sentinel){ try{ wake.sentinel.release(); }catch(e){} wake.sentinel=null; }
    if(wake.video){ try{ wake.video.pause(); }catch(e){} }
    wake.mode="none";
  }
};
document.addEventListener("visibilitychange",function(){ if(!document.hidden && wake.want && !wake.sentinel) RT.keepAwake(true); });
})();
