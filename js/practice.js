/* Practice engine (auto-advancing routine with ratings) + guided weekly measurement.
   Timing uses Date.now() checks on a 200ms tick so it survives background tabs and is testable with a fake clock. */
(function(){
"use strict";
var RT = window.RT, metro = RT.metro, esc = RT.esc;

/* ---------- shared UI helpers ---------- */
var toastT;
RT.toast = function(msg){
  var t=document.getElementById("toast"); if(!t) return;
  t.textContent=msg; t.classList.add("show");
  clearTimeout(toastT); toastT=setTimeout(function(){ t.classList.remove("show"); },2600);
};
RT.stickHTML = function(s, bare){
  if(!s) return "";
  var h="", str=String(s.stick||"").trim();
  if(str){
    h+='<span class="stk" dir="ltr">';
    str.split(/\s+/).forEach(function(g){
      if(g==="…"||g==="..."){ h+='<b class="more">…</b>'; return; }
      if(!/^[RLrlz>]+$/.test(g)){ h+='<b class="txt">'+esc(g)+'</b>'; return; }
      var inner="", acc=false;
      for(var i=0;i<g.length;i++){
        var ch=g[i];
        if(ch===">"){ acc=true; continue; }
        if(ch==="z"){ inner+='<i class="bz">z</i>'; continue; }
        var main=ch==="R"||ch==="L";
        inner+='<i class="'+ch.toUpperCase()+(main?"":" g")+(acc?" acc":"")+'">'+ch.toUpperCase()+'</i>';
        acc=false;
      }
      h+='<b>'+inner+'</b>';
    });
    h+='</span>';
  }
  if(s.hint && !bare) h+='<span class="hint">'+esc(s.hint)+'</span>';
  return h;
};
var PLAY_SVG='<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/>';
var PAUSE_SVG='<rect x="6" y="5" width="4.2" height="14" rx="1.4"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.4"/>';
var MIN=60000;

function today(){ return RT.ymd(new Date()); }
function R(){ return RT.routine(); }
function stepMs(i){ return Math.round(R()[i].min*MIN); }

/* ======================= practice routine ======================= */
var P = RT.P = {phase:"idle", idx:0, paused:false, endAt:0, left:0, restEnd:0, restLeft:0, restIdx:-1,
  results:{}, done:[], skipped:[], count:0};

function reset(){ P.phase="idle"; P.paused=false; P.results={}; P.done=[]; P.skipped=[]; P.restIdx=-1; P.partialMs=0; }

function startCount(){
  var s=R()[P.idx];
  P.phase="countin"; P.paused=false; P.count=RT.settings.countIn||4;
  metro.setBpm(s.bpm); metro.setSub(s.sub);
  metro.start({countIn:RT.settings.countIn||4, onReady:beginPlay});
  RT.keepAwake(true);
  render();
}
function goStep(i){
  if(i<0||i>=R().length) return;
  P.idx=i; P.left=stepMs(i);
  startCount(); renderSteps();
}
function beginPlay(){ P.phase="play"; P.endAt=Date.now()+P.left; render(); }
function start(from){
  reset(); RT.ensureAudio();
  goStep(Math.max(0,Math.min(R().length-1, from||0)));
}
function endStep(){
  metro.stop();
  var i=P.idx, s=R()[i];
  if(P.done.indexOf(i)<0) P.done.push(i);
  P.results[i]=P.results[i]||{}; P.results[i].bpm=s.bpm;
  RT.chime("end");
  P.restIdx=i; P.phase="rest"; P.paused=false; P.restEnd=Date.now()+(RT.settings.restSec||15)*1000;
  render(); renderSteps();
}
// unrated finished steps still get their working tempo logged (never a max)
function finalizeRest(){
  var i=P.restIdx; if(i<0) return;
  var res=P.results[i], link=RT.stepLink(i);
  if(res && !res.entry && link) res.entry=RT.logWork(link,res.bpm,null,"מהשגרה: "+R()[i].title);
}
function afterRest(){
  finalizeRest();
  var n=P.restIdx+1;
  if(n<R().length) goStep(n); else finish();
}
function rate(r){
  if(P.phase!=="rest" || !RT.RATINGS[r]) return false;
  var i=P.restIdx, res=P.results[i]=P.results[i]||{bpm:R()[i].bpm}, link=RT.stepLink(i);
  res.rating=r;
  if(link){
    if(res.entry){ res.entry.rating=r; RT.updateEntry(link,res.entry); }
    else res.entry=RT.logWork(link,res.bpm,r,"מהשגרה: "+R()[i].title);
    RT.toast("נרשם: "+RT.fullName(link)+" · "+res.bpm+" BPM‏ · "+RT.RATINGS[r]+" (טמפו עבודה)");
  } else RT.toast("הדירוג נשמר בסשן (השלב לא מקושר לתרגיל)");
  render(); renderSteps();
  return true;
}
// +4 BPM suggestion after a clean streak: one tap raises the rated step's target, or dismisses it for this BPM
function raise(accept){
  if(P.phase!=="rest") return false;
  var i=P.restIdx, sg=RT.raiseSuggestion(i); if(!sg) return false;
  if(accept){ RT.setStepBpm(i,sg.to); RT.toast("היעד עודכן: "+R()[i].title+" · "+sg.from+" ← "+sg.to+" BPM"); }
  else RT.dismissRaise(sg.link,sg.from);
  render(); renderSteps();
  return true;
}
function togglePause(){
  if(P.phase==="idle" || P.phase==="done"){ start(P.phase==="done"?0:P.idx); return; }
  if(!P.paused){
    if(P.phase==="play"){ P.left=Math.max(0,P.endAt-Date.now()); }
    if(P.phase==="rest"){ P.restLeft=Math.max(0,P.restEnd-Date.now()); }
    metro.stop(); P.paused=true;
  } else {
    if(P.phase==="rest"){ P.paused=false; P.restEnd=Date.now()+P.restLeft; }
    else startCount();
  }
  render();
}
function next(){
  if(P.phase==="idle"){ P.idx=Math.min(R().length-1,P.idx+1); render(); renderSteps(); return; }
  if(P.phase==="done") return;
  if(P.phase==="rest"){ afterRest(); return; }
  var i=P.idx; if(P.skipped.indexOf(i)<0 && P.done.indexOf(i)<0) P.skipped.push(i);
  P.partialMs=(P.partialMs||0)+played();
  metro.stop();
  if(i+1<R().length) goStep(i+1); else finish();
}
function prev(){
  if(P.phase==="idle"){ P.idx=Math.max(0,P.idx-1); render(); renderSteps(); return; }
  if(P.phase==="done") return;
  if(P.phase==="rest"){ finalizeRest(); goStep(P.restIdx); return; }
  P.partialMs=(P.partialMs||0)+played();
  metro.stop(); goStep(Math.max(0,P.idx-1));
}
function played(){
  if(P.phase!=="play") return 0;
  var left=P.paused?P.left:Math.max(0,P.endAt-Date.now());
  return Math.max(0,stepMs(P.idx)-left);
}
function stepLine(i){
  var s=R()[i], r=P.results[i]; return (i+1)+". "+s.title+" @ "+((r&&r.bpm)||s.bpm)+" BPM ("+RT.subName(s.sub)+")"+(r&&r.rating?" – "+RT.RATINGS[r.rating]:"");
}
function markToday(){
  var key=today(), arr=Array.isArray(RT.plan.steps[key])?RT.plan.steps[key]:[];
  P.done.forEach(function(i){ if(arr.indexOf(i)<0) arr.push(i); });
  arr.sort(function(a,b){return a-b;}); RT.plan.steps[key]=arr;
  var full=R().every(function(_,i){ return arr.indexOf(i)>=0; }), newDay=full && !RT.plan.days[key];
  if(newDay) RT.plan.days[key]=1;
  RT.savePlan();
  return {full:full,newDay:newDay};
}
function finish(){
  metro.stop(); RT.keepAwake(false);
  var m=markToday();
  var mins=P.done.reduce(function(a,i){ return a+R()[i].min; },0)+(P.partialMs||0)/MIN;
  RT.logSession(P.skipped.length?"שגרה חלקית":"שגרה מלאה", mins, P.done.map(stepLine).join(" | "),
    P.skipped.length?"דולגו: "+P.skipped.map(function(i){ return R()[i].title; }).join(", "):"");
  P.phase="done"; P.paused=false; P.fullDay=m.full; P.newDay=m.newDay;
  RT.chime("done");
  RT.toast(m.full ? "השגרה הושלמה!"+(m.newDay?" היום סומן כיום תרגול ✓":" ✓") : "השגרה הסתיימה – שלבים שדולגו לא סומנו");
  render(); renderSteps();
}
function stop(){
  if(P.phase==="idle"||P.phase==="done"){ reset(); render(); renderSteps(); return; }
  if(P.phase==="rest") finalizeRest();
  var partial=(P.partialMs||0)+played();
  metro.stop(); RT.keepAwake(false);
  var mins=P.done.reduce(function(a,i){ return a+R()[i].min; },0)+partial/MIN;
  if(P.done.length) markToday();
  if(mins>=1) RT.logSession("שגרה – נעצרה באמצע", mins, P.done.map(stepLine).join(" | "), "");
  var idx=P.idx; reset(); P.idx=idx;
  RT.toast("השגרה נעצרה"); render(); renderSteps();
}
// the step tempo arrows change – the step the BPM display refers to
function targetIdx(){ return P.phase==="rest" ? Math.min(R().length-1,P.restIdx+1) : P.idx; }
function adjust(d){
  var t=targetIdx(), s=R()[t]; if(!s) return;
  RT.setStepBpm(t, s.bpm+d);
  if((P.phase==="play"||P.phase==="countin") && t===P.idx && !P.paused) metro.setBpm(R()[t].bpm);
  render(); renderSteps();
}
function tick(){
  if(!P.paused){
    var now=Date.now();
    if(P.phase==="play" && now>=P.endAt) endStep();
    else if(P.phase==="rest" && now>=P.restEnd) afterRest();
  }
  if(M.phase==="run" && !M.paused && Date.now()>=M.levelEnd) levelUp();
  renderTick();
}
setInterval(tick,200);
document.addEventListener("visibilitychange",function(){ if(!document.hidden) tick(); });

/* ---------- render (stage + focus overlay share data-p bindings) ---------- */
function setP(key, val, html){
  document.querySelectorAll('[data-p="'+key+'"]').forEach(function(n){ if(html) n.innerHTML=val; else n.textContent=val; });
}
var PHASES={idle:"מוכן להתחיל", countin:"ספירה", play:"מתרגלים", rest:"מנוחה ודירוג", done:"השגרה הושלמה"};
function curLeft(){
  if(P.phase==="play") return P.paused?P.left:Math.max(0,P.endAt-Date.now());
  if(P.phase==="countin") return P.left;
  if(P.phase==="idle") return stepMs(P.idx);
  return 0;
}
function render(){
  var steps=R(), t=targetIdx(), s=steps[t]||steps[0], link=RT.stepLink(t);
  var stage=document.getElementById("stage"); if(!stage) return;
  stage.dataset.phase=P.phase; stage.classList.toggle("paused",P.paused);
  var fo=document.getElementById("focus"); if(fo){ fo.dataset.phase=P.phase; fo.classList.toggle("paused",P.paused); }
  setP("stepn", P.phase==="done" ? "סיום" : "שלב "+(t+1)+"/"+steps.length);
  setP("name", P.phase==="done" ? "כל הכבוד!" : s.title);
  setP("desc", P.phase==="done" ? "" : s.desc);
  setP("stick", link ? RT.stickHTML(RT.SUB[link]) : "", true);
  setP("bpm", s.bpm);
  setP("sub", RT.subName(s.sub));
  setP("playicon", (P.phase==="idle"||P.phase==="done"||P.paused) ? PLAY_SVG : PAUSE_SVG, true);
  var rest=P.phase==="rest";
  document.getElementById("restPanel").hidden=!rest;
  document.querySelectorAll('#focus [data-show="rest"]').forEach(function(n){ n.hidden=!rest; });
  if(rest){
    var done=steps[P.restIdx], nx=steps[P.restIdx+1], r=(P.results[P.restIdx]||{}).rating;
    setP("restname", done.title);
    setP("nextname", nx ? nx.title : "סיום השגרה 🎉");
    setP("nextmeta", nx ? "· "+nx.bpm+" BPM‏ · "+nx.min+" דק'" : "");
    document.querySelectorAll("[data-rate]").forEach(function(b){ b.classList.toggle("on", b.dataset.rate===r); b.setAttribute("aria-pressed",String(b.dataset.rate===r)); });
  }
  var sg=rest ? RT.raiseSuggestion(P.restIdx) : null;
  document.querySelectorAll("[data-raise-box]").forEach(function(n){ n.hidden=!sg; });
  if(sg){
    setP("raisetxt", RT.RAISE_AFTER+" פעמים ברצף נקי ב-"+sg.from+" BPM. להעלות את היעד?");
    setP("raiseto", "העלה ל-"+sg.to);
  }
  var dp=document.getElementById("donePanel");
  dp.hidden=P.phase!=="done";
  if(P.phase==="done"){
    dp.innerHTML='<ul class="done-list">'+steps.map(function(st,i){
      var r=P.results[i], sk=P.skipped.indexOf(i)>=0 && P.done.indexOf(i)<0;
      return '<li><span>'+esc(st.title)+'</span><span class="muted">'+(r&&r.bpm?r.bpm+" BPM‏":"")+'</span>'+
        (sk?'<span class="badge">דולג</span>':r&&r.rating?'<span class="badge rt-'+r.rating+'">'+RT.RATINGS[r.rating]+'</span>':'<span class="badge">ללא דירוג</span>')+'</li>';
    }).join("")+'</ul><div class="row gap center"><button type="button" class="btn primary" data-act="again">שגרה נוספת</button><a class="btn" href="#progress">להתקדמות</a></div>';
    dp.querySelector('[data-act="again"]').addEventListener("click",function(){ reset(); P.idx=0; render(); renderSteps(); });
  }
  renderTick();
}
function renderTick(){
  if(document.getElementById("stage")){
    var steps=R(), ph=P.phase, left, frac=0, txt;
    if(ph==="rest"){ left=P.paused?P.restLeft:Math.max(0,P.restEnd-Date.now()); setP("restleft", Math.ceil(left/1000)+" שנ'"); frac=1-left/((RT.settings.restSec||15)*1000); txt="מנוחה "+RT.fmtMS(left); }
    else { left=curLeft(); var d=stepMs(Math.min(P.idx,steps.length-1)); frac=ph==="done"?1:(d?1-left/d:0); txt=ph==="done"?"":RT.fmtMS(left); }
    setP("left", txt);
    document.querySelectorAll('[data-p="bar"]').forEach(function(n){ n.style.width=(Math.max(0,Math.min(1,frac))*100).toFixed(1)+"%"; });
    var tot=0;
    if(ph!=="done"){
      var from=ph==="rest"?P.restIdx+1:P.idx+1;
      tot=(ph==="rest"?0:curLeft()); for(var j=from;j<steps.length;j++) tot+=stepMs(j);
    }
    setP("total", ph==="done"?"":"סה״כ נותר "+RT.fmtMS(tot));
    var phTxt=PHASES[ph]; if(P.paused) phTxt="מושהה"; else if(ph==="countin") phTxt="ספירה… "+Math.max(1,P.count);
    setP("phase", phTxt);
    document.title = (ph==="play"&&!P.paused) ? "⏱ "+RT.fmtMS(curLeft())+" · מעקב רודימנטים" : "מעקב רודימנטים";
  }
  renderMeasureTick();
}
function renderSteps(){
  var ol=document.getElementById("pSteps"); if(!ol) return;
  var steps=R(), key=today(), todayDone=Array.isArray(RT.plan.steps[key])?RT.plan.steps[key]:[];
  ol.innerHTML="";
  steps.forEach(function(s,i){
    var r=P.results[i], cur=(P.phase==="rest"?P.restIdx+1:P.idx)===i && P.phase!=="done";
    var done=P.done.indexOf(i)>=0, link=RT.stepLink(i), lc=link&&RT.latestClean(link);
    var li=document.createElement("li");
    li.className="step"+(cur?" cur":"")+(done?" done":"")+(todayDone.indexOf(i)>=0?" today":"");
    li.dataset.step=i;
    li.innerHTML='<button type="button" class="step-b"><span class="step-n">'+(done?"✓":(i+1))+'</span><span class="step-t"><b>'+esc(s.title)+'</b><small class="muted">'+s.min+" דק' · "+RT.subName(s.sub)+(lc?" · מקס נקי "+lc.clean:"")+'</small></span>'+
      (r&&r.rating?'<span class="badge rt-'+r.rating+'">'+RT.RATINGS[r.rating]+'</span>':'')+'<span class="step-bpm">'+s.bpm+'</span></button>';
    li.querySelector("button").addEventListener("click",function(){
      if(P.phase==="idle"||P.phase==="done"){ if(P.phase==="done") reset(); P.idx=i; render(); renderSteps(); }
      else { if(P.phase==="rest") finalizeRest(); else { P.partialMs=(P.partialMs||0)+played(); metro.stop(); } goStep(i); }
    });
    ol.appendChild(li);
  });
  var meta=document.getElementById("routineMeta"); if(meta) meta.textContent=steps.length+" שלבים · "+RT.routineMinutes()+" דק'";
}
metro.onBeat(function(beat,count){
  if(count && beat>=0 && P.phase==="countin"){ P.count=Math.max(1,(RT.settings.countIn||4)-beat); }
  document.querySelectorAll("[data-beats]").forEach(function(box){
    if(box.children.length!==4){ box.innerHTML='<i></i><i></i><i></i><i></i>'; }
    [].forEach.call(box.children,function(d,i){ d.classList.toggle("on",i===beat); d.classList.toggle("first",i===0); d.classList.toggle("count",!!count); });
  });
  if(beat>=0 && count) setP("phase","ספירה… "+((RT.settings.countIn||4)-beat));
});

RT.practice = {start:start, togglePause:togglePause, next:next, prev:prev, rate:rate, raise:raise, stop:stop, adjust:adjust, render:render, renderSteps:renderSteps,
  goStep:goStep, active:function(){ return P.phase!=="idle" && P.phase!=="done"; }};

/* ======================= weekly measurement ======================= */
var M = RT.M = {phase:"setup", sub:"", start:80, step:5, every:30, bpm:80, levelEnd:0, hard:null, brk:null, queue:null, qi:0};
function $(id){ return document.getElementById(id); }
function defaultStart(id){
  var lc=RT.latestClean(id), s=RT.SUB[id];
  if(lc) return RT.clampBpm(lc.clean-(+RT.settings.measureStart||0));
  if(s && s.fixed) return s.fixed;
  return 80;
}
function setupFor(id){
  if(!RT.SUB[id]) id=(RT.plan.weekly.filter(function(x){ return RT.SUB[x]; })[0])||"single8";
  M.sub=id; M.phase="setup"; M.hard=M.brk=null;
  $("mSub").value=id;
  $("mStart").value=defaultStart(id);
  $("mStep").value=RT.settings.measureStep;
  $("mEvery").value=RT.settings.measureEvery;
  var isTest=RT.EXOF[id]&&RT.EXOF[id].cat==="test";
  $("mSubdivWrap").hidden=!isTest; if(!isTest) $("mSubdiv").value="";
  renderMeasure();
}
function measureGo(){
  var start=RT.num($("mStart").value)||defaultStart(M.sub);
  M.start=RT.clampBpm(start); M.step=Math.max(1,Math.min(30,RT.num($("mStep").value)||5)); M.every=Math.max(5,Math.min(300,RT.num($("mEvery").value)||30));
  M.subdiv=$("mSubdiv").value;
  M.bpm=M.start; M.hard=M.brk=null; M.phase="countin"; M.paused=false;
  metro.setSub(1); metro.setBpm(M.bpm);
  metro.start({countIn:4, onReady:function(){ M.phase="run"; M.levelEnd=Date.now()+M.every*1000; renderMeasure(); }});
  RT.keepAwake(true);
  renderMeasure();
}
function levelUp(){
  if(M.bpm>=300){ M.brk=M.brk||300; measureEnd(); return; }
  M.bpm=RT.clampBpm(M.bpm+M.step); metro.setBpm(M.bpm);
  M.levelEnd=Date.now()+M.every*1000;
  renderMeasure();
}
function mark(){
  if(M.phase!=="run") return false;
  if(M.hard==null){ M.hard=M.bpm; RT.chime("mark"); renderMeasure(); }
  else { M.brk=M.bpm; measureEnd(); }
  return true;
}
function measureEnd(){
  metro.stop(); RT.keepAwake(false);
  M.phase="result";
  var clean = M.hard!=null && M.hard>M.start ? M.hard-M.step : (M.hard==null && M.brk ? M.brk-M.step : null);
  if(M.hard!=null && M.hard<=M.start) clean=null;
  $("mResClean").value=clean||"";
  $("mResHard").value=M.hard||"";
  $("mResBreak").value=M.brk||"";
  var isTest=RT.EXOF[M.sub]&&RT.EXOF[M.sub].cat==="test";
  $("mResSubdivWrap").hidden=!isTest; $("mResSubdiv").value=M.subdiv||"";
  $("mResNotes").value="";
  renderMeasure();
}
function measureCancel(){ metro.stop(); RT.keepAwake(false); M.phase="setup"; M.hard=M.brk=null; renderMeasure(); }
function measureSave(){
  var clean=RT.num($("mResClean").value), hard=RT.num($("mResHard").value), brk=RT.num($("mResBreak").value);
  if(!clean && !hard){ RT.toast("הזן לפחות BPM נקי או קשה"); $("mResClean").focus(); return false; }
  var o={date:new Date().toISOString(), clean:clean, hard:hard, broke:[], notes:$("mResNotes").value.trim(), src:"measure"};
  if(brk) o.breakBpm=brk;
  var sd=$("mResSubdiv").value; if(sd && !$("mResSubdivWrap").hidden) o.subdiv=sd;
  RT.addEntry(M.sub,o);
  RT.toast("המדידה נשמרה: "+RT.fullName(M.sub)+" · נקי "+(clean||"—")+" ✓");
  advanceQueue();
  return true;
}
function advanceQueue(){
  if(M.queue){
    M.qi++;
    if(M.qi<M.queue.length){ setupFor(M.queue[M.qi]); return; }
    M.queue=null; RT.toast("רשימת המדידה הושלמה ✓");
  }
  setupFor(M.sub);
}
function runAll(){
  var q=RT.plan.weekly.filter(function(x){ return RT.SUB[x]; });
  if(!q.length){ RT.toast("רשימת המדידה ריקה – הוסף תרגילים בהגדרות"); return; }
  M.queue=q; M.qi=0; setupFor(q[0]);
}
function renderMeasure(){
  if(!$("mStage")) return;
  $("mStage").dataset.phase=M.phase;
  $("mSetup").hidden=M.phase!=="setup";
  $("mRun").hidden=!(M.phase==="countin"||M.phase==="run");
  $("mResult").hidden=M.phase!=="result";
  var q=M.queue;
  $("mQueueLine").hidden=!q; $("mSkip").hidden=!q; $("mQuit").hidden=!q;
  if(q) $("mQueueLine").innerHTML='רשימה שבועית · <b>'+(M.qi+1)+'/'+q.length+'</b>'+(q[M.qi+1]?' · הבא: '+esc(RT.fullName(q[M.qi+1])):' · אחרון ברשימה');
  var s=RT.SUB[M.sub], lc=RT.latestClean(M.sub);
  $("mLast").innerHTML = lc ? 'מקס נקי אחרון: <b>'+lc.clean+'</b>'+(lc.hard?' · קשה '+lc.hard:'')+(lc.breakBpm?' · נשבר '+lc.breakBpm:'')+' · '+RT.fmtDate(lc.date)+(RT.subdivOf(lc)?' · '+esc(RT.subdivOf(lc)):'') : "עדיין אין מדידה לתת-התרגיל הזה";
  $("mName").textContent=RT.fullName(M.sub); $("mResName").textContent=RT.fullName(M.sub);
  $("mStick").innerHTML=RT.stickHTML(s);
  $("mRunPill").textContent=q?"מדידה "+(M.qi+1)+"/"+q.length:"מדידה";
  $("mBpm").textContent=M.bpm;
  $("mMark").textContent=M.hard==null?"קשה":"נשבר";
  $("mMark").classList.toggle("brk",M.hard!=null);
  $("mMarks").innerHTML='<span>התחלה <b>'+M.start+'</b></span>'+(M.hard!=null?'<span>קשה <b>'+M.hard+'</b></span>':'');
  renderWeekly();
  renderMeasureTick();
}
function renderMeasureTick(){
  if(!$("mStage")) return;
  if(M.phase==="run"){
    var left=Math.max(0,M.levelEnd-Date.now());
    $("mLevelLeft").textContent="עלייה בעוד "+Math.ceil(left/1000)+" שנ'";
    $("mNextBpm").textContent="הבא: "+RT.clampBpm(M.bpm+M.step);
    $("mBar").style.width=((1-left/(M.every*1000))*100).toFixed(1)+"%";
    $("mPhase").textContent=M.hard==null?"עולים בהדרגה – לחץ כשנהיה קשה":"לחץ כשזה נשבר";
  } else if(M.phase==="countin"){ $("mPhase").textContent="ספירה…"; $("mLevelLeft").textContent=""; $("mNextBpm").textContent=""; $("mBar").style.width="0"; }
}
function renderWeekly(){
  var ol=$("weeklyList"); if(!ol) return;
  var ws=RT.weekStart(new Date()), list=RT.plan.weekly.filter(function(x){ return RT.SUB[x]; }), measured=0;
  ol.innerHTML="";
  list.forEach(function(id,i){
    var lc=RT.latestClean(id), thisWeek=lc && new Date(lc.date)>=ws;
    if(thisWeek) measured++;
    var li=document.createElement("li");
    li.className="step"+(thisWeek?" done":"")+(M.queue&&M.queue[M.qi]===id?" cur":"")+(M.sub===id&&!M.queue?" sel":"");
    li.innerHTML='<button type="button" class="step-b"><span class="step-n">'+(thisWeek?"✓":(i+1))+'</span><span class="step-t"><b>'+esc(RT.fullName(id))+'</b><small class="muted">'+(lc?"אחרון "+RT.fmtDate(lc.date):"לא נמדד")+'</small></span><span class="step-bpm">'+(lc?lc.clean:"—")+'</span></button>';
    li.querySelector("button").addEventListener("click",function(){ if(M.phase==="setup"){ M.queue=null; setupFor(id); } });
    ol.appendChild(li);
  });
  $("weeklyMeta").textContent=measured+"/"+list.length+" נמדדו השבוע";
}
function fillSubSelect(sel){
  var h="";
  RT.CATS.forEach(function(cat){ if(cat.id==="all") return;
    RT.allEx().filter(function(ex){ return ex.cat===cat.id; }).forEach(function(ex){
      var subs=RT.allSubs(ex); if(!subs.length) return;
      h+='<optgroup label="'+esc(ex.name)+'">'+subs.map(function(s){ return '<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>'; }).join("")+'</optgroup>';
    });
  });
  sel.innerHTML=h;
}
RT.fillSubSelect=fillSubSelect;
function initMeasure(){
  fillSubSelect($("mSub"));
  $("mSub").addEventListener("change",function(){ setupFor($("mSub").value); });
  $("mGo").addEventListener("click",measureGo);
  $("mMark").addEventListener("click",mark);
  $("mCancel").addEventListener("click",measureCancel);
  $("mSave").addEventListener("click",measureSave);
  $("mRetry").addEventListener("click",function(){ M.phase="setup"; renderMeasure(); });
  $("mDiscard").addEventListener("click",function(){ advanceQueue(); });
  $("mSkip").addEventListener("click",function(){ advanceQueue(); });
  $("mQuit").addEventListener("click",function(){ M.queue=null; setupFor(M.sub); });
  $("mRunAll").addEventListener("click",runAll);
  setupFor(M.sub||RT.plan.weekly[0]);
}
RT.measure = {init:initMeasure, setupFor:setupFor, go:measureGo, mark:mark, cancel:measureCancel, save:measureSave, runAll:runAll, render:renderMeasure, fill:function(){ fillSubSelect($("mSub")); $("mSub").value=M.sub; },
  active:function(){ return M.phase==="countin"||M.phase==="run"; }};
})();
