/* Metronome: Web Audio look-ahead scheduling (sample-accurate), accent on beat 1, optional subdivision clicks,
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

function click(time, level){ // level: 3 count-in, 2 accent, 1 beat, 0 subdivision
  var c = m.ctx; if(!c || c.state !== "running") return;
  var o = c.createOscillator(), g = c.createGain();
  o.type = level===2 ? "square" : (level===3 ? "triangle" : "sine");
  o.frequency.value = level===3 ? 2200 : level===2 ? 1760 : (level===1 ? 1100 : 820);
  var peak = level===3 ? 0.45 : level===2 ? 0.5 : (level===1 ? 0.38 : 0.16);
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(peak, time+0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, time+(level>=2?0.06:0.04));
  o.connect(g); g.connect(c.destination); o.start(time); o.stop(time+0.08);
}

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
