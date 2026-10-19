/* Short practice recording (practice screen): up to 30 s from the microphone via MediaRecorder, then play it back.
   Only the latest take is kept, in memory (object URL – the previous one is revoked). No upload, no sync, no storage. */
(function(){
"use strict";
var RT = window.RT;
var MAX_MS = 30000;
var MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]; // audio/mp4 = iPad / iOS Safari
var R = {state:"idle", url:"", mime:"", ms:0, startAt:0, msg:""}; // state: idle | asking | rec
var rec=null, stream=null, chunks=[], stopT=null, tickT=null;
function $(id){ return document.getElementById(id); }

function pickMime(){
  var MR = window.MediaRecorder;
  if(!MR || typeof MR.isTypeSupported!=="function") return "";
  for(var i=0;i<MIMES.length;i++){ try{ if(MR.isTypeSupported(MIMES[i])) return MIMES[i]; }catch(e){} }
  return ""; // browser default
}
function supported(){ return !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
function release(){
  if(stream){ stream.getTracks().forEach(function(t){ try{ t.stop(); }catch(e){} }); stream=null; }
  clearTimeout(stopT); clearInterval(tickT); stopT=tickT=null;
}
function fail(msg){ release(); rec=null; R.state="idle"; R.msg=msg; render(); }
function errMsg(e){
  var n=e && e.name;
  if(n==="NotAllowedError"||n==="SecurityError"||n==="PermissionDeniedError") return "אין הרשאה למיקרופון – אפשר לאשר אותה בהגדרות הדפדפן";
  if(n==="NotFoundError"||n==="DevicesNotFoundError") return "לא נמצא מיקרופון";
  return "לא ניתן להתחיל הקלטה";
}

function start(){
  if(R.state!=="idle") return false;
  if(!supported()){ R.msg="ההקלטה לא נתמכת בדפדפן הזה"; render(); return false; }
  var a=$("recAudio"); if(a && !a.paused) a.pause();
  R.state="asking"; R.msg=""; render();
  // raw signal: echo cancellation / noise suppression would eat the drum and the click
  navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}}).then(function(s){
    stream=s; chunks=[];
    var mime=pickMime();
    try{ rec = mime ? new MediaRecorder(s,{mimeType:mime}) : new MediaRecorder(s); }
    catch(e){ try{ mime=""; rec=new MediaRecorder(s); }catch(e2){ fail("ההקלטה לא נתמכת בדפדפן הזה"); return; } }
    R.mime=rec.mimeType||mime;
    rec.ondataavailable=function(ev){ if(ev.data && ev.data.size) chunks.push(ev.data); };
    rec.onstop=done;
    rec.onerror=function(){ fail("ההקלטה נכשלה"); };
    rec.start();
    R.state="rec"; R.startAt=Date.now();
    stopT=setTimeout(stop, MAX_MS);
    tickT=setInterval(function(){ if(Date.now()-R.startAt>=MAX_MS) stop(); else renderTime(); }, 200);
    render();
  }, function(e){ fail(errMsg(e)); });
  return true;
}
function stop(){
  if(R.state!=="rec" || !rec) return false;
  R.ms=Math.min(MAX_MS, Date.now()-R.startAt);
  clearTimeout(stopT); clearInterval(tickT); stopT=tickT=null;
  try{ if(rec.state!=="inactive") rec.stop(); else done(); }catch(e){ done(); }
  return true;
}
function done(){
  var r=rec; rec=null; release();
  R.state="idle";
  if(!chunks.length){ R.msg="ההקלטה ריקה – נסה שוב"; render(); return; }
  var blob=new Blob(chunks,{type:(r&&r.mimeType)||R.mime||"audio/webm"}); chunks=[];
  if(R.url) URL.revokeObjectURL(R.url);
  R.url=URL.createObjectURL(blob);
  var a=$("recAudio"); if(a){ a.src=R.url; try{ a.load(); }catch(e){} }
  R.msg=""; render();
}
function toggle(){ return R.state==="rec" ? stop() : start(); }
function play(){
  var a=$("recAudio"); if(!a || !R.url || R.state!=="idle") return false;
  if(!a.paused){ a.pause(); a.currentTime=0; render(); return true; }
  var p=a.play(); if(p && p.catch) p.catch(function(){ R.msg="לא ניתן להשמיע"; render(); });
  render(); return true;
}

function fmt(ms){ var s=Math.max(0,Math.ceil(ms/1000)); return "0:"+(s<10?"0":"")+s; }
function renderTime(){
  var t=$("recTime"); if(!t) return;
  if(R.state==="rec") t.textContent="נותרו "+fmt(MAX_MS-(Date.now()-R.startAt));
  else t.textContent=R.url ? "הקלטה של "+fmt(R.ms) : "עד 30 שנ'";
}
function render(){
  var b=$("recBtn"); if(!b) return;
  var a=$("recAudio"), playing=a && !a.paused;
  $("recTool").dataset.state=R.state;
  $("recLbl").textContent = R.state==="rec" ? "עצור" : R.state==="asking" ? "מבקש מיקרופון…" : (R.url ? "הקלטה חדשה" : "הקלטה");
  b.disabled = R.state==="asking";
  b.setAttribute("aria-pressed", String(R.state==="rec"));
  $("recPlay").disabled = !R.url || R.state!=="idle";
  $("recPlayLbl").textContent = playing ? "עצור השמעה" : "השמע";
  $("recMsg").textContent=R.msg; $("recMsg").hidden=!R.msg;
  renderTime();
}
function init(){
  if(!$("recBtn")) return;
  $("recBtn").addEventListener("click",toggle);
  $("recPlay").addEventListener("click",play);
  ["play","pause","ended"].forEach(function(ev){ $("recAudio").addEventListener(ev,render); });
  window.addEventListener("pagehide",function(){ if(R.state==="rec") stop(); });
  render();
}

RT.recorder = {pickMime:pickMime, start:start, stop:stop, toggle:toggle, play:play, init:init, MAX_MS:MAX_MS,
  state:function(){ return {state:R.state, url:R.url, mime:R.mime, ms:R.ms, msg:R.msg}; }};
})();
