/* Two-way sync with the Cloudflare D1 endpoint (functions/api/sync.js).
   Every syncable thing becomes a record {kind,id,data}. Local changes are found by diffing against the last
   synced hash of each record (so every mutation path is covered), stamped with the time they were noticed,
   and sent; server changes after our cursor come back and are applied. Last change wins per record, except
   that a clean max never drops (the server keeps the higher clean/hard). Entries and sessions are deleted
   remotely only through an explicit delete (RT.sync.del). */
(function(){
"use strict";
var RT = window.RT;
var KEY = RT.STORE_KEY+"-d1sync";
var CHUNK = 500;
try{ localStorage.removeItem(RT.KEYS.sync); }catch(e){}          // old Google Sheets queue

var S = (function(){
  var s=RT.readJSON(KEY,{}); if(!RT.isObj(s)) s={};
  s.code=typeof s.code==="string"?s.code:""; s.server=typeof s.server==="string"?s.server:"";
  s.cursor=+s.cursor||0; s.lastOk=+s.lastOk||0; s.lastErr=s.lastErr?String(s.lastErr):""; s.authErr=!!s.authErr;
  if(!RT.isObj(s.meta)) s.meta={}; if(!RT.isObj(s.dirty)) s.dirty={};
  s.counts=RT.isObj(s.counts)?s.counts:null; s.received=+s.received||0;
  s.idToken=typeof s.idToken==="string"?s.idToken:"";
  s.sub=typeof s.sub==="string"?s.sub:"";
  s.email=typeof s.email==="string"?s.email:"";
  s.name=typeof s.name==="string"?s.name:"";
  s.exp=+s.exp||0; s.hold=!!s.hold; s.claimed=!!s.claimed; s.claimChecked=!!s.claimChecked;
  return s;
})();
var PROFILES = RT.STORE_KEY+"-profiles";
var clientId="";
var busy=false, again=false, againFull=false, timer=null, fails=0, applying=false, fns=[], appliedFns=[];
function save(){ RT.writeJSON(KEY,S); notify(); }
function notify(){ fns.forEach(function(f){ try{ f(); }catch(e){} }); }

/* ---------- records ---------- */
function hash(v){ var s=JSON.stringify(v), h=0x811c9dc5; for(var i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193); } return (h>>>0).toString(36)+"."+s.length; }
function dayRecord(pl,k){
  var o={}, any=false;
  if(pl.days[k]!=null){ o.on=pl.days[k]; any=true; }
  ["steps","kit","sessions"].forEach(function(f){ if(RT.isObj(pl[f]) && pl[f][k]!=null){ o[f]=pl[f][k]; any=true; } });
  return any?o:null;
}
function collect(){
  var R={}, st=RT.state, pl=RT.plan;
  Object.keys(st.entries||{}).forEach(function(sub){
    (Array.isArray(st.entries[sub])?st.entries[sub]:[]).forEach(function(x){ if(RT.isObj(x)&&x.date) R["e:"+sub+"|"+x.date]=x; });
  });
  (Array.isArray(pl.log)?pl.log:[]).forEach(function(r){ if(RT.isObj(r)&&r.id) R["s:"+r.id]=r; });
  var dk={}; ["days","steps","kit","sessions"].forEach(function(f){ if(RT.isObj(pl[f])) Object.keys(pl[f]).forEach(function(k){ dk[k]=1; }); });
  Object.keys(dk).forEach(function(k){ var d=dayRecord(pl,k); if(d) R["d:"+k]=d; });
  (st.customEx||[]).forEach(function(e){ if(RT.isObj(e)&&e.id) R["x:"+e.id]=e; });
  Object.keys(st.custom||{}).forEach(function(ex){ (Array.isArray(st.custom[ex])?st.custom[ex]:[]).forEach(function(c){ if(RT.isObj(c)&&c.id) R["c:"+c.id]={ex:ex, sub:c}; }); });
  R["p:routine"]=pl.routine2; R["p:weekly"]=pl.weekly;
  return R;
}
// notice local changes; returns true when something new has to be sent
function scan(){
  if(applying) return false;
  var R=collect(), now=Date.now(), ch=false;
  Object.keys(R).forEach(function(k){
    var h=hash(R[k]), m=S.meta[k];
    if(!m || m[0]!==h || m[2]){ S.meta[k]=[h,now]; S.dirty[k]=1; ch=true; }
  });
  Object.keys(S.meta).forEach(function(k){
    if(R[k] || S.meta[k][2]) return;
    var kind=k.charAt(0);
    if(kind==="e"||kind==="s"){ delete S.meta[k]; delete S.dirty[k]; }   // no explicit delete → never removed elsewhere
    else { S.meta[k]=[null,now,1]; S.dirty[k]=1; ch=true; }
  });
  save();
  return ch;
}

/* ---------- applying server records ---------- */
function byDate(a,b){ return new Date(a.date)-new Date(b.date); }
function applyRecord(kind,id,data){
  var st=RT.state, pl=RT.plan, i, arr;
  if(kind==="e"){
    var p=id.indexOf("|"), sub=id.slice(0,p), date=id.slice(p+1);
    arr=Array.isArray(st.entries[sub])?st.entries[sub]:(st.entries[sub]=[]);
    for(i=0;i<arr.length;i++) if(arr[i]&&arr[i].date===date) break;
    if(data==null){ if(i<arr.length) arr.splice(i,1); if(!arr.length) delete st.entries[sub]; }
    else if(i<arr.length) arr[i]=data; else { arr.push(data); arr.sort(byDate); }
  } else if(kind==="s"){
    if(!Array.isArray(pl.log)) pl.log=[];
    for(i=0;i<pl.log.length;i++) if(pl.log[i]&&pl.log[i].id===id) break;
    if(data==null){ if(i<pl.log.length) pl.log.splice(i,1); }
    else if(i<pl.log.length) pl.log[i]=data;
    else { pl.log.push(data); pl.log.sort(function(a,b){ return String(a.ts)<String(b.ts)?-1:String(a.ts)>String(b.ts)?1:0; }); }
  } else if(kind==="d"){
    var map={on:"days",steps:"steps",kit:"kit",sessions:"sessions"};
    Object.keys(map).forEach(function(f){ var t=map[f]; if(!RT.isObj(pl[t])) pl[t]={};
      if(data!=null && data[f]!=null) pl[t][id]=data[f]; else delete pl[t][id]; });
  } else if(kind==="x"){
    st.customEx=(st.customEx||[]).filter(function(e){ return e.id!==id; });
    if(data!=null) st.customEx.push(data);
  } else if(kind==="c"){
    Object.keys(st.custom).forEach(function(ex){ if(Array.isArray(st.custom[ex])) st.custom[ex]=st.custom[ex].filter(function(c){ return c.id!==id; }); });
    if(data!=null && RT.isObj(data.sub)){ if(!Array.isArray(st.custom[data.ex])) st.custom[data.ex]=[]; st.custom[data.ex].push(data.sub); }
  } else if(kind==="p"){
    if(id==="routine" && Array.isArray(data) && data.length) pl.routine2=data;
    if(id==="weekly" && Array.isArray(data)) pl.weekly=data;
  }
}
// first sync of this device: the cloud copy is adopted, but practice days and clean max are merged
function adoptMerge(kind,local,remote){
  if(local==null || remote==null) return remote;
  if(kind==="d"){
    var o=JSON.parse(JSON.stringify(remote));
    if(local.on && !o.on) o.on=local.on;
    if(Array.isArray(local.steps)){ var s=Array.isArray(o.steps)?o.steps.slice():[];
      local.steps.forEach(function(x){ if(s.indexOf(x)<0) s.push(x); }); s.sort(function(a,b){ return a-b; }); o.steps=s; }
    return o;
  }
  if(kind==="e" && !RT.isWork(local) && !RT.isWork(remote)){
    var e=JSON.parse(JSON.stringify(remote));
    ["clean","hard"].forEach(function(f){ if((+local[f]||0)>(+e[f]||0)) e[f]=local[f]; });
    return e;
  }
  return remote;
}
function applyRemote(rows, adopt){
  if(!rows.length) return 0;
  var R=collect(), n=0, now=Date.now();
  applying=true;
  try{
    rows.forEach(function(r){
      var k=r.kind+":"+r.id, m=S.meta[k], data=r.deleted?null:r.data;
      if(!adopt && S.dirty[k] && m && m[1]>r.updatedAt) return;        // our newer change goes up next
      var local=R[k], use=adopt?adoptMerge(r.kind,local,data):data;
      var same = use==null ? local==null : (local!=null && hash(local)===hash(use));
      if(!same){ applyRecord(r.kind,r.id,use==null?null:JSON.parse(JSON.stringify(use))); n++; }
      if(use==null) S.meta[k]=[null,r.updatedAt,1];
      else if(adopt && hash(use)!==hash(data)){ S.meta[k]=[hash(use),now]; S.dirty[k]=1; return; }
      else S.meta[k]=[hash(use),r.updatedAt];
      delete S.dirty[k];
    });
    if(n){ RT.indexSubs(); RT.save(); RT.savePlan(); }
  } finally { applying=false; }
  if(n) appliedFns.forEach(function(f){ try{ f(n); }catch(e){ console.error(e); } });
  return n;
}

/* ---------- transport ---------- */
function endpoint(){
  var s=S.server.trim();
  if(s){ s=s.replace(/\/+$/,""); return /\/api\/sync$/.test(s)?s:s+"/api/sync"; }
  return /^https?:$/.test(location.protocol) ? "/api/sync" : "";
}
function apiUrl(name){
  var e=endpoint();
  return e ? e.replace(/\/api\/sync$/, "/api/"+name) : "";
}
function tokenLive(){
  return !!(S.idToken && S.sub && (+S.exp)*1000 > Date.now()+5000);
}
function configured(){
  if(!endpoint()) return false;
  if(tokenLive()) return true;
  return !!S.code;
}
function account(){
  var live=tokenLive();
  return {
    signedIn:live, expired:!!(S.idToken && S.sub && !live),
    email:S.email, name:S.name, sub:S.sub||"",
    hold:!!(S.hold && live), claimed:!!S.claimed, claimChecked:!!S.claimChecked
  };
}
// text/plain POST → a "simple" request, no CORS preflight. A live Google token wins over the access code.
function call(body){
  var usingToken=tokenLive();
  var cred=usingToken?{idToken:S.idToken}:{code:S.code};
  var opts={method:"POST", cache:"no-store", headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify(Object.assign(cred, body))};
  return fetch(endpoint(), opts).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(j){
      if(r.ok && j && j.claim && j.claim.mine) S.claimed=true;
      if(r.status===401){ var e=new Error(usingToken?"פג תוקף הכניסה. היכנס שוב עם Google":"קוד הגישה שגוי"); e.auth=true; throw e; }
      if(r.status===409 && j && j.error==="claimed"){ var e2=new Error("ההיסטוריה שויכה לחשבון Google. היכנס עם Google כדי לסנכרן."); throw e2; }
      if(!r.ok || !j || j.ok!==true){
        var msg="שגיאת שרת ("+r.status+")";
        if(j&&j.error==="not-configured") msg=usingToken?"השרת לא מוגדר (חסר מזהה Google)":"השרת לא מוגדר (חסר קוד גישה בשרת)";
        else if(j&&j.error==="not-migrated") msg="השרת עדיין בלי טבלאות החשבונות. סנכרון עם קוד גישה ממשיך לעבוד.";
        else if(j&&j.error==="auth-unavailable") msg="לא ניתן לאמת את הכניסה מול Google. נסה שוב.";
        throw new Error(msg);
      }
      return j;
    });
  }, function(){ throw new Error(navigator.onLine===false?"אין חיבור לאינטרנט":"השרת לא זמין"); });
}
function round(since, keys, adopt){
  var R=keys.length?collect():{};
  var changes=keys.map(function(k){ var m=S.meta[k], c={kind:k.charAt(0), id:k.slice(2), updatedAt:m[1], deleted:!!m[2]};
    if(!c.deleted) c.data=R[k]; return c; })
    .filter(function(c){ return c.deleted || c.data!==undefined; });
  var sent={}; keys.forEach(function(k){ sent[k]=S.meta[k]&&S.meta[k][1]; });
  return call({since:since, changes:changes}).then(function(j){
    // a sent key is clean unless it changed again while the request was in flight
    keys.forEach(function(k){ if(S.meta[k] && S.meta[k][1]===sent[k]) delete S.dirty[k]; });
    var rows=(j.changes||[]).filter(function(r){ return r && r.kind && typeof r.id==="string"; });
    var n=applyRemote(rows, adopt);
    S.cursor=+j.cursor||0; if(j.counts) S.counts=j.counts;
    return n;
  });
}
function run(full){
  var adopt=!S.lastOk, received=0;
  var first = adopt ? round(0,[],true).then(function(n){ received+=n; }) : Promise.resolve();
  return first.then(function(){
    scan();
    var since=full?0:S.cursor, loops=0;
    function next(){
      var keys=Object.keys(S.dirty).filter(function(k){ return S.meta[k]; }).slice(0,CHUNK);
      if(loops>0 && !keys.length) return Promise.resolve();
      loops++;
      return round(since,keys,false).then(function(n){ received+=n; since=S.cursor;
        if(loops<50 && Object.keys(S.dirty).length) return next(); });
    }
    return next();
  }).then(function(){ return received; });
}
function sync(full){
  clearTimeout(timer);
  if(!configured()) return Promise.resolve(false);
  if(S.hold && tokenLive()) return Promise.resolve(false);
  if(busy){ again=true; againFull=againFull||!!full; return Promise.resolve(false); }
  busy=true; save();
  return run(!!full).then(function(n){
    busy=false; fails=0; S.lastOk=Date.now(); S.lastErr=""; S.authErr=false; S.received=n; save();
    if(full && RT.toast) RT.toast("הסנכרון הושלם ✓"+(n?" · התקבלו "+n+" שינויים":""));
    if(again){ var f=againFull; again=againFull=false; schedule(200,f); }
    return true;
  }, function(err){
    busy=false; fails++; S.lastErr=String(err&&err.message||err||"שגיאה"); S.authErr=!!(err&&err.auth); save();
    if(full && RT.toast) RT.toast("הסנכרון נכשל: "+S.lastErr);
    again=againFull=false;
    if(!S.authErr) schedule(Math.min(300000, 15000*Math.pow(2,Math.min(5,fails-1))));
    return false;
  });
}
function schedule(ms, full){ if(!configured()) return; clearTimeout(timer); timer=setTimeout(function(){ sync(full); }, ms); }

function status(){
  if(!configured()) return "none";
  if(S.hold && tokenLive()) return "hold";
  if(S.lastErr) return "err";
  if(busy || Object.keys(S.dirty).length || !S.lastOk) return "wait";
  return "ok";
}
function resetLink(){ S.cursor=0; S.lastOk=0; S.meta={}; S.dirty={}; S.counts=null; S.received=0; S.lastErr=""; S.authErr=false; }
function setConfig(code, server){
  code=String(code||"").trim(); server=String(server||"").trim();
  if(server && !/^https?:\/\/\S+$/.test(server)) return false;
  if(code!==S.code || server!==S.server){
    var serverChanged=server!==S.server;
    S.code=code; S.server=server;
    if(serverChanged || !tokenLive()) resetLink();
    fails=0;
  }
  save();
  if(configured() && !(S.hold && tokenLive())) schedule(50);
  loadConfig();
  return true;
}
function test(){
  if(!configured()) return Promise.reject(new Error("קודם הזן קוד גישה"));
  return call({ping:true}).then(function(j){ if(j.counts) S.counts=j.counts; S.lastErr=""; S.authErr=false; save(); return j; },
    function(e){ S.lastErr=e.message; S.authErr=!!e.auth; save(); throw e; });
}

function decodeJwtPayload(token){
  try{
    var p=String(token||"").split(".")[1]; if(!p) return null;
    p=p.replace(/-/g,"+").replace(/_/g,"/"); while(p.length%4) p+="=";
    var bytes=Uint8Array.from(atob(p), function(c){ return c.charCodeAt(0); });
    var j=JSON.parse(new TextDecoder().decode(bytes));
    return RT.isObj(j)?j:null;
  }catch(e){ return null; }
}
function currentProfileId(){ return (S.sub && S.idToken) ? "g:"+S.sub : "local"; }
function readProfiles(){ var p=RT.readJSON(PROFILES,{}); return RT.isObj(p)?p:{}; }
function snapshotActive(){
  var state=null, plan=null, syncs=null;
  try{ state=localStorage.getItem(RT.KEYS.state); plan=localStorage.getItem(RT.KEYS.plan); syncs=localStorage.getItem(KEY); }catch(e){}
  return {state:state, plan:plan, sync:syncs};
}
function restoreSnap(snap){
  try{
    if(!snap){
      localStorage.setItem(RT.KEYS.state, JSON.stringify({__v:2, entries:{}, custom:{}, customEx:[]}));
      localStorage.removeItem(RT.KEYS.plan);
      localStorage.removeItem(KEY);
      return;
    }
    if(snap.state!=null) localStorage.setItem(RT.KEYS.state, snap.state); else localStorage.removeItem(RT.KEYS.state);
    if(snap.plan!=null) localStorage.setItem(RT.KEYS.plan, snap.plan); else localStorage.removeItem(RT.KEYS.plan);
    if(snap.sync!=null) localStorage.setItem(KEY, snap.sync); else localStorage.removeItem(KEY);
  }catch(e){}
}
function signIn(idToken){
  var info=decodeJwtPayload(idToken);
  var exp=info ? (+info.exp||0) : 0;
  if(!info || typeof info.sub!=="string" || !info.sub || exp*1000<Date.now()){
    if(RT.toast) RT.toast("הכניסה נכשלה");
    return false;
  }
  if(S.sub===info.sub){
    S.idToken=idToken; S.exp=exp;
    if(typeof info.email==="string" && info.email) S.email=info.email;
    if(typeof info.name==="string" && info.name) S.name=info.name;
    save();
    if(S.hold && !S.claimChecked) bootAccount();
    else if(!S.hold) schedule(50);
    return true;
  }
  var profiles=readProfiles();
  profiles[currentProfileId()]=snapshotActive();
  if(!RT.writeJSON(PROFILES, profiles)){ if(RT.toast) RT.toast("לא ניתן לשמור את ההחלפה בדפדפן"); return false; }
  var server=S.server;
  var next=profiles["g:"+info.sub];
  if(next && next.sync){
    restoreSnap(next);
    var ns=RT.readJSON(KEY,{}); if(!RT.isObj(ns)) ns={};
    ns.idToken=idToken; ns.exp=exp; ns.sub=info.sub;
    ns.email=typeof info.email==="string"?info.email:(ns.email||"");
    ns.name=typeof info.name==="string"?info.name:(ns.name||"");
    if(server) ns.server=server;
    RT.writeJSON(KEY, ns);
  } else {
    restoreSnap(null);
    RT.writeJSON(KEY, {
      code:"", server:server, cursor:0, lastOk:0, lastErr:"", authErr:false,
      meta:{}, dirty:{}, counts:null, received:0,
      idToken:idToken, exp:exp, sub:info.sub,
      email:typeof info.email==="string"?info.email:"",
      name:typeof info.name==="string"?info.name:"",
      hold:true, claimed:false, claimChecked:false
    });
  }
  location.reload();
  return true;
}
function signOut(){
  if(!S.sub) return false;
  var profiles=readProfiles();
  profiles[currentProfileId()]=snapshotActive();
  var server=S.server;
  var local=profiles.local||null;
  if(!RT.writeJSON(PROFILES, profiles)){ if(RT.toast) RT.toast("לא ניתן לשמור את היציאה בדפדפן"); return false; }
  restoreSnap(local);
  var ns=RT.readJSON(KEY,{}); if(!RT.isObj(ns)) ns={};
  ns.idToken=""; ns.sub=""; ns.email=""; ns.name=""; ns.exp=0; ns.hold=false;
  if(!ns.server && server) ns.server=server;
  RT.writeJSON(KEY, ns);
  location.reload();
  return true;
}
function claim(code){
  code=String(code||"").trim();
  if(!tokenLive()) return Promise.reject(new Error("צריך להיכנס עם Google"));
  if(!code) return Promise.reject(new Error("הזן את קוד הגישה"));
  if(!apiUrl("claim")) return Promise.reject(new Error("חסרה כתובת שרת"));
  return fetch(apiUrl("claim"), {method:"POST", cache:"no-store", headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({idToken:S.idToken, code:code})}).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(j){
      if(r.status===401){
        var e=new Error(j&&j.error==="bad-code"?"קוד הגישה שגוי":"פג תוקף הכניסה. היכנס שוב עם Google");
        e.auth=!(j&&j.error==="bad-code"); throw e;
      }
      if(r.status===409) throw new Error("ההיסטוריה כבר משויכת לחשבון אחר.");
      if(!r.ok || !j || j.ok!==true) throw new Error(j&&j.error==="not-migrated"?"השרת עדיין בלי טבלאות החשבונות.":"השיוך נכשל");
      S.hold=false; S.claimed=true; S.claimChecked=true; S.cursor=0; S.lastOk=0; S.meta={}; S.dirty={}; S.lastErr=""; S.authErr=false;
      save();
      return sync(true);
    });
  }, function(){ throw new Error(navigator.onLine===false?"אין חיבור לאינטרנט":"השרת לא זמין"); });
}
function skipClaim(){
  if(!tokenLive()) return false;
  S.hold=false; S.claimChecked=true; save(); schedule(50); return true;
}
function loadConfig(){
  var url=apiUrl("config"); if(!url) return;
  fetch(url, {cache:"no-store"}).then(function(r){ return r.json(); }).then(function(j){
    var id=j&&typeof j.googleClientId==="string"?j.googleClientId:"";
    if(id!==clientId){ clientId=id; notify(); }
  }, function(){});
}
function bootAccount(){
  if(!(tokenLive() && S.hold && !S.claimChecked && endpoint())) return false;
  call({ping:true}).then(function(j){
    var c=j.claim||{};
    S.claimChecked=true;
    if(c.mine) S.claimed=true;
    if(c.mine || c.taken || (j.counts && j.counts.total>0)) S.hold=false;
    save();
    if(!S.hold) schedule(50);
  }, function(err){
    S.claimChecked=true;
    S.lastErr=String(err&&err.message||err||"שגיאה");
    S.authErr=!!(err&&err.auth);
    save();
  });
  return true;
}

RT.sync = {
  entry:function(){}, session:function(){},                // picked up by the change scan
  del:function(subId,x){ if(!x||!x.date) return; S.meta["e:"+subId+"|"+x.date]=[null,Date.now(),1]; S.dirty["e:"+subId+"|"+x.date]=1; save(); schedule(1500); },
  full:function(){ if(!configured() || (S.hold && tokenLive())) return false; fails=0; sync(true); return true; },
  flush:function(){ fails=0; return sync(false); },
  test:test, status:status, setConfig:setConfig, configured:configured, endpoint:endpoint,
  state:function(){ return S; }, busy:function(){ return busy; }, pending:function(){ return Object.keys(S.dirty).length; },
  onChange:function(f){ fns.push(f); }, onApplied:function(f){ appliedFns.push(f); },
  account:account, clientId:function(){ return clientId; },
  signIn:signIn, signOut:signOut, claim:claim, skipClaim:skipClaim
};
RT.onChange(function(){ if(applying) return; if(scan() && configured()) schedule(1500); });
window.addEventListener("online",function(){ fails=0; if(configured()) sync(false); });
document.addEventListener("visibilitychange",function(){ if(!document.hidden && configured() && !busy) sync(false); });
loadConfig();
if(!bootAccount() && configured()) schedule(300);       // sync on load (a new Google account waits for the claim check)
})();
