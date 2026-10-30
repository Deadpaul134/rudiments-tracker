/* Rudiments Tracker v2 – data model, exercise library, storage, migration, import/export.
   Classic script (no modules) so index.html works from file://. Everything hangs off window.RT. */
(function(){
"use strict";
var RT = window.RT = window.RT || {};

var STORE_KEY = "rimon-rudiments-v1";           // same keys as v1 → v1 data is picked up as-is
var KEYS = {
  state: STORE_KEY,
  plan: STORE_KEY+"-plan",
  ui: STORE_KEY+"-ui",
  metro: STORE_KEY+"-metro",
  sync: STORE_KEY+"-sync",
  settings: STORE_KEY+"-settings",
  theme: STORE_KEY+"-theme",
  meta: STORE_KEY+"-v2meta",
  backup: STORE_KEY+"-v1backup",
  premig: STORE_KEY+"-premigration"
};
RT.KEYS = KEYS; RT.STORE_KEY = STORE_KEY;

var BREAKS = ["יד ימין","יד שמאל","עוצמה","צמידות לקצב","מתח בגוף"];
var CATS = [{id:"all",name:"הכול"},{id:"rud",name:"רודימנטים"},{id:"roll",name:"רולים"},{id:"test",name:"מבחנים"}];
var SUBDIVS = ["רבעים","שמיניות","שש-עשריות","טריולות"];
var RATINGS = {clean:"נקי", ok:"סביר", broke:"נשבר"};
RT.BREAKS=BREAKS; RT.CATS=CATS; RT.SUBDIVS=SUBDIVS; RT.RATINGS=RATINGS;

/* sticking notation: R/L = main stroke, r/l = grace note, ">" = accent on next stroke, "z" = buzz,
   space = group separator, "…" = continue. */
function rollSubs(id, right, left, acc){
  var a=[{id:id, name:"בסיסי (מתחיל מימין)", stick:right},{id:id+"_l", name:"מתחיל משמאל", stick:left}];
  if(acc) a.push({id:id+"_acc", name:"עם דגש בסוף", stick:acc});
  return a;
}
var ROLL_HOW = "כל זוג (RR / LL) הוא תנועה אחת: מכה מהשורש ומכה שנייה מהאצבעות. המכה האחרונה – בודדת, נקייה ובאותו גובה.";
var EXERCISES = [
  {id:"single", cat:"rud", name:"סינגל סטרוק", how:"מכות מתחלפות. ידיים רפויות, אותו גובה מקל לשתי הידיים, התנועה מגיעה מפרק כף היד.", subs:[
    {id:"single8",  name:"בסיסי – שמיניות", stick:"R L R L R L R L"},
    {id:"single16", name:"שש-עשריות", stick:"RLRL RLRL"},
    {id:"s_acc4r",  name:"דגש כל 4 (ימין)", stick:">RLRL >RLRL"},
    {id:"s_acc4alt",name:"דגש כל 4 מתחלף", stick:">RLRL >LRLR"},
    {id:"s_acc3",   name:"דגש כל 3 (תחושת טריולה)", stick:">RLR >LRL"}]},
  {id:"double", cat:"rud", name:"דאבל סטרוק", how:"שתי מכות לכל יד. המכה השנייה לא חלשה מהראשונה – שומעים את שתיהן באותה עוצמה.", subs:[
    {id:"double8", name:"בסיסי – שמיניות", stick:"RR LL RR LL"},
    {id:"d_acc2",  name:"דגש על המכה השנייה", stick:"R>R L>L R>R L>L"},
    {id:"d_16",    name:"שש-עשריות", stick:"RRLL RRLL"},
    {id:"d_acc4",  name:"דגש כל 4", stick:">RRLL >RRLL"},
    {id:"d_oco",   name:"פתוח-סגור (איטי→מהיר)", stick:"RR LL …", hint:"מתחילים לאט ופתוח, מאיצים בהדרגה עד רול סגור, וחוזרים לאט"}]},
  {id:"para", cat:"rud", name:"פרדידל", how:"סינגל-סינגל-דאבל. הדגש ברור והמכות הלא מודגשות נמוכות ושקטות.", subs:[
    {id:"para8",    name:"בסיסי – דגש על 1", stick:">RLRR >LRLL"},
    {id:"p_acclast",name:"דגש על המכה האחרונה", stick:"RLR>R LRL>L"},
    {id:"p_double", name:"פרדידל כפול (Double Paradiddle)", stick:">RLRLRR >LRLRLL"},
    {id:"p_pdd",    name:"פרדידל-דידל", stick:">RLRRLL >LRLLRR"},
    {id:"p_inv",    name:"אינברטד פרדידל", stick:"RLLR LRRL"},
    {id:"p_triple", name:"טריפל פרדידל", stick:">RLRLRLRR >LRLRLRLL"}]},
  {id:"flam", cat:"rud", name:"פלאם", how:"תו החן נמוך (2–3 ס\"מ) והמכה הראשית גבוהה. שתי המכות כמעט יחד – צליל אחד עבה, לא \"פלאט\".", subs:[
    {id:"flamR",  name:"יד ימין", stick:"lR lR", hint:"תו חן ביד שמאל ← מכה ביד ימין"},
    {id:"flamL",  name:"יד שמאל", stick:"rL rL", hint:"תו חן ביד ימין ← מכה ביד שמאל"},
    {id:"f_tap",  name:"פלאם טאפ", stick:"lRR rLL"},
    {id:"f_acc",  name:"פלאם אקסנט", stick:"lRLR rLRL", hint:"בטריולות"},
    {id:"f_cue",  name:"פלאמקיו", stick:"lR>LRL lR", hint:"פלאם בהתחלה ובסוף, דגש על המכה השנייה"},
    {id:"f_para", name:"פלאם פרדידל", stick:"lRLRR rLRLL"}]},
  {id:"dragx", cat:"rud", name:"דראג", how:"שתי מכות חן שקטות מאוד (באונס אחד) ממש לפני המכה הראשית. הקישוט לא מכסה את המכה.", subs:[
    {id:"drag",    name:"בסיסי", stick:"llR rrL", hint:"שתי מכות חן מהירות לפני המכה הראשית"},
    {id:"dr_tap",  name:"דראג טאפ (Single Drag Tap)", stick:"llRL rrLR"},
    {id:"dr_l25",  name:"לסון 25 (Lesson 25)", stick:"llRLR …", hint:"דראג + שתי מכות בודדות"},
    {id:"dr_ruff", name:"ראף (4 מכות)", stick:"lrlR rlrL", hint:"3 מכות חן מהירות + מכה ראשית"}]},
  {id:"r_buzz", cat:"roll", name:"באז רול (Multiple Bounce Roll)", how:"כל מכה נלחצת קלות לעור ומקפצת כמה פעמים. המטרה: צליל רציף בלי חורים בין הידיים.", subs:rollSubs("r_buzz","Rz Lz Rz Lz","Lz Rz Lz Rz")},
  {id:"r5",  cat:"roll", name:"רול של 5", how:ROLL_HOW, subs:rollSubs("r5","RRLL R","LLRR L","RRLL >R")},
  {id:"r6",  cat:"roll", name:"רול של 6", how:"דגש – דאבל – דאבל – דגש. שתי המכות המודגשות בודדות.", subs:rollSubs("r6",">R LLRR >L",">L RRLL >R")},
  {id:"r7",  cat:"roll", name:"רול של 7", how:ROLL_HOW, subs:rollSubs("r7","RRLLRR L","LLRRLL R","RRLLRR >L")},
  {id:"r9",  cat:"roll", name:"רול של 9", how:ROLL_HOW, subs:rollSubs("r9","RRLLRRLL R","LLRRLLRR L","RRLLRRLL >R")},
  {id:"r10", cat:"roll", name:"רול של 10", how:ROLL_HOW, subs:rollSubs("r10","RRLLRRLL R L","LLRRLLRR L R","RRLLRRLL >R >L")},
  {id:"r11", cat:"roll", name:"רול של 11", how:ROLL_HOW, subs:rollSubs("r11","RRLLRRLLRR L","LLRRLLRRLL R","RRLLRRLLRR >L")},
  {id:"r13", cat:"roll", name:"רול של 13", how:ROLL_HOW, subs:rollSubs("r13","RRLLRRLLRRLL R","LLRRLLRRLLRR L","RRLLRRLLRRLL >R")},
  {id:"r15", cat:"roll", name:"רול של 15", how:ROLL_HOW, subs:rollSubs("r15","RRLLRRLLRRLLRR L","LLRRLLRRLLRRLL R","RRLLRRLLRRLLRR >L")},
  {id:"r17", cat:"roll", name:"רול של 17", how:ROLL_HOW, subs:rollSubs("r17","RRLLRRLLRRLLRRLL R","LLRRLLRRLLRRLLRR L","RRLLRRLLRRLLRRLL >R")},
  {id:"r_open", cat:"roll", name:"רול פתוח / דאבל סטרוק רול", how:"דאבלים רציפים. לאט – כל מכה מהיד; מהר – המכה השנייה מהאצבעות והקפיצה.", subs:rollSubs("r_open","RRLL RRLL …","LLRR LLRR …").concat([
    {id:"r_open_oco", name:"פתוח-סגור-פתוח", stick:"RRLL …", hint:"מאיצים בהדרגה מפתוח לסגור ומאטים חזרה"}])},
  {id:"r_triple", cat:"roll", name:"רול טריפל סטרוק", how:"שלוש מכות לכל יד באותה עוצמה. בקצב גבוה: מכה ראשונה מהיד ושתיים מהאצבעות.", subs:rollSubs("r_triple","RRR LLL …","LLL RRR …")},
  {id:"tests", cat:"test", name:"מבחני יד אחת ודינמיקה", how:"במבחני יד אחת תמיד לציין חלוקה. השוואת ימין/שמאל נעשית רק בין מדידות באותה חלוקה.", subs:[
    {id:"singleL", name:"יד שמאל בלבד", stick:"LLLL LLLL"},
    {id:"singleR", name:"יד ימין בלבד", stick:"RRRR RRRR"},
    {id:"dyn80",   name:"דאבל דינמיקה (8 שקט / 8 חזק) ב-80", stick:"RRLL RRLL …", hint:"8 מכות שקטות ואז 8 מכות חזקות, ב-80 BPM", fixed:80}]}
];
RT.EXERCISES = EXERCISES;

var GOALS = [
  {id:"flamL",  name:"פלאם יד שמאל", base:120, target:150},
  {id:"drag",   name:"דראג",         base:90,  target:110},
  {id:"double8",name:"דאבל סטרוק",   base:165, target:180}
];
RT.GOALS = GOALS;
RT.GOAL_DATE = new Date(2026,9,30);

// v1 routine (25 min). v2 stores an editable copy in plan.routine2; v1's per-step overrides (plan.routine) are folded in.
var DEFAULT_ROUTINE = [
  {title:"חימום – סינגל סטרוק", desc:"בשקט, ידיים רפויות", min:3, bpm:120, sub:1, link:"single8"},
  {title:"פלאם יד שמאל", desc:"ברבעים · כל 5 פלאמים שמאל – פלאם ימין אחד לתחושה", min:7, bpm:80, sub:1, link:"flamL"},
  {title:"דאבל סטרוק", desc:"בשמיניות, הדגשה על המכה השנייה, ואז רגיל", min:6, bpm:100, sub:2, link:"d_acc2"},
  {title:"דראג", desc:"קישוט שקט מאוד", min:5, bpm:70, sub:1, link:"drag"},
  {title:"פרדידל", desc:"הדגשות ברורות", min:4, bpm:180, sub:1, link:"para8"}
];
RT.DEFAULT_ROUTINE = DEFAULT_ROUTINE;
var DEFAULT_WEEKLY = ["single8","double8","para8","flamR","flamL","drag","singleR","singleL"];

var DEFAULT_SETTINGS = {restSec:15, countIn:4, subClicks:true, measureStart:20, measureStep:5, measureEvery:30,
  metroSound:"click", metroVolume:80, metroLoud:false};
RT.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
RT.METRO_SOUNDS = ["click","cowbell","woodblock","beep"];
// metronome sound settings: unknown / missing / malformed values (older saves) fall back to the defaults
function normMetroSettings(s){
  if(RT.METRO_SOUNDS.indexOf(s.metroSound)<0) s.metroSound=DEFAULT_SETTINGS.metroSound;
  var v=parseFloat(s.metroVolume);
  s.metroVolume = isFinite(v) ? Math.max(0,Math.min(100,Math.round(v))) : DEFAULT_SETTINGS.metroVolume;
  s.metroLoud = s.metroLoud===true;
  return s;
}
RT.normMetroSettings = normMetroSettings;

/* ---------- small helpers ---------- */
function isObj(o){ return !!o && typeof o==="object" && !Array.isArray(o); }
function num(v){ var n=parseFloat(v); return isFinite(n)&&n>0 ? Math.round(n) : null; }
function clampBpm(v){ return Math.max(30,Math.min(300,Math.round(v))); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
function ymd(d){ return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2); }
function hm(d){ return ("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2); }
function dayStart(d){ return new Date(d.getFullYear(),d.getMonth(),d.getDate()); }
function addDays(d,n){ return new Date(d.getFullYear(),d.getMonth(),d.getDate()+n); }
function weekStart(d){ d=dayStart(d); return addDays(d,-d.getDay()); } // Sunday
function dm(d){ return d.getDate()+"."+(d.getMonth()+1); }
function fmtDate(ts, withTime){
  var d=new Date(ts);
  if(isNaN(d)) return String(ts).slice(0,10);
  var s=d.getDate()+"."+(d.getMonth()+1)+"."+String(d.getFullYear()).slice(-2);
  if(withTime) s+=" · "+hm(d);
  return s;
}
function fmtMS(ms){ var t=Math.max(0,Math.ceil(ms/1000)), m=Math.floor(t/60), s=t%60; return (m<10?"0":"")+m+":"+(s<10?"0":"")+s; }
function readJSON(k, dflt){ try{ var v=JSON.parse(localStorage.getItem(k)||"null"); return v==null?dflt:v; }catch(e){ return dflt; } }
function writeJSON(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }
Object.assign(RT, {isObj:isObj,num:num,clampBpm:clampBpm,esc:esc,ymd:ymd,hm:hm,dayStart:dayStart,addDays:addDays,weekStart:weekStart,dm:dm,fmtDate:fmtDate,fmtMS:fmtMS,readJSON:readJSON,writeJSON:writeJSON});

/* ---------- entries ---------- */
function freshState(){ return {__v:2, entries:{}, custom:{}, customEx:[]}; }
function normEntry(x){
  var o={date:String(x.date),clean:num(x.clean),hard:num(x.hard),broke:Array.isArray(x.broke)?x.broke.map(String):[],notes:x.notes?String(x.notes):""};
  if(x.kind==="work"){ o.kind="work"; o.work=num(x.work)||o.clean; o.clean=null; o.hard=null; } // working tempo – never a max
  if(x.subdiv) o.subdiv=String(x.subdiv);
  if(x.rating && RATINGS[x.rating]) o.rating=x.rating;
  if(num(x.breakBpm)) o.breakBpm=num(x.breakBpm);
  if(x.src) o.src=String(x.src);
  return o;
}
function isWork(x){ return !!x && x.kind==="work"; }
function subdivOf(x){ if(!x) return ""; if(x.subdiv) return String(x.subdiv); return /(^|[\s(])ב?רבעים/.test(x.notes||"") ? "רבעים" : ""; }
function sameSubdiv(a,b){ var x=subdivOf(a), y=subdivOf(b); return x===y || (!x && y!=="רבעים") || (!y && x!=="רבעים"); }
RT.isWork=isWork; RT.subdivOf=subdivOf; RT.sameSubdiv=sameSubdiv;

// v1 flat format {subId:[...]} or v2 {__v:2, entries, custom[, customEx]}
function migrate(d, strict){
  var s=freshState();
  if(!isObj(d)) return s;
  var src = d.__v===2 ? (isObj(d.entries)?d.entries:{}) : d;
  Object.keys(src).forEach(function(k){
    if(!Array.isArray(src[k])) return;
    var arr=src[k].filter(function(x){ return isObj(x) && (!strict || x.date); });
    s.entries[k] = strict ? arr.map(normEntry) : arr;
  });
  if(d.__v===2 && isObj(d.custom)){
    Object.keys(d.custom).forEach(function(ex){
      if(!Array.isArray(d.custom[ex])) return;
      s.custom[ex]=d.custom[ex].filter(function(c){ return isObj(c)&&c.id&&c.name; })
        .map(function(c){ var o={id:String(c.id),name:String(c.name),stick:c.stick?String(c.stick):"",custom:true}; if(c.hint) o.hint=String(c.hint); return o; });
    });
  }
  if(d.__v===2 && Array.isArray(d.customEx)){
    s.customEx=d.customEx.filter(function(e){ return isObj(e)&&e.id&&e.name; })
      .map(function(e){ return {id:String(e.id),name:String(e.name),cat:CATS.some(function(c){return c.id===e.cat&&c.id!=="all";})?e.cat:"rud",how:e.how?String(e.how):"",custom:true}; });
  }
  return s;
}
RT.migrate = migrate;

/* ---------- load everything ---------- */
function loadState(){
  var raw=null, d;
  try{ raw=localStorage.getItem(KEYS.state); }catch(e){}
  try{ d=JSON.parse(raw||"{}"); }catch(e){ d={}; }
  var s=migrate(d,false);
  if(raw && isObj(d) && d.__v!==2){ // very old flat format; keep an untouched copy
    try{ if(!localStorage.getItem(KEYS.premig)) localStorage.setItem(KEYS.premig, raw); }catch(e){}
    writeJSON(KEYS.state, s);
  }
  return s;
}
function normPlan(p){
  if(!isObj(p)) p={};
  ["days","steps","kit","sessions","routine"].forEach(function(k){ if(!isObj(p[k])) p[k]={}; });
  if(p.log!==undefined && !Array.isArray(p.log)) delete p.log;
  if(!Array.isArray(p.routine2) || !p.routine2.length) p.routine2=routineFromV1(p.routine);
  else p.routine2=p.routine2.filter(isObj).map(normStep);
  if(!Array.isArray(p.weekly)) p.weekly=DEFAULT_WEEKLY.slice();
  return p;
}
function normStep(s){
  return {title:String(s.title||"שלב"), desc:s.desc?String(s.desc):"", min:Math.max(0.25,Math.min(60,+s.min||1)),
    bpm:clampBpm(num(s.bpm)||80), sub:[1,2,3,4].indexOf(+s.sub)>=0?+s.sub:1, link:typeof s.link==="string"?s.link:""};
}
function routineFromV1(over){
  return DEFAULT_ROUTINE.map(function(r,i){
    var o=normStep(r), c=isObj(over)&&isObj(over[i])?over[i]:null;
    if(c){ if(num(c.bpm)) o.bpm=clampBpm(num(c.bpm)); if(typeof c.link==="string") o.link=c.link; }
    return o;
  });
}
RT.routineFromV1 = routineFromV1;

RT.state = loadState();
RT.plan = normPlan(readJSON(KEYS.plan, {}));
RT.ui = (function(){ var u=readJSON(KEYS.ui,{}); if(!isObj(u)) u={}; if(!isObj(u.open)) u.open={}; if(!isObj(u.tab)) u.tab={}; if(!u.cat) u.cat="rud"; if(!isObj(u.raiseOff)) u.raiseOff={}; return u; })();
RT.settings = normMetroSettings(Object.assign({}, DEFAULT_SETTINGS, (function(){ var s=readJSON(KEYS.settings,{}); return isObj(s)?s:{}; })()));

/* one-time v1 → v2 migration of localStorage (backup of every v1 key, routine conversion) */
(function firstRun(){
  var meta=readJSON(KEYS.meta,null);
  if(isObj(meta) && meta.migrated) { RT.migratedNow=false; return; }
  var had={}, n=0;
  try{
    for(var i=0;i<localStorage.length;i++){
      var k=localStorage.key(i);
      if(k.indexOf(STORE_KEY)!==0 || k===KEYS.meta || k===KEYS.backup) continue;
      had[k]=localStorage.getItem(k); n++;
    }
  }catch(e){}
  if(n){ try{ if(!localStorage.getItem(KEYS.backup)) localStorage.setItem(KEYS.backup, JSON.stringify(had)); }catch(e){} }
  RT.migratedNow = n>0 && !!had[KEYS.state];
  writeJSON(KEYS.plan, RT.plan);
  writeJSON(KEYS.meta, {migrated:true, at:new Date().toISOString(), fromV1:RT.migratedNow});
})();

var listeners=[];
RT.onChange=function(fn){ listeners.push(fn); };
function changed(what){ listeners.forEach(function(fn){ try{ fn(what); }catch(e){ console.error(e); } }); }
RT.changed = changed;

RT.save=function(){ if(!writeJSON(KEYS.state, RT.state) && RT.toast) RT.toast("לא ניתן לשמור בדפדפן הזה – בצע ייצוא נתונים"); changed("state"); };
RT.savePlan=function(){ writeJSON(KEYS.plan, RT.plan); changed("plan"); };
RT.saveUi=function(){ writeJSON(KEYS.ui, RT.ui); };
RT.saveSettings=function(){ writeJSON(KEYS.settings, RT.settings); };

/* ---------- index of subs ---------- */
var SUB={}, EXOF={};
function customOf(exId){ return Array.isArray(RT.state.custom[exId]) ? RT.state.custom[exId] : []; }
function allEx(){ return EXERCISES.concat((RT.state.customEx||[]).map(function(e){ return {id:e.id,cat:e.cat,name:e.name,how:e.how,subs:[],custom:true}; })); }
function allSubs(ex){ return ex.subs.concat(customOf(ex.id)); }
function indexSubs(){ SUB={}; EXOF={}; allEx().forEach(function(ex){ allSubs(ex).forEach(function(s){ SUB[s.id]=s; EXOF[s.id]=ex; }); }); RT.SUB=SUB; RT.EXOF=EXOF; }
indexSubs();
function fullName(id){ var s=SUB[id], ex=EXOF[id]; return s ? ex.name+" · "+s.name : id; }
function catName(id){ for(var i=0;i<CATS.length;i++) if(CATS[i].id===id) return CATS[i].name; return id; }
function allSubIds(){ var a=[]; allEx().forEach(function(ex){ allSubs(ex).forEach(function(s){ a.push(s.id); }); }); return a; }
Object.assign(RT,{customOf:customOf,allEx:allEx,allSubs:allSubs,indexSubs:indexSubs,fullName:fullName,catName:catName,allSubIds:allSubIds});

function entries(id){ return Array.isArray(RT.state.entries[id]) ? RT.state.entries[id] : []; }
function latestClean(id){ var e=entries(id); for(var i=e.length-1;i>=0;i--){ if(e[i]&&e[i].clean&&!isWork(e[i])) return e[i]; } return null; }
function latestWork(id){ var e=entries(id); for(var i=e.length-1;i>=0;i--){ if(isWork(e[i])&&e[i].work) return e[i]; } return null; }
Object.assign(RT,{entries:entries,latestClean:latestClean,latestWork:latestWork});

RT.addEntry=function(id,obj){
  if(!Array.isArray(RT.state.entries[id])) RT.state.entries[id]=[];
  RT.state.entries[id].push(obj);
  RT.save();
  if(RT.sync) RT.sync.entry(id,obj);
  return obj;
};
RT.updateEntry=function(id,obj){ RT.save(); if(RT.sync) RT.sync.entry(id,obj); };
RT.deleteEntry=function(id,obj){
  var arr=entries(id), i=arr.indexOf(obj); if(i<0) return;
  arr.splice(i,1); RT.save(); if(RT.sync) RT.sync.del(id,obj);
};
// working tempo from the routine – never touches clean max
RT.logWork=function(id,bpm,rating,notes){
  var o={date:new Date().toISOString(), kind:"work", work:clampBpm(bpm), clean:null, hard:null, broke:[], notes:notes||"", src:"routine"};
  if(rating) o.rating=rating;
  return RT.addEntry(id,o);
};

/* ---------- rating after the fact (working tempo only – a clean max is never touched) ---------- */
RT.setRating=function(id,x,r){
  if(!x) return false;
  var cur=entries(id).filter(function(e){ return e && e.date===x.date; })[0];   // a sync may have replaced the object
  if(!cur || !isWork(cur)) return false;
  if(r && RATINGS[r]) cur.rating=r; else delete cur.rating;
  if(cur!==x){ if(cur.rating) x.rating=cur.rating; else delete x.rating; }
  RT.updateEntry(id,cur);
  return true;
};
// routine steps from the last `days` days (today included) that were never rated, newest first
RT.unrated=function(days){
  var since=addDays(dayStart(new Date()),-((days||7)-1)), out=[];
  Object.keys(RT.state.entries).forEach(function(id){
    entries(id).forEach(function(x){
      if(!isWork(x) || x.rating || x.src!=="routine") return;
      var d=new Date(x.date); if(!isNaN(d) && d>=since) out.push({id:id, x:x});
    });
  });
  return out.sort(function(a,b){ return new Date(b.x.date)-new Date(a.x.date); });
};

/* ---------- clean streak → optional +4 BPM target suggestion (only ever applied by the user) ---------- */
var RAISE_AFTER=3, RAISE_BY=4;
RT.RAISE_AFTER=RAISE_AFTER; RT.RAISE_BY=RAISE_BY;
// consecutive "clean" ratings at this BPM, newest first; unrated work entries and max measurements don't break it
RT.cleanStreak=function(id,bpm){
  var e=entries(id), n=0;
  for(var i=e.length-1;i>=0;i--){
    var x=e[i]; if(!isWork(x) || !x.rating) continue;
    if(x.rating!=="clean" || +x.work!==+bpm) break;
    n++;
  }
  return n;
};
RT.raiseSuggestion=function(i){
  var s=RT.plan.routine2[i], link=RT.stepLink(i);
  if(!s || !link || s.bpm+RAISE_BY>300) return null;
  if(RT.ui.raiseOff[link+"@"+s.bpm]) return null;
  return RT.cleanStreak(link,s.bpm)>=RAISE_AFTER ? {link:link, from:s.bpm, to:s.bpm+RAISE_BY} : null;
};
RT.dismissRaise=function(link,bpm){ RT.ui.raiseOff[link+"@"+bpm]=1; RT.saveUi(); };

/* ---------- routine ---------- */
RT.routine=function(){ return RT.plan.routine2; };
RT.stepLink=function(i){ var l=(RT.plan.routine2[i]||{}).link; return l && SUB[l] ? l : ""; };
RT.setStepBpm=function(i,v){ var s=RT.plan.routine2[i]; if(!s) return; s.bpm=clampBpm(v); RT.savePlan(); };
RT.routineMinutes=function(){ return RT.plan.routine2.reduce(function(a,s){ return a+s.min; },0); };
function subName(v){ return v===2?"שמיניות":v===3?"טריולות":v===4?"שש-עשריות":"רבעים"; }
RT.subName=subName;

/* ---------- goals, hands, streak ---------- */
RT.goalProgress=function(g){
  var x=latestClean(g.id), cur=x?x.clean:null;
  var p = cur==null ? 0 : (cur-g.base)/(g.target-g.base);
  p=Math.max(0,Math.min(1,p));
  return {cur:cur, entry:x, pct:Math.round(p*100), done:cur!=null&&cur>=g.target};
};
// left vs right hand: only compare max results played in the same subdivision; quarter notes never compared
RT.handGap=function(){
  var lE=latestClean("singleL"), rE=latestClean("singleR");
  if(!lE||!rE) return null;
  function pick(id){ var e=entries(id); for(var i=e.length-1;i>=0;i--){ var x=e[i]; if(x&&x.clean&&!isWork(x)&&subdivOf(x)!=="רבעים") return x; } return null; }
  var l=pick("singleL"), r=pick("singleR");
  if(l&&r&&sameSubdiv(l,r)) return {l:l.clean, r:r.clean, d:r.clean-l.clean, sub:subdivOf(l)||subdivOf(r), older:(l!==lE||r!==rE)};
  return {na:true, l:lE.clean, r:rE.clean, lSub:subdivOf(lE)||"לא צוין", rSub:subdivOf(rE)||"לא צוין"};
};
RT.streak=function(){
  var d=dayStart(new Date()), n=0;
  if(!RT.plan.days[ymd(d)]) d=addDays(d,-1);
  while(RT.plan.days[ymd(d)]){ n++; d=addDays(d,-1); }
  return n;
};
RT.weekCount=function(){ var ws=weekStart(new Date()), c=0; for(var i=0;i<7;i++) if(RT.plan.days[ymd(addDays(ws,i))]) c++; return c; };

/* ---------- sessions ---------- */
RT.logSession=function(kind, minutes, steps, notes){
  var d=new Date();
  var row={id:"s_"+d.getTime().toString(36)+Math.random().toString(36).slice(2,5), date:ymd(d), ts:ymd(d)+" "+hm(d),
    minutes:Math.max(0,Math.round(minutes)||0), steps:steps||"", notes:notes||"", kind:kind};
  if(!Array.isArray(RT.plan.log)) RT.plan.log=[];
  RT.plan.log.push(row); if(RT.plan.log.length>1000) RT.plan.log=RT.plan.log.slice(-1000);
  RT.savePlan();
  if(RT.sync) RT.sync.session(row);
  return row;
};

/* ---------- text summary (for the mentor) ---------- */
RT.buildTextSummary=function(){
  var lines=[], any=false;
  lines.push("סיכום רודימנטים – "+fmtDate(new Date()));
  CATS.forEach(function(cat){
    if(cat.id==="all") return;
    var catLines=[];
    allEx().filter(function(ex){ return ex.cat===cat.id; }).forEach(function(ex){
      var sl=[];
      allSubs(ex).forEach(function(sb){
        var x=latestClean(sb.id), w=latestWork(sb.id); if(!x && !w) return;
        var t;
        if(x){
          t="   • "+sb.name+": נקי "+x.clean+" BPM"+(x.hard?", קשה ב-"+x.hard+" BPM":"")+(x.breakBpm?", נשבר ב-"+x.breakBpm:"");
          if(subdivOf(x)) t+=" ["+subdivOf(x)+"]";
          if(x.broke&&x.broke.length) t+=" | נשבר ב: "+x.broke.join(", ");
          t+=" ("+fmtDate(x.date)+")";
          if(w) t+=" | טמפו עבודה אחרון: "+w.work+(w.rating?" ("+RATINGS[w.rating]+")":"")+" ("+fmtDate(w.date)+")";
        } else t="   • "+sb.name+": טמפו עבודה "+w.work+(w.rating?" ("+RATINGS[w.rating]+")":"")+" BPM ("+fmtDate(w.date)+") – עדיין אין מדידת מקסימום";
        sl.push(t);
      });
      if(sl.length){ catLines.push(ex.name+":"); catLines=catLines.concat(sl); }
    });
    if(catLines.length){ any=true; lines.push(""); lines.push("["+cat.name+"]"); lines=lines.concat(catLines); }
  });
  if(!any){ lines.push(""); lines.push("עדיין אין מדידות."); }
  var g=RT.handGap();
  if(g){ lines.push(""); lines.push("פער ידיים: "+(g.na ? "לא בר-השוואה – ימין "+g.r+" ("+g.rSub+") / שמאל "+g.l+" ("+g.lSub+")" : "ימין "+g.r+" / שמאל "+g.l+(g.d? " – הפרש של "+Math.abs(g.d)+" BPM לטובת "+(g.d>0?"ימין":"שמאל") : " – אין פער")+(g.sub?" ("+g.sub+")":""))); }
  lines.push(""); lines.push("יעדים עד 30.10:");
  GOALS.forEach(function(g){ var pr=RT.goalProgress(g); lines.push("• "+g.name+": "+g.base+" ← "+g.target+" | עכשיו "+(pr.cur!=null?pr.cur:"—")+" ("+pr.pct+"%)"); });
  lines.push("ימי תרגול השבוע: "+RT.weekCount()+"/7 · רצף: "+RT.streak());
  return lines.join("\n");
};

/* ---------- export / import ---------- */
RT.exportPayload=function(){ return {app:"rimon-rudiments", version:3, exported:new Date().toISOString(), data:RT.state, plan:RT.plan}; };
// parse a v1 or v2 export (or a raw state object). Returns {inc, plan, n, nc} or throws.
RT.parseImport=function(text){
  var j=JSON.parse(text), d=(isObj(j)&&isObj(j.data))?j.data:j;
  if(!isObj(d)) throw new Error("bad");
  var inc=migrate(d,true), n=0, nc=0;
  Object.keys(inc.entries).forEach(function(k){ n+=inc.entries[k].length; });
  Object.keys(inc.custom).forEach(function(k){ nc+=inc.custom[k].length; });
  nc+=inc.customEx.length;
  if(!n && !nc) throw new Error("empty");
  return {inc:inc, plan:isObj(j)&&isObj(j.plan)?j.plan:null, n:n, nc:nc};
};
RT.applyImport=function(p, replace){
  var inc=p.inc, st=RT.state;
  if(replace){ st.entries=inc.entries; st.custom=inc.custom; st.customEx=inc.customEx; }
  else {
    Object.keys(inc.entries).forEach(function(k){
      var seen={}; entries(k).forEach(function(x){seen[x.date]=1;});
      st.entries[k]=entries(k).concat(inc.entries[k].filter(function(x){return !seen[x.date];}))
        .sort(function(a,b){return new Date(a.date)-new Date(b.date);});
    });
    Object.keys(inc.custom).forEach(function(ex){
      var have={}; customOf(ex).forEach(function(c){have[c.id]=1;});
      st.custom[ex]=customOf(ex).concat(inc.custom[ex].filter(function(c){return !have[c.id];}));
    });
    var hx={}; (st.customEx||[]).forEach(function(e){ hx[e.id]=1; });
    st.customEx=(st.customEx||[]).concat(inc.customEx.filter(function(e){ return !hx[e.id]; }));
  }
  if(p.plan){
    var ip=p.plan, pl=RT.plan;
    ["days","steps","kit","sessions"].forEach(function(k){
      if(!isObj(ip[k])) return;
      if(replace) pl[k]=JSON.parse(JSON.stringify(ip[k])); else Object.keys(ip[k]).forEach(function(d){ if(pl[k][d]==null) pl[k][d]=ip[k][d]; });
    });
    if(Array.isArray(ip.routine2) && ip.routine2.length) pl.routine2=ip.routine2.filter(isObj).map(normStep);
    else if(isObj(ip.routine) && Object.keys(ip.routine).length){ pl.routine=JSON.parse(JSON.stringify(ip.routine)); pl.routine2=routineFromV1(pl.routine); }
    if(Array.isArray(ip.log)){
      var have={}; (pl.log||[]).forEach(function(r){ have[r.id]=1; });
      pl.log=(replace?[]:(pl.log||[])).concat(ip.log.filter(function(r){ return isObj(r)&&r.id&&(replace||!have[r.id]); }));
    }
    if(Array.isArray(ip.weekly)) pl.weekly=ip.weekly.filter(function(x){ return typeof x==="string"; });
  }
  indexSubs(); RT.save(); RT.savePlan();
};

/* ---------- one-time data fix (17.10.2026, ported from v1) ---------- */
function onDay(x,a,b){ var d=new Date(x.date); if(isNaN(d)) return false; var k=ymd(d); return k>=a && k<=b; }
RT.fixPlan=function(){
  var d8=entries("double8").filter(function(x){ return !isWork(x) && x.clean===110 && onDay(x,"2026-10-15","2026-10-17"); });
  var dr=entries("drag").filter(function(x){ return !isWork(x) && x.clean===70 && onDay(x,"2026-10-15","2026-10-17"); });
  function has(id,c){ return entries(id).some(function(x){ return !isWork(x) && x.clean===c && onDay(x,"2026-10-17","2026-10-17"); }); }
  var add=[]; if(!has("s_acc4r",110)) add.push("s_acc4r"); if(!has("singleL",120)) add.push("singleL");
  var base=entries("single8").some(function(x){ return x.clean===225 && onDay(x,"2026-10-16","2026-10-16"); });
  return {d8:d8, dr:dr, add:add, show: d8.length>0 || dr.length>0 || (add.length>0 && base)};
};
RT.applyFix=function(){
  var f=RT.fixPlan(), st=RT.state;
  try{ if(!localStorage.getItem(STORE_KEY+"-prefix1710")) localStorage.setItem(STORE_KEY+"-prefix1710", JSON.stringify(st)); }catch(e){}
  function sortE(id){ st.entries[id].sort(function(a,b){ return new Date(a.date)-new Date(b.date); }); }
  function ensure(id){ if(!Array.isArray(st.entries[id])) st.entries[id]=[]; }
  if(f.d8.length){
    st.entries.double8=entries("double8").filter(function(x){ return f.d8.indexOf(x)<0; });
    ensure("d_acc2");
    f.d8.forEach(function(x){ if(!entries("d_acc2").some(function(y){ return !isWork(y)&&y.clean===110; }))
      st.entries.d_acc2.push({date:x.date, clean:110, hard:x.hard||120, broke:x.broke||[], notes:"דגש על המכה השנייה (תוקן: נרשם בטעות כדאבל בסיסי)"}); });
    sortE("d_acc2");
  }
  if(f.d8.length || f.dr.length){
    ensure("double8");
    if(!entries("double8").some(function(x){ return !isWork(x)&&x.clean===165; })) st.entries.double8.push({date:"2026-10-16T13:18:40.028Z", clean:165, hard:180, broke:[], notes:""});
    sortE("double8");
  }
  if(f.dr.length){
    st.entries.drag=entries("drag").map(function(x){ return f.dr.indexOf(x)<0 ? x :
      {date:x.date, kind:"work", work:70, clean:null, hard:null, broke:x.broke||[], notes:((x.notes?x.notes+" · ":"")+"תוקן: טמפו עבודה, לא מקסימום")}; });
    if(!entries("drag").some(function(x){ return !isWork(x)&&x.clean===90; })) st.entries.drag.push({date:"2026-10-16T13:34:42.760Z", clean:90, hard:100, broke:[], notes:""});
    sortE("drag");
  }
  if(f.add.indexOf("s_acc4r")>=0){ ensure("s_acc4r"); st.entries.s_acc4r.push({date:"2026-10-17T11:00:00.000Z", clean:110, hard:120, broke:[], notes:"מדידה 17.10 – שש-עשריות, דגש כל 4 (ימין)"}); sortE("s_acc4r"); }
  if(f.add.indexOf("singleL")>=0){ ensure("singleL"); st.entries.singleL.push({date:"2026-10-17T11:05:00.000Z", clean:120, hard:130, broke:[], notes:"מדידה חוזרת 17.10"}); sortE("singleL"); }
  ["singleL","singleR"].forEach(function(id){ entries(id).forEach(function(x){ if(!x.subdiv && subdivOf(x)==="רבעים") x.subdiv="רבעים"; }); });
  RT.ui.fix1710="done"; RT.saveUi(); RT.save();
};
})();
