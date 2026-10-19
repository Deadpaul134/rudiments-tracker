/* Google Sheets sync via the Apps Script web app (protocol unchanged from v1 – see sheets-sync/Code.gs).
   POST text/plain JSON {action:"batch", measurements, sessions, deletes, snapshot[, full]} – no CORS preflight.
   Offline queue, exponential retry, de-dupe by entry id. */
(function(){
"use strict";
var RT = window.RT;
var KEY = RT.KEYS.sync;
var busy=false, timer=null, fails=0, snapAt=0;
var S = (function(){ var s=RT.readJSON(KEY,{}); if(!RT.isObj(s)) s={};
  if(!Array.isArray(s.queue)) s.queue=[]; if(typeof s.url!=="string") s.url="";
  s.lastOk=+s.lastOk||0; s.lastErr=s.lastErr?String(s.lastErr):""; return s; })();
var fns=[];
function save(){ RT.writeJSON(KEY,S); fns.forEach(function(f){ f(); }); }

function entryId(subId,x){ return subId+"|"+x.date; }
function measurementRow(subId,x){
  var s=RT.SUB[subId], ex=RT.EXOF[subId], d=new Date(x.date), w=RT.isWork(x), ok=!isNaN(d);
  var notes=[];
  if(x.rating) notes.push("דירוג: "+RT.RATINGS[x.rating]);
  if(x.breakBpm) notes.push("נשבר ב-"+x.breakBpm+" BPM");
  if(x.notes) notes.push(x.notes);
  return {id:entryId(subId,x), ts:ok?RT.ymd(d)+" "+RT.hm(d):String(x.date), date:ok?RT.ymd(d):String(x.date).slice(0,10),
    category:ex?RT.catName(ex.cat):"", rudiment:ex?ex.name:subId, sub:s?s.name:subId,
    type:w?"טמפו עבודה":"מקסימום נקי", clean:w?(x.work||null):(x.clean||null), hard:w?null:(x.hard||null),
    notes:notes.join(" · "), subdiv:RT.subdivOf(x), broke:(x.broke||[]).join(", "), subId:subId};
}
function allMeasurementRows(){
  var rows=[];
  Object.keys(RT.state.entries).forEach(function(id){ RT.entries(id).forEach(function(x){ if(RT.isObj(x)&&x.date) rows.push(measurementRow(id,x)); }); });
  rows.sort(function(a,b){ return a.ts<b.ts?-1:a.ts>b.ts?1:0; });
  return rows;
}
// logged sessions + one row per marked practice day without a logged session (history from before the log existed)
function allSessionRows(){
  var log=Array.isArray(RT.plan.log)?RT.plan.log.slice():[], have={}, R=RT.routine();
  log.forEach(function(r){ have[r.date]=1; });
  Object.keys(RT.plan.days).forEach(function(k){
    if(!RT.plan.days[k]||have[k]) return;
    var st=Array.isArray(RT.plan.steps[k])?RT.plan.steps[k].filter(function(i){ return R[i]; }):[];
    log.push({id:"day_"+k, date:k, ts:k, kind:"יום תרגול (סימון)", minutes:st.length?st.reduce(function(a,i){ return a+R[i].min; },0):"",
      steps:st.map(function(i){ return (i+1)+". "+R[i].title; }).join(" | "), notes:"שוחזר מסימון ימי התרגול – הקצבים של אותו יום לא נשמרו"});
  });
  log.sort(function(a,b){ return String(a.ts)<String(b.ts)?-1:String(a.ts)>String(b.ts)?1:0; });
  return log;
}
function snapshot(){
  var keys={};
  try{ for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i);
    if(k.indexOf(RT.STORE_KEY)!==0 || k===KEY || k===RT.KEYS.backup || k===RT.KEYS.premig) continue;
    var v=localStorage.getItem(k); try{ keys[k]=JSON.parse(v); }catch(e){ keys[k]=v; } } }catch(e){}
  var txt=""; try{ txt=RT.buildTextSummary(); }catch(e){}
  return {app:"rimon-rudiments", version:3, exported:new Date().toISOString(), localStorage:keys, summaryText:txt};
}
function enqueue(item){
  if(!S.url) return;
  if(item.k==="m"||item.k==="s") S.queue=S.queue.filter(function(q){ return !(q.k===item.k && q.id===item.id); });
  if(item.k==="d") S.queue=S.queue.filter(function(q){ return !(q.k==="m" && q.id===item.id); });
  S.queue.push(item); save(); schedule(400);
}
function touch(){ if(!S.url) return; snapAt=Date.now(); S.snapDirty=1; save(); schedule(2500); }
function full(){ if(!S.url) return false; S.queue=[{k:"full"}]; save(); clearTimeout(timer); fails=0; flush(); return true; }
function schedule(ms){ if(!S.url) return; clearTimeout(timer); timer=setTimeout(flush, ms); }
function post(body){
  var payload=JSON.stringify(body), opts={method:"POST", body:payload, headers:{"Content-Type":"text/plain;charset=utf-8"}, redirect:"follow", cache:"no-store"};
  return fetch(S.url, opts).then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.text(); })
    .then(function(t){ var j; try{ j=JSON.parse(t); }catch(e){ throw new Error("תשובה לא צפויה מגוגל – בדוק שהפריסה היא Web app עם גישה Anyone"); }
        if(!j || j.ok!==true) throw new Error((j&&j.error)||"שגיאה בסקריפט"); return j; },
      function(err){
        // CORS-level failure while online: resend as an opaque "simple" request (server de-dupes by id)
        if(err && err.name==="TypeError" && navigator.onLine!==false)
          return fetch(S.url, {method:"POST", mode:"no-cors", body:payload, headers:{"Content-Type":"text/plain;charset=utf-8"}}).then(function(){ return {ok:true, opaque:true}; });
        throw err;
      });
}
function flush(){
  clearTimeout(timer);
  if(busy || !S.url){ save(); return Promise.resolve(false); }
  if(!S.queue.length && !S.snapDirty){ save(); return Promise.resolve(true); }
  var items=S.queue.slice(), isFull=items.some(function(q){ return q.k==="full"; }), body;
  if(isFull) body={action:"batch", full:true, measurements:allMeasurementRows(), sessions:allSessionRows(), snapshot:snapshot()};
  else body={action:"batch",
    measurements:items.filter(function(q){ return q.k==="m"; }).map(function(q){ return q.row; }),
    sessions:items.filter(function(q){ return q.k==="s"; }).map(function(q){ return q.row; }),
    deletes:items.filter(function(q){ return q.k==="d"; }).map(function(q){ return q.id; }),
    snapshot:snapshot()};
  var touchAt=Date.now(); busy=true; save();
  return post(body).then(function(res){
    S.queue=S.queue.filter(function(q){ return items.indexOf(q)<0; });
    if(snapAt<=touchAt) S.snapDirty=0;
    S.lastOk=Date.now(); S.lastErr=""; S.opaque=!!res.opaque; fails=0;
    if(res.url) S.sheetUrl=res.url;
    busy=false; save();
    if(isFull && RT.toast) RT.toast(res.opaque?"נשלח לגיליון (בלי אישור מגוגל)":"כל ההיסטוריה סונכרנה לגיליון ✓");
    if(S.queue.length) schedule(300);
    return true;
  }, function(err){
    busy=false; fails++;
    S.lastErr=(navigator.onLine===false?"אין חיבור לאינטרנט":String(err&&err.message||err||"שגיאה"));
    save();
    if(isFull && RT.toast) RT.toast("הסנכרון נכשל – ננסה שוב אוטומטית");
    schedule(Math.min(300000, 15000*Math.pow(2,Math.min(5,fails-1))));
    return false;
  });
}
function status(){
  if(!S.url) return "none";
  if(S.lastErr && (S.queue.length||S.snapDirty)) return "err";
  if(busy || S.queue.length || S.snapDirty) return "wait";
  return S.lastOk ? "ok" : "wait";
}
function jsonp(url, ms){
  return new Promise(function(res,rej){
    var cb="__rudSync"+Date.now().toString(36)+Math.floor(Math.random()*1e4), s=document.createElement("script"), done=false;
    function fin(){ done=true; clearTimeout(to); try{ delete window[cb]; }catch(e){ window[cb]=undefined; } if(s.parentNode) s.parentNode.removeChild(s); }
    var to=setTimeout(function(){ if(done) return; fin(); rej(new Error("אין תשובה מגוגל")); }, ms||15000);
    window[cb]=function(d){ if(done) return; fin(); res(d); };
    s.onerror=function(){ if(done) return; fin(); rej(new Error("הכתובת לא נטענה")); };
    s.src=url+(url.indexOf("?")<0?"?":"&")+"callback="+cb+"&t="+Date.now();
    document.head.appendChild(s);
  });
}
function test(){
  var u=S.url; if(!u) return Promise.reject(new Error("קודם הדבק ושמור את כתובת ה-Web App"));
  return fetch(u+(u.indexOf("?")<0?"?":"&")+"t="+Date.now(), {cache:"no-store", redirect:"follow"})
    .then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
    .catch(function(){ return jsonp(u); })
    .then(function(j){
      if(!j || j.ok!==true) throw new Error((j&&j.error)||"תשובה לא צפויה");
      if(j.url) S.sheetUrl=j.url; S.lastErr=""; save();
      return j;
    }, function(e){ S.lastErr="בדיקת חיבור נכשלה: "+(e&&e.message||e); save(); throw e; });
}
function setUrl(u){
  u=String(u||"").trim();
  if(u && !/^https:\/\/\S+$/.test(u)) return false;
  var changed=u!==S.url; S.url=u;
  if(changed){ S.queue=[]; S.lastOk=0; S.lastErr=""; S.sheetUrl=""; S.snapDirty=0; }
  save(); return true;
}

RT.sync = {
  entry:function(subId,x){ enqueue({k:"m", id:entryId(subId,x), row:measurementRow(subId,x)}); },
  del:function(subId,x){ enqueue({k:"d", id:entryId(subId,x)}); },
  session:function(row){ enqueue({k:"s", id:row.id, row:row}); },
  touch:touch, full:full, flush:function(){ fails=0; return flush(); }, test:test, status:status, setUrl:setUrl,
  state:function(){ return S; }, busy:function(){ return busy; }, onChange:function(f){ fns.push(f); },
  measurementRows:allMeasurementRows, sessionRows:allSessionRows
};
RT.onChange(function(){ touch(); });
window.addEventListener("online",function(){ fails=0; flush(); });
document.addEventListener("visibilitychange",function(){ if(!document.hidden && S.url && (S.queue.length||S.snapDirty)) flush(); });
if(S.url && (S.queue.length||S.snapDirty)) schedule(1500);
})();
