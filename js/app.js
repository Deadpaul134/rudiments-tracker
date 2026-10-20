/* Screens: router, home, progress, library, settings, theme, focus mode, keyboard, dialogs. */
(function(){
"use strict";
var RT = window.RT, esc = RT.esc, P = RT.P, M = RT.M;
function $(id){ return document.getElementById(id); }
function el(tag, attrs, html){
  var n=document.createElement(tag);
  if(attrs) for(var k in attrs){ if(k==="class") n.className=attrs[k]; else n.setAttribute(k,attrs[k]); }
  if(html!=null) n.innerHTML=html;
  return n;
}
var CHECK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
var DAY_LETTERS=["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];

/* ======================= theme ======================= */
function themePref(){ var t=RT.readJSON(RT.KEYS.theme,"system"); return t==="light"||t==="dark"?t:"system"; }
var mq=window.matchMedia?matchMedia("(prefers-color-scheme: dark)"):null;
function applyTheme(){
  var t=themePref(), dark=t==="dark"||(t==="system"&&mq&&mq.matches);
  document.documentElement.setAttribute("data-theme",dark?"dark":"light");
  var meta=document.querySelector('meta[name="theme-color"]'); if(meta) meta.content=dark?"#2a221d":"#f6f0e8";
  document.querySelectorAll("#themeSeg [data-theme-v]").forEach(function(b){ var on=b.dataset.themeV===t; b.classList.toggle("on",on); b.setAttribute("aria-checked",String(on)); });
  $("themeBtn").setAttribute("aria-pressed",String(dark));
  $("themeBtn").title=dark?"מעבר לבהיר":"מעבר לכהה";
  if(document.querySelector("#pgChart")) renderChart();
}
function setTheme(t){ RT.writeJSON(RT.KEYS.theme,t); applyTheme(); }
RT.setTheme=setTheme;
$("themeBtn").addEventListener("click",function(){ setTheme(document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark"); });
document.querySelectorAll("#themeSeg [data-theme-v]").forEach(function(b){ b.addEventListener("click",function(){ setTheme(b.dataset.themeV); }); });
if(mq){ var onMq=function(){ if(themePref()==="system") applyTheme(); }; if(mq.addEventListener) mq.addEventListener("change",onMq); else if(mq.addListener) mq.addListener(onMq); }

/* ======================= router ======================= */
var ROUTES=["home","practice","measure","progress","library","settings"];
var route="home";
function go(){
  var h=(location.hash||"#home").slice(1).split("?")[0];
  if(ROUTES.indexOf(h)<0) h="home";
  route=h;
  document.querySelectorAll(".screen").forEach(function(s){ s.hidden=s.dataset.screen!==h; });
  var navKey=h==="measure"?"practice":h;
  document.querySelectorAll(".nav-i").forEach(function(a){ var on=a.dataset.route===navKey; a.classList.toggle("on",on); if(on) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  renderRoute();
  $("main").scrollTop=0; window.scrollTo(0,0);
}
function renderRoute(){
  if(route==="home") renderHome();
  else if(route==="practice"){ RT.practice.render(); RT.practice.renderSteps(); }
  else if(route==="measure") RT.measure.render();
  else if(route==="progress") renderProgress();
  else if(route==="library") renderLibrary();
  else if(route==="settings") renderSettings();
}
window.addEventListener("hashchange",go);
RT.go=function(r){ if(location.hash==="#"+r) go(); else location.hash=r; };

/* ======================= home ======================= */
var wkOffset=0;
function renderHome(){
  var steps=RT.routine(), key=RT.ymd(new Date()), done=Array.isArray(RT.plan.steps[key])?RT.plan.steps[key]:[];
  var nd=done.filter(function(i){ return steps[i]; }).length;
  $("homePlanLine").textContent="היום: "+RT.routineMinutes()+" דקות מתוכננות · "+steps.length+" שלבים";
  $("homeRingN").textContent=nd+"/"+steps.length;
  var C=2*Math.PI*52, ring=$("homeRing"); ring.style.strokeDasharray=C.toFixed(1); ring.style.strokeDashoffset=(C*(1-(steps.length?nd/steps.length:0))).toFixed(1);
  $("heroSub").textContent = RT.practice.active() ? "יש שגרה פעילה – לחץ כדי לחזור אליה" : nd>=steps.length ? "השגרה של היום הושלמה ✓ אפשר לתרגל שוב" : "ספירה של 4, מטרונום וטיימר לכל שלב, ומעבר אוטומטי לשלב הבא";
  $("startToday").lastChild.textContent = RT.practice.active() ? "חזרה לתרגול" : "התחל תרגול של היום";
  $("stStreak").textContent=RT.streak();
  $("stWeek").textContent=RT.weekCount()+"/7";
  var left=Math.round((RT.GOAL_DATE-RT.dayStart(new Date()))/864e5);
  $("stLeft").textContent=left>=0?left:"—";
  $("planMeta").textContent=nd+"/"+steps.length+" הושלמו";
  var ol=$("todayPlan"); ol.innerHTML="";
  steps.forEach(function(s,i){
    var on=done.indexOf(i)>=0, link=RT.stepLink(i), lw=link&&RT.latestWork(link);
    var li=el("li",{"class":on?"done":""});
    li.innerHTML='<span class="tick">'+CHECK+'</span><span class="pl-t"><b>'+esc(s.title)+'</b><small class="muted">'+s.min+" דק' · "+RT.subName(s.sub)+(lw?" · עבודה אחרונה "+lw.work+(lw.rating?" ("+RT.RATINGS[lw.rating]+")":""):"")+'</small></span><span class="pl-bpm">'+s.bpm+'<small>BPM</small></span>';
    ol.appendChild(li);
  });
  renderWeek();
  $("homeGoals").innerHTML=RT.GOALS.map(function(g){
    var pr=RT.goalProgress(g);
    return '<div class="gm'+(pr.done?" done":"")+'"><div class="gm-h"><b>'+esc(g.name)+'</b><span>'+(pr.cur!=null?pr.cur:"—")+' / '+g.target+'</span></div><div class="bar"><i style="width:'+pr.pct+'%"></i></div></div>';
  }).join("");
  var today=RT.dayStart(new Date()), dow=today.getDay(), ws=RT.weekStart(today);
  var list=RT.plan.weekly.filter(function(x){ return RT.SUB[x]; }), measured=list.filter(function(id){ var lc=RT.latestClean(id); return lc && new Date(lc.date)>=ws; }).length;
  $("measureTag").textContent = dow===0 ? "היום" : "יום ראשון "+RT.dm(RT.addDays(today,7-dow));
  $("measureTag").classList.toggle("hot",dow===0);
  $("measureText").textContent = measured+"/"+list.length+" נמדדו השבוע. הטמפו עולה אוטומטית ואתה רק מסמן מתי נהיה קשה ומתי נשבר.";
  renderFix();
}
function renderWeek(){
  var box=$("week"), today=RT.dayStart(new Date()), ws=RT.addDays(RT.weekStart(today),7*wkOffset), cnt=0;
  box.innerHTML="";
  for(var i=0;i<7;i++){
    (function(d){
      var k=RT.ymd(d), on=!!RT.plan.days[k], fut=d>today;
      if(on) cnt++;
      var b=el("button",{"type":"button","class":"day"+(on?" on":"")+(+d===+today?" today":"")+(d.getDay()===0?" sun":""),"data-date":k,"aria-pressed":String(on),"aria-label":"יום "+DAY_LETTERS[d.getDay()]+" "+RT.dm(d)+(on?" – תורגל":"")});
      if(fut) b.disabled=true;
      b.innerHTML='<span class="dn">'+DAY_LETTERS[d.getDay()]+'</span><span class="dd">'+RT.dm(d)+'</span><span class="dc">'+CHECK+'</span>';
      b.addEventListener("click",function(){ if(RT.plan.days[k]) delete RT.plan.days[k]; else RT.plan.days[k]=1; RT.savePlan(); renderHome(); });
      box.appendChild(b);
    })(RT.addDays(ws,i));
  }
  $("wkRange").textContent = wkOffset===0 ? "השבוע" : RT.dm(ws)+"–"+RT.dm(RT.addDays(ws,6));
  $("wkNext").disabled = wkOffset>=0;
  $("wkFoot").innerHTML='<b>'+cnt+'</b> / 7 ימים · יעד 5–6'+(cnt>=5?' ✓':'')+' · יום ראשון = מדידה';
}
$("wkPrev").addEventListener("click",function(){ wkOffset--; renderWeek(); });
$("wkNext").addEventListener("click",function(){ if(wkOffset<0){ wkOffset++; renderWeek(); } });
$("startToday").addEventListener("click",function(){
  if(!RT.practice.active()){
    var steps=RT.routine(), done=RT.plan.steps[RT.ymd(new Date())]||[], first=0;
    for(var i=0;i<steps.length;i++){ if(done.indexOf(i)<0){ first=i; break; } }
    RT.go("practice"); RT.practice.start(done.length>=steps.length?0:first);
  } else RT.go("practice");
});
function renderFix(){
  var bar=$("fixBar"), f=RT.fixPlan(), u=RT.ui.fix1710;
  if((u==="done" && !f.d8.length && !f.dr.length) || !f.show || u==="later"){ bar.hidden=true; return; }
  var t=[];
  if(f.d8.length) t.push("דאבל בסיסי 110 ← היה דאבל עם דגש על המכה השנייה (המקסימום האמיתי: 165)");
  if(f.dr.length) t.push("דראג 70 ← טמפו עבודה, לא מקסימום (המקסימום האמיתי: 90)");
  if(f.add.length) t.push("להוסיף את המדידות מ-17.10");
  $("fixText").innerHTML="<b>תיקון נתונים:</b> "+t.map(esc).join(" · ")+". לפני התיקון נשמר גיבוי.";
  bar.hidden=false;
}
$("fixApply").addEventListener("click",function(){ RT.applyFix(); RT.sync.full(); renderRoute(); RT.toast("הנתונים תוקנו ✓"); });
$("fixLater").addEventListener("click",function(){ RT.ui.fix1710="later"; RT.saveUi(); renderFix(); });

/* ======================= progress ======================= */
function cssVar(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
var pg={ex:null, sub:null};
function measuredSubs(){ return RT.allSubIds().filter(function(id){ return RT.entries(id).length; }); }
function renderProgress(){
  $("goals").innerHTML=RT.GOALS.map(function(g){
    var pr=RT.goalProgress(g);
    var foot = pr.cur==null ? '<span>עדיין אין מדידה</span><span>חסרים <b>'+(g.target-g.base)+'</b> BPM</span>'
      : '<span>אחרון <b>'+pr.cur+'</b> · '+RT.fmtDate(pr.entry.date)+'</span>'+(pr.done?'<span class="good">היעד הושג ✓</span>':'<span>עוד <b>'+Math.max(0,g.target-pr.cur)+'</b> BPM</span>');
    return '<div class="card goal'+(pr.done?" done":"")+'" data-goal="'+g.id+'"><div class="goal-top"><div><h3>'+esc(g.name)+'</h3><div class="muted small">'+esc(RT.fullName(g.id))+'</div></div><div class="pct">'+pr.pct+'%</div></div>'+
      '<div class="goal-path"><span>'+g.base+'</span><span class="muted">←</span><b>'+g.target+'</b><small class="muted">BPM</small></div>'+
      '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+pr.pct+'" aria-label="התקדמות '+esc(g.name)+'"><i style="width:'+pr.pct+'%"></i></div><div class="goal-foot muted small">'+foot+'</div></div>';
  }).join("");
  // hands
  var g=RT.handGap(), hb=$("handBody");
  if(!g) hb.innerHTML='<p class="muted">צריך מדידות של „יד ימין בלבד” ו„יד שמאל בלבד” (מבחנים) באותה חלוקה.</p>';
  else if(g.na) hb.innerHTML='<div class="hand-na"><b>לא בר-השוואה</b><p class="muted small">ימין '+g.r+' ('+esc(g.rSub)+') · שמאל '+g.l+' ('+esc(g.lSub)+'). משווים רק מדידות באותה חלוקה – ומדידות ברבעים לא נספרות. כדאי למדוד את שתי הידיים באותה חלוקה.</p></div>';
  else {
    var mx=Math.max(g.l,g.r);
    hb.innerHTML='<div class="hands"><div class="hand"><span>ימין</span><div class="bar"><i style="width:'+(g.r/mx*100)+'%"></i></div><b>'+g.r+'</b></div><div class="hand"><span>שמאל</span><div class="bar"><i style="width:'+(g.l/mx*100)+'%"></i></div><b>'+g.l+'</b></div></div>'+
      '<p class="small"><b>'+(g.d===0?"אין פער":Math.abs(g.d)+" BPM לטובת "+(g.d>0?"ימין":"שמאל"))+'</b> <span class="muted">· '+(g.sub?esc(g.sub):"חלוקה לא צוינה")+(g.older?" · לפי המדידות האחרונות באותה חלוקה":"")+'</span></p>';
  }
  // selectors
  var exs=RT.allEx().filter(function(ex){ return RT.allSubs(ex).length; });
  if(!pg.sub || !RT.SUB[pg.sub]){ var ms=measuredSubs(); pg.sub=ms.indexOf("flamL")>=0?"flamL":(ms[0]||"single8"); }
  pg.ex=RT.EXOF[pg.sub].id;
  $("pgEx").innerHTML=exs.map(function(ex){ var n=RT.allSubs(ex).filter(function(s){ return RT.entries(s.id).length; }).length;
    return '<option value="'+esc(ex.id)+'"'+(ex.id===pg.ex?" selected":"")+'>'+esc(ex.name)+(n?" ("+n+")":"")+'</option>'; }).join("");
  var ex=RT.EXOF[pg.sub];
  $("pgSubs").innerHTML=RT.allSubs(ex).map(function(s){ var lc=RT.latestClean(s.id);
    return '<button type="button" class="chip'+(s.id===pg.sub?" on":"")+'" role="tab" aria-selected="'+(s.id===pg.sub)+'" data-sub="'+esc(s.id)+'">'+esc(s.name)+(lc?' <b>'+lc.clean+'</b>':'')+'</button>'; }).join("");
  $("pgSubs").querySelectorAll("[data-sub]").forEach(function(b){ b.addEventListener("click",function(){ pg.sub=b.dataset.sub; renderProgress(); }); });
  renderChart(); renderHist();
  // minis
  var ms2=measuredSubs();
  $("pgMinis").innerHTML = ms2.length ? ms2.map(function(id){ var lc=RT.latestClean(id), lw=RT.latestWork(id);
    return '<button type="button" class="mini'+(id===pg.sub?" on":"")+'" data-sub="'+esc(id)+'"><span class="mini-n">'+esc(RT.fullName(id))+'</span><span class="mini-v">'+(lc?lc.clean:"—")+'</span><span class="muted small">'+(lc?"מקס נקי":"")+(lw?" · עבודה "+lw.work:"")+'</span>'+spark(id)+'</button>'; }).join("")
    : '<p class="muted">עדיין אין מדידות.</p>';
  $("pgMinis").querySelectorAll("[data-sub]").forEach(function(b){ b.addEventListener("click",function(){ pg.sub=b.dataset.sub; renderProgress(); $("pgChart").scrollIntoView({block:"nearest"}); }); });
}
$("pgEx").addEventListener("change",function(){
  var ex=RT.allEx().filter(function(x){ return x.id===$("pgEx").value; })[0]; if(!ex) return;
  var subs=RT.allSubs(ex), withData=subs.filter(function(s){ return RT.entries(s.id).length; });
  pg.sub=(withData[0]||subs[0]).id; renderProgress();
});
function spark(id){
  var pts=RT.entries(id).filter(function(x){ return !RT.isWork(x)&&x.clean; }).map(function(x){ return x.clean; });
  if(pts.length<2) return '<svg class="spark" viewBox="0 0 100 24"></svg>';
  var mn=Math.min.apply(null,pts), mx=Math.max.apply(null,pts); if(mx===mn){ mx+=1; mn-=1; }
  var d=pts.map(function(v,i){ return (i/(pts.length-1)*100).toFixed(1)+","+(22-(v-mn)/(mx-mn)*20).toFixed(1); }).join(" ");
  return '<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none"><polyline points="'+d+'" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
}
function renderChart(){
  var box=$("pgChart"); if(!box||!pg.sub) return;
  var e=RT.entries(pg.sub).filter(function(x){ return x && (x.clean||x.hard||x.work); });
  if(!e.length){ box.innerHTML='<div class="empty">אין עדיין נתונים לתת-התרגיל הזה</div>'; return; }
  var W=640,H=240,pl=40,pr=16,pt=16,pb=30;
  var vals=[]; e.forEach(function(x){ [x.clean,x.hard,x.work].forEach(function(v){ if(v) vals.push(v); }); });
  var mn=Math.min.apply(null,vals), mx=Math.max.apply(null,vals);
  if(mx-mn<20){ mn-=10; mx+=10; } var pad=(mx-mn)*.1; mn=Math.max(0,Math.floor(mn-pad)); mx=Math.ceil(mx+pad);
  var t0=new Date(e[0].date).getTime(), t1=new Date(e[e.length-1].date).getTime(), span=Math.max(1,t1-t0), n=e.length;
  // time runs right→left (RTL): newest on the left
  var xl=pl+18, xr=W-pr-18;
  function X(x,i){ if(n===1) return (xl+xr)/2; var t=new Date(x.date).getTime(); var f=isNaN(t)?i/(n-1):(t-t0)/span; return xr-f*(xr-xl); }
  function Y(v){ return pt+(1-(v-mn)/(mx-mn))*(H-pt-pb); }
  var line=cssVar("--line"), dim=cssVar("--dim"), acc=cssVar("--accent"), hard=cssVar("--bad"), card=cssVar("--card");
  var rc={clean:cssVar("--good"), ok:cssVar("--warn"), broke:cssVar("--bad")};
  var s='<svg viewBox="0 0 '+W+' '+H+'" direction="ltr" style="direction:ltr" role="img" aria-label="גרף BPM לאורך זמן: '+esc(RT.fullName(pg.sub))+'">';
  for(var k=0;k<=4;k++){ var v=mn+(mx-mn)*k/4, y=Y(v); s+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+y.toFixed(1)+'" y2="'+y.toFixed(1)+'" stroke="'+line+'" stroke-width="1"/><text x="'+(pl-6)+'" y="'+(y+4).toFixed(1)+'" fill="'+dim+'" font-size="11" text-anchor="end">'+Math.round(v)+'</text>'; }
  function pts(key){ var a=[]; e.forEach(function(x,i){ if(!RT.isWork(x)&&x[key]) a.push([X(x,i),Y(x[key])]); }); return a; }
  var c=pts("clean"), h=pts("hard");
  if(h.length>1) s+='<polyline points="'+h.map(function(p){return p.join(",");}).join(" ")+'" fill="none" stroke="'+hard+'" stroke-opacity=".6" stroke-width="2" stroke-dasharray="5 4"/>';
  if(c.length>1) s+='<polyline points="'+c.map(function(p){return p.join(",");}).join(" ")+'" fill="none" stroke="'+acc+'" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>';
  h.forEach(function(p){ s+='<circle cx="'+p[0]+'" cy="'+p[1]+'" r="3.5" fill="'+hard+'" fill-opacity=".7"/>'; });
  c.forEach(function(p){ s+='<circle cx="'+p[0]+'" cy="'+p[1]+'" r="5" fill="'+acc+'" stroke="'+card+'" stroke-width="2"/>'; });
  e.forEach(function(x,i){ if(RT.isWork(x)&&x.work){ var col=rc[x.rating]||dim; s+='<rect x="'+(X(x,i)-4)+'" y="'+(Y(x.work)-4)+'" width="8" height="8" rx="2" fill="'+col+'" transform="rotate(45 '+X(x,i)+' '+Y(x.work)+')"><title>טמפו עבודה '+x.work+(x.rating?" · "+RT.RATINGS[x.rating]:"")+'</title></rect>'; } });
  s+='<text x="'+xr+'" y="'+(H-8)+'" fill="'+dim+'" font-size="11" text-anchor="middle">'+RT.fmtDate(e[0].date)+'</text>';
  if(n>1) s+='<text x="'+xl+'" y="'+(H-8)+'" fill="'+dim+'" font-size="11" text-anchor="middle">'+RT.fmtDate(e[n-1].date)+'</text>';
  box.innerHTML=s+'</svg>';
}
function renderHist(){
  var ul=$("pgHist"), id=pg.sub, e=RT.entries(id);
  ul.innerHTML = e.length ? "" : '<li class="muted">אין היסטוריה</li>';
  e.slice().reverse().forEach(function(x){
    var w=RT.isWork(x), sd=RT.subdivOf(x), li=el("li",{"class":w?"work":"max"});
    li.innerHTML='<span class="kind">'+(w?"טמפו עבודה":"מקס נקי")+'</span>'+
      '<span class="h-v">'+(w?'<b>'+x.work+'</b>'+(x.rating?' <span class="badge rt-'+x.rating+'">'+RT.RATINGS[x.rating]+'</span>':'')
        :'נקי <b>'+(x.clean||"—")+'</b> · קשה <b>'+(x.hard||"—")+'</b>'+(x.breakBpm?' · נשבר <b>'+x.breakBpm+'</b>':''))+(sd?' · '+esc(sd):'')+'</span>'+
      '<span class="muted small">'+RT.fmtDate(x.date,true)+'</span><button type="button" class="ib del" aria-label="מחק רשומה">×</button>'+
      (x.notes||(x.broke&&x.broke.length)?'<span class="h-note muted small">'+esc([(x.broke||[]).join(", "),x.notes].filter(Boolean).join(" · "))+'</span>':'');
    li.querySelector(".del").addEventListener("click",function(){
      confirmBox("למחוק את הרשומה?", RT.fmtDate(x.date,true)+" · "+(w?"טמפו עבודה "+x.work:"מקס נקי "+(x.clean||"—")), "מחק", function(){ RT.deleteEntry(id,x); renderProgress(); RT.toast("הרשומה נמחקה"); });
    });
    ul.appendChild(li);
  });
}
function copyText(text){
  function fallback(){
    var ta=document.createElement("textarea"); ta.value=text; ta.setAttribute("readonly",""); ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.select(); var ok=false; try{ ok=document.execCommand("copy"); }catch(e){} document.body.removeChild(ta); return ok;
  }
  if(navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(function(){return true;},function(){return fallback();});
  return Promise.resolve(fallback());
}
function copySummary(){ copyText(RT.buildTextSummary()).then(function(ok){ RT.toast(ok?"הסיכום הועתק – אפשר להדביק למאסטרו":"ההעתקה נכשלה"); }); }
$("copySummary").addEventListener("click",copySummary);
$("copySummary2").addEventListener("click",copySummary);

/* ======================= library ======================= */
var openEx=null;
function renderLibrary(){
  var cats=$("cats"); cats.innerHTML="";
  RT.CATS.forEach(function(c){
    var n=RT.allEx().filter(function(ex){ return c.id==="all"||ex.cat===c.id; }).length;
    var b=el("button",{"type":"button","role":"tab","aria-selected":String(RT.ui.cat===c.id),"class":RT.ui.cat===c.id?"on":""},esc(c.name)+' <span>'+n+'</span>');
    b.addEventListener("click",function(){ RT.ui.cat=c.id; RT.saveUi(); renderLibrary(); });
    cats.appendChild(b);
  });
  var grid=$("libGrid"); grid.innerHTML="";
  RT.allEx().filter(function(ex){ return RT.ui.cat==="all"||ex.cat===RT.ui.cat; }).forEach(function(ex){
    var subs=RT.allSubs(ex), measured=subs.filter(function(s){ return RT.entries(s.id).length; }).length, open=openEx===ex.id;
    var card=el("article",{"class":"card ex"+(open?" open":""),"data-ex":ex.id});
    var head='<button type="button" class="ex-head" aria-expanded="'+open+'"><span class="ex-ttl"><h3>'+esc(ex.name)+(ex.custom?' <span class="cbadge">שלי</span>':'')+'</h3><span class="muted small">'+RT.catName(ex.cat)+' · '+subs.length+' תתי-תרגילים · '+measured+' נמדדו</span></span>'+
      '<span class="ex-stk">'+(subs[0]?RT.stickHTML(subs[0],true):"")+'</span><span class="chev" aria-hidden="true">‹</span></button>';
    var body="";
    if(open){
      body+='<div class="ex-body">'+(ex.how?'<p class="how">'+esc(ex.how)+'</p>':'')+
        (ex.custom?'<div class="row gap"><button type="button" class="btn sm" data-act="editex">ערוך תרגיל</button><button type="button" class="btn sm ghost danger" data-act="delex">מחק תרגיל</button></div>':'')+
        '<ul class="subs">'+subs.map(function(s){
          var lc=RT.latestClean(s.id), lw=RT.latestWork(s.id);
          return '<li class="sub" data-sub="'+esc(s.id)+'"><div class="sub-main"><b>'+esc(s.name)+(s.custom?' <span class="cbadge">שלי</span>':'')+'</b><div class="stick">'+(RT.stickHTML(s)||'<span class="hint">אין סטיקינג</span>')+'</div></div>'+
            '<div class="sub-vals"><span>'+(lc?'מקס נקי <b>'+lc.clean+'</b>':'<span class="muted">לא נמדד</span>')+'</span>'+(lw?'<span class="muted small">עבודה '+lw.work+(lw.rating?' · '+RT.RATINGS[lw.rating]:'')+'</span>':'')+'</div>'+
            '<div class="sub-act"><button type="button" class="btn sm" data-act="measure">מדידה</button><button type="button" class="btn sm" data-act="log">רישום ידני</button>'+
            (s.custom?'<button type="button" class="btn sm ghost" data-act="editsub">ערוך</button><button type="button" class="ib del" data-act="delsub" aria-label="מחק תת-תרגיל">×</button>':'')+'</div></li>';
        }).join("")+'</ul>'+
        '<button type="button" class="btn sm" data-act="addsub">+ תת-תרגיל</button></div>';
    }
    card.innerHTML=head+body;
    card.querySelector(".ex-head").addEventListener("click",function(){ openEx=open?null:ex.id; renderLibrary(); });
    card.querySelectorAll("[data-act]").forEach(function(b){
      b.addEventListener("click",function(){
        var li=b.closest(".sub"), sid=li&&li.dataset.sub, act=b.dataset.act;
        if(act==="measure"){ M.queue=null; RT.go("measure"); RT.measure.setupFor(sid); }
        else if(act==="log") logForm(sid);
        else if(act==="addsub") subForm(ex,null);
        else if(act==="editsub") subForm(ex,RT.SUB[sid]);
        else if(act==="delsub") deleteSub(ex,RT.SUB[sid]);
        else if(act==="editex") exForm(ex);
        else if(act==="delex") deleteEx(ex);
      });
    });
    grid.appendChild(card);
  });
}
function subForm(ex, s){
  var body='<label class="fld"><span>שם תת-התרגיל</span><input type="text" class="tin" id="fSubName" maxlength="60" placeholder="למשל: דגש על 2 ו-4"></label>'+
    '<label class="fld"><span>סטיקינג (R / L, ‏&gt; לדגש, r/l לתו חן, z לבאז)</span><input type="text" class="tin" id="fSubStick" maxlength="80" dir="ltr" placeholder="R>R L>L"></label>'+
    '<label class="fld"><span>הערה קצרה (לא חובה)</span><input type="text" class="tin" id="fSubHint" maxlength="120"></label>';
  modal(s?"עריכת תת-תרגיל":"תת-תרגיל חדש · "+ex.name, body, [{t:s?"שמור":"הוסף",primary:true,fn:function(){
    var name=$("fSubName").value.trim(); if(!name){ RT.toast("תן שם לתת-התרגיל"); return false; }
    var stick=$("fSubStick").value.trim(), hint=$("fSubHint").value.trim();
    if(s){ s.name=name; s.stick=stick; if(hint) s.hint=hint; else delete s.hint; }
    else {
      var id="c_"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
      if(!Array.isArray(RT.state.custom[ex.id])) RT.state.custom[ex.id]=[];
      var o={id:id,name:name,stick:stick,custom:true}; if(hint) o.hint=hint;
      RT.state.custom[ex.id].push(o);
    }
    RT.save(); RT.indexSubs(); RT.measure.fill(); openEx=ex.id; renderLibrary(); RT.toast(s?"נשמר ✓":"תת-התרגיל \""+name+"\" נוסף ✓");
  }},{t:"ביטול"}]);
  if(s){ $("fSubName").value=s.name; $("fSubStick").value=s.stick||""; $("fSubHint").value=s.hint||""; }
  $("fSubName").focus();
}
function deleteSub(ex,s){
  var n=RT.entries(s.id).length;
  confirmBox("למחוק את \""+s.name+"\"?", n?"יימחקו גם "+n+" הרשומות שלו.":"", "מחק", function(){
    RT.state.custom[ex.id]=RT.customOf(ex.id).filter(function(x){ return x.id!==s.id; });
    RT.entries(s.id).forEach(function(x){ RT.sync.del(s.id,x); });
    delete RT.state.entries[s.id];
    RT.save(); RT.indexSubs(); RT.measure.fill(); renderLibrary(); RT.toast("נמחק");
  });
}
function exForm(ex){
  var body='<label class="fld"><span>שם התרגיל</span><input type="text" class="tin" id="fExName" maxlength="60"></label>'+
    '<label class="fld"><span>קטגוריה</span><select class="tin" id="fExCat">'+RT.CATS.filter(function(c){return c.id!=="all";}).map(function(c){ return '<option value="'+c.id+'">'+c.name+'</option>'; }).join("")+'</select></label>'+
    '<label class="fld"><span>איך מנגנים (הערה קצרה)</span><textarea class="tin" id="fExHow" rows="2" maxlength="300"></textarea></label>'+
    (ex?'':'<label class="fld"><span>תת-תרגיל ראשון</span><input type="text" class="tin" id="fExSub" maxlength="60" value="בסיסי"></label><label class="fld"><span>סטיקינג</span><input type="text" class="tin" id="fExStick" maxlength="80" dir="ltr" placeholder="RLRL"></label>');
  modal(ex?"עריכת תרגיל":"תרגיל חדש", body, [{t:ex?"שמור":"צור תרגיל",primary:true,fn:function(){
    var name=$("fExName").value.trim(); if(!name){ RT.toast("תן שם לתרגיל"); return false; }
    var cat=$("fExCat").value, how=$("fExHow").value.trim();
    if(ex){ var c=RT.state.customEx.filter(function(x){ return x.id===ex.id; })[0]; if(c){ c.name=name; c.cat=cat; c.how=how; } }
    else {
      var id="cx_"+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
      RT.state.customEx.push({id:id,name:name,cat:cat,how:how,custom:true});
      RT.state.custom[id]=[{id:"c_"+Date.now().toString(36)+Math.random().toString(36).slice(2,6),name:$("fExSub").value.trim()||"בסיסי",stick:$("fExStick").value.trim(),custom:true}];
      openEx=id; RT.ui.cat=cat; RT.saveUi();
    }
    RT.save(); RT.indexSubs(); RT.measure.fill(); renderLibrary(); RT.toast("נשמר ✓");
  }},{t:"ביטול"}]);
  if(ex){ $("fExName").value=ex.name; $("fExCat").value=ex.cat; $("fExHow").value=ex.how||""; }
  else $("fExCat").value=RT.ui.cat==="all"?"rud":RT.ui.cat;
  $("fExName").focus();
}
function deleteEx(ex){
  var subs=RT.allSubs(ex), n=subs.reduce(function(a,s){ return a+RT.entries(s.id).length; },0);
  confirmBox("למחוק את \""+ex.name+"\"?", "כולל "+subs.length+" תתי-תרגילים"+(n?" ו-"+n+" רשומות":"")+".", "מחק", function(){
    subs.forEach(function(s){ RT.entries(s.id).forEach(function(x){ RT.sync.del(s.id,x); }); delete RT.state.entries[s.id]; });
    delete RT.state.custom[ex.id];
    RT.state.customEx=RT.state.customEx.filter(function(x){ return x.id!==ex.id; });
    RT.save(); RT.indexSubs(); RT.measure.fill(); openEx=null; renderLibrary(); RT.toast("התרגיל נמחק");
  });
}
$("addEx").addEventListener("click",function(){ exForm(null); });
// manual logging (as in v1): working tempo or clean max after a real test
function logForm(id){
  var s=RT.SUB[id], isTest=RT.EXOF[id].cat==="test";
  var body='<div class="stick">'+RT.stickHTML(s)+'</div>'+
    '<div class="fld-row"><label class="fld"><span>BPM (נקי / טמפו עבודה)</span><input type="number" class="tin num" id="fLogBpm" min="20" max="400" inputmode="numeric"></label>'+
    '<label class="fld"><span>BPM שבו נהיה קשה</span><input type="number" class="tin num" id="fLogHard" min="20" max="400" inputmode="numeric"></label></div>'+
    '<div class="chips" id="fLogBroke">'+RT.BREAKS.map(function(b){ return '<button type="button" class="chip" aria-pressed="false">'+esc(b)+'</button>'; }).join("")+'</div>'+
    (isTest?'<label class="fld"><span>חלוקה</span><select class="tin" id="fLogSubdiv"><option value="">לא צוין</option>'+RT.SUBDIVS.map(function(v){ return '<option>'+v+'</option>'; }).join("")+'</select></label>':'')+
    '<label class="fld"><span>הערות</span><input type="text" class="tin" id="fLogNotes" maxlength="200"></label>'+
    '<p class="muted small"><b>טמפו עבודה</b> = הקצב שהתאמנת בו (לא משנה את המקסימום) · <b>מקסימום נקי</b> = רק אחרי מבחן אמיתי.</p>';
  function collect(kind){
    var bpm=RT.num($("fLogBpm").value), hard=RT.num($("fLogHard").value);
    if(kind==="work" && !bpm){ RT.toast("הזן את הקצב שבו התאמנת"); return false; }
    if(kind==="max" && !bpm && !hard){ RT.toast("הזן לפחות ערך BPM אחד"); return false; }
    var broke=[].map.call(document.querySelectorAll("#fLogBroke .chip.on"),function(x){ return x.textContent; });
    var o = kind==="work" ? {date:new Date().toISOString(), kind:"work", work:bpm, clean:null, hard:null, broke:broke, notes:$("fLogNotes").value.trim()}
      : {date:new Date().toISOString(), clean:bpm, hard:hard, broke:broke, notes:$("fLogNotes").value.trim()};
    var sd=$("fLogSubdiv"); if(sd&&sd.value) o.subdiv=sd.value;
    RT.addEntry(id,o); renderLibrary();
    RT.toast(kind==="work"?"טמפו עבודה נרשם: "+bpm+" BPM‏ (המקסימום לא השתנה)":"המקסימום הנקי נשמר ✓");
  }
  modal("רישום ידני · "+RT.fullName(id), body, [{t:"מקסימום נקי (מדידה)",primary:true,fn:function(){ return collect("max"); }},{t:"טמפו עבודה",fn:function(){ return collect("work"); }},{t:"ביטול"}]);
  document.querySelectorAll("#fLogBroke .chip").forEach(function(c){ c.addEventListener("click",function(){ var on=c.classList.toggle("on"); c.setAttribute("aria-pressed",String(on)); }); });
  $("fLogBpm").focus();
}

/* ======================= settings ======================= */
function renderSettings(){
  applyTheme();
  var S=RT.sync.state();
  $("syncUrl").value=S.url;
  renderSync();
  $("setRest").value=RT.settings.restSec; $("setMStart").value=RT.settings.measureStart;
  $("setMStep").value=RT.settings.measureStep; $("setMEvery").value=RT.settings.measureEvery;
  $("setSubClicks").checked=RT.settings.subClicks!==false;
  renderMetroSound();
  var meta=RT.readJSON(RT.KEYS.meta,{})||{};
  $("migInfo").textContent = meta.fromV1 ? "הנתונים מגרסה 1 הועברו אוטומטית ב-"+RT.fmtDate(meta.at,true)+". עותק מלא של נתוני גרסה 1 נשמר בדפדפן כגיבוי." : "";
  renderEditor(); renderWeeklyEditor();
}
function renderSync(){
  var S=RT.sync.state(), st=RT.sync.status(), LBL={none:"לא מוגדר",ok:"מסונכרן",wait:"ממתין",err:"שגיאה"};
  document.querySelectorAll("[data-sync-dot]").forEach(function(d){ d.className="sync-dot "+(st==="none"?"":st); d.title="שיטס: "+LBL[st]; });
  var box=$("syncStatus"); if(!box) return;
  var n=S.queue.filter(function(q){ return q.k!=="full"; }).length, full=S.queue.some(function(q){ return q.k==="full"; });
  var h='סטטוס: <b data-st="'+st+'">'+LBL[st]+'</b>';
  if(st==="none") h+=' · הדבק את כתובת ה-Web App ולחץ „שמור כתובת”';
  else {
    if(RT.sync.busy()) h+=' · שולח…';
    if(full) h+=' · סנכרון מלא בתור'; else if(n) h+=' · '+n+' בתור';
    if(S.lastOk) h+=' · אחרון: '+RT.fmtDate(S.lastOk,true)+(S.opaque?' (בלי אישור)':'');
    if(st==="err") h+=' <span class="bad">· '+esc(S.lastErr)+' – ננסה שוב אוטומטית</span>';
  }
  box.innerHTML=h;
  var a=$("syncSheetLink"); a.hidden=!S.sheetUrl; if(S.sheetUrl) a.href=S.sheetUrl;
}
RT.sync.onChange(renderSync);
function saveUrl(){
  var u=$("syncUrl").value.trim();
  if(!RT.sync.setUrl(u)){ RT.toast("הכתובת צריכה להתחיל ב-https://"); $("syncUrl").focus(); return false; }
  if(/\/dev(\?|$)/.test(u)) RT.toast("שים לב: זו כתובת /dev – צריך את הכתובת שמסתיימת ב-/exec");
  return true;
}
$("syncSave").addEventListener("click",function(){ if(saveUrl()) RT.toast(RT.sync.state().url?"הכתובת נשמרה – עכשיו „בדוק חיבור” ואז „סנכרן הכל”":"הסנכרון כובה"); });
$("syncUrl").addEventListener("keydown",function(e){ if(e.key==="Enter"){ e.preventDefault(); $("syncSave").click(); } });
$("syncTest").addEventListener("click",function(){
  if($("syncUrl").value.trim()!==RT.sync.state().url && !saveUrl()) return;
  $("syncStatus").innerHTML='סטטוס: <b>בודק חיבור…</b>';
  RT.sync.test().then(function(j){ RT.toast("החיבור תקין ✓ "+(j.sheet?"גיליון: "+j.sheet:"")+(j.counts?" · "+j.counts.measurements+" מדידות בגיליון":"")); },
    function(e){ RT.toast("החיבור נכשל ✗ "+(e&&e.message||"")); });
});
$("syncAll").addEventListener("click",function(){
  if($("syncUrl").value.trim()!==RT.sync.state().url && !saveUrl()) return;
  if(!RT.sync.full()) RT.toast("קודם הדבק ושמור את כתובת ה-Web App");
});
function bindNum(id,key,min,max){
  $(id).addEventListener("change",function(){ var v=parseInt($(id).value,10); if(!isFinite(v)) v=RT.DEFAULT_SETTINGS[key]; v=Math.max(min,Math.min(max,v)); $(id).value=v; RT.settings[key]=v; RT.saveSettings(); if(key.indexOf("measure")===0 && !RT.measure.active()) RT.measure.setupFor(M.sub); });
}
bindNum("setRest","restSec",3,120); bindNum("setMStart","measureStart",0,100); bindNum("setMStep","measureStep",1,30); bindNum("setMEvery","measureEvery",5,300);
$("setSubClicks").addEventListener("change",function(){ RT.settings.subClicks=$("setSubClicks").checked; RT.saveSettings(); });
/* metronome sound / volume / loud mode (settings card + compact selector on the practice screen) */
function renderMetroSound(){
  var S=RT.settings;
  document.querySelectorAll("#metroSoundSeg [data-sound]").forEach(function(b){ var on=b.dataset.sound===S.metroSound; b.classList.toggle("on",on); b.setAttribute("aria-checked",String(on)); });
  $("pSound").value=S.metroSound;
  $("setVol").value=S.metroVolume; $("setVolVal").textContent=S.metroVolume;
  $("setLoud").checked=S.metroLoud;
}
function setMetro(patch){
  Object.assign(RT.settings,patch); RT.normMetroSettings(RT.settings); RT.saveSettings();
  RT.metro.applySound(); renderMetroSound();
}
document.querySelectorAll("#metroSoundSeg [data-sound]").forEach(function(b){ b.addEventListener("click",function(){ setMetro({metroSound:b.dataset.sound}); RT.metro.preview(); }); });
$("pSound").addEventListener("change",function(){ setMetro({metroSound:$("pSound").value}); this.blur(); });
$("setVol").addEventListener("input",function(){ setMetro({metroVolume:+$("setVol").value}); });
$("setLoud").addEventListener("change",function(){ setMetro({metroLoud:$("setLoud").checked}); });
$("metroPreview").addEventListener("click",function(){ RT.metro.preview(); });
renderMetroSound();

/* routine editor */
function linkOptions(sel){
  var h='<option value=""'+(sel===""?" selected":"")+'>ללא קישור</option>';
  RT.allEx().forEach(function(ex){ var subs=RT.allSubs(ex); if(!subs.length) return;
    h+='<optgroup label="'+esc(ex.name)+'">'+subs.map(function(s){ return '<option value="'+esc(s.id)+'"'+(s.id===sel?" selected":"")+'>'+esc(s.name)+'</option>'; }).join("")+'</optgroup>'; });
  return h;
}
function renderEditor(){
  var box=$("routineEditor"), steps=RT.routine(); box.innerHTML="";
  $("edMeta").textContent=steps.length+" שלבים · "+RT.routineMinutes()+" דק'";
  steps.forEach(function(s,i){
    var row=el("div",{"class":"ed-row","data-i":i});
    row.innerHTML='<div class="ed-n">'+(i+1)+'</div><div class="ed-f">'+
      '<input type="text" class="tin" data-k="title" maxlength="60" aria-label="שם השלב" value="'+esc(s.title)+'">'+
      '<input type="text" class="tin" data-k="desc" maxlength="140" aria-label="תיאור" placeholder="תיאור קצר" value="'+esc(s.desc)+'">'+
      '<div class="ed-line"><label>דק׳ <input type="number" class="tin num sm" data-k="min" min="0.25" max="60" step="0.25" value="'+s.min+'"></label>'+
      '<label>BPM <input type="number" class="tin num sm" data-k="bpm" min="30" max="300" value="'+s.bpm+'"></label>'+
      '<label>חלוקה <select class="tin sm" data-k="sub">'+[1,2,3,4].map(function(v){ return '<option value="'+v+'"'+(v===s.sub?" selected":"")+'>'+RT.subName(v)+'</option>'; }).join("")+'</select></label>'+
      '<label class="grow">מקושר ל <select class="tin sm" data-k="link">'+linkOptions(RT.stepLink(i))+'</select></label></div></div>'+
      '<div class="ed-a"><button type="button" class="ib" data-mv="-1" aria-label="הזז למעלה"'+(i===0?" disabled":"")+'>▲</button><button type="button" class="ib" data-mv="1" aria-label="הזז למטה"'+(i===steps.length-1?" disabled":"")+'>▼</button><button type="button" class="ib del" data-rm aria-label="מחק שלב"'+(steps.length<2?" disabled":"")+'>×</button></div>';
    row.querySelectorAll("[data-k]").forEach(function(inp){
      inp.addEventListener("change",function(){
        var k=inp.dataset.k, v=inp.value;
        if(k==="min"){ v=Math.max(0.25,Math.min(60,parseFloat(v)||s.min)); inp.value=v; }
        if(k==="bpm"){ v=RT.clampBpm(RT.num(v)||s.bpm); inp.value=v; }
        if(k==="sub") v=+v;
        if(k==="title"){ v=v.trim()||"שלב"; }
        s[k]=v; RT.savePlan(); $("edMeta").textContent=steps.length+" שלבים · "+RT.routineMinutes()+" דק'";
      });
    });
    row.querySelectorAll("[data-mv]").forEach(function(b){ b.addEventListener("click",function(){
      if(RT.practice.active()){ RT.toast("אי אפשר לשנות סדר בזמן שגרה פעילה"); return; }
      var j=i+(+b.dataset.mv); var t=steps[i]; steps[i]=steps[j]; steps[j]=t; RT.savePlan(); renderEditor(); }); });
    row.querySelector("[data-rm]").addEventListener("click",function(){
      if(RT.practice.active()){ RT.toast("אי אפשר למחוק שלב בזמן שגרה פעילה"); return; }
      confirmBox("למחוק את השלב \""+s.title+"\"?","","מחק",function(){ steps.splice(i,1); RT.savePlan(); renderEditor(); }); });
    box.appendChild(row);
  });
}
$("edAdd").addEventListener("click",function(){ RT.routine().push({title:"שלב חדש",desc:"",min:3,bpm:80,sub:1,link:""}); RT.savePlan(); renderEditor(); });
$("edReset").addEventListener("click",function(){
  if(RT.practice.active()){ RT.toast("קודם סיים את השגרה הפעילה"); return; }
  confirmBox("לחזור לשגרת ברירת המחדל?","5 השלבים המקוריים (25 דק') עם הקצבים מגרסה 1.","החזר",function(){ RT.plan.routine2=RT.routineFromV1({}); RT.savePlan(); renderEditor(); });
});
function renderWeeklyEditor(){
  var ol=$("weeklyEditor"); ol.innerHTML="";
  RT.plan.weekly.forEach(function(id,i){
    var li=el("li",{"class":"step"});
    li.innerHTML='<div class="step-b static"><span class="step-n">'+(i+1)+'</span><span class="step-t"><b>'+esc(RT.fullName(id))+'</b></span><button type="button" class="ib" data-mv="-1" aria-label="למעלה"'+(i===0?" disabled":"")+'>▲</button><button type="button" class="ib del" aria-label="הסר מהרשימה">×</button></div>';
    li.querySelector(".del").addEventListener("click",function(){ RT.plan.weekly.splice(i,1); RT.savePlan(); renderWeeklyEditor(); });
    li.querySelector("[data-mv]").addEventListener("click",function(){ var t=RT.plan.weekly[i-1]; RT.plan.weekly[i-1]=id; RT.plan.weekly[i]=t; RT.savePlan(); renderWeeklyEditor(); });
    ol.appendChild(li);
  });
  RT.fillSubSelect($("weeklyAddSel"));
}
$("weeklyAdd").addEventListener("click",function(){ var v=$("weeklyAddSel").value; if(!v) return; if(RT.plan.weekly.indexOf(v)>=0){ RT.toast("כבר ברשימה"); return; } RT.plan.weekly.push(v); RT.savePlan(); renderWeeklyEditor(); });

/* import / export */
$("exportBtn").addEventListener("click",function(){
  var blob=new Blob([JSON.stringify(RT.exportPayload(),null,2)],{type:"application/json"});
  var a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="rudiments-"+RT.ymd(new Date())+".json";
  document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },500);
  RT.toast("קובץ הנתונים הורד");
});
$("importBtn").addEventListener("click",function(){ $("importFile").value=""; $("importFile").click(); });
$("importFile").addEventListener("change",function(){
  var f=$("importFile").files&&$("importFile").files[0]; if(!f) return;
  var rd=new FileReader();
  rd.onload=function(){
    var p; try{ p=RT.parseImport(rd.result); }catch(e){ RT.toast("הקובץ אינו קובץ נתונים תקין"); return; }
    modal("ייבוא נתונים", '<p>נמצאו <b>'+p.n+'</b> רשומות'+(p.nc?' ו-'+p.nc+' תרגילים/תתי-תרגילים אישיים':'')+' בקובץ.</p><p class="muted small"><b>החלפה</b> – מחליפה את כל הנתונים הקיימים (מומלץ לקובץ הנתונים המתוקן מ-17.10). <b>מיזוג</b> – מוסיפה רק רשומות חדשות.</p>',
      [{t:"החלפה",primary:true,fn:function(){ doImport(p,true); }},{t:"מיזוג",fn:function(){ doImport(p,false); }},{t:"ביטול"}]);
  };
  rd.readAsText(f);
});
function doImport(p,replace){
  RT.applyImport(p,replace); RT.measure.fill(); RT.sync.full();
  renderRoute(); RT.practice.renderSteps();
  RT.toast(replace?"הנתונים הוחלפו בהצלחה":"הנתונים מוזגו בהצלחה");
}

/* ======================= dialogs ======================= */
var modalKeep=null;
function modal(title, bodyHTML, btns){
  $("modalTitle").textContent=title; $("modalBody").innerHTML=bodyHTML;
  var bx=$("modalBtns"); bx.innerHTML="";
  btns.forEach(function(b){
    var n=el("button",{"type":"button","class":"btn"+(b.primary?" primary":"")+(b.danger?" danger":"")},esc(b.t));
    n.addEventListener("click",function(){ if(b.fn && b.fn()===false) return; closeModal(); });
    bx.appendChild(n);
  });
  modalKeep=document.activeElement;
  $("modal").hidden=false;
}
function closeModal(){ $("modal").hidden=true; if(modalKeep&&modalKeep.focus) try{ modalKeep.focus(); }catch(e){} }
function confirmBox(title, text, okText, fn){ modal(title, text?'<p>'+esc(text)+'</p>':'', [{t:okText,primary:true,danger:true,fn:fn},{t:"ביטול"}]); }
$("modal").addEventListener("click",function(e){ if(e.target===$("modal")) closeModal(); });
RT.modal=modal;

/* ======================= practice screen wiring + focus ======================= */
$("pPlay").addEventListener("click",function(){ RT.practice.togglePause(); });
$("fPlay").addEventListener("click",function(){ RT.practice.togglePause(); });
$("pNext").addEventListener("click",function(){ RT.practice.next(); });
$("pPrev").addEventListener("click",function(){ RT.practice.prev(); });
$("pStop").addEventListener("click",function(){ RT.practice.stop(); });
document.querySelectorAll("[data-adj]").forEach(function(b){ b.addEventListener("click",function(){ RT.practice.adjust(+b.dataset.adj); }); });
document.querySelectorAll("[data-rate]").forEach(function(b){ b.addEventListener("click",function(){ RT.practice.rate(b.dataset.rate); }); });
document.querySelectorAll("[data-raise]").forEach(function(b){ b.addEventListener("click",function(){ RT.practice.raise(b.dataset.raise==="accept"); }); });
/* gap metronome toggle (practice screen) */
function renderGap(){
  var g=RT.metro.gap;
  $("gapOn").checked=g.on; $("gapPlay").value=g.play; $("gapMute").value=g.mute;
  $("gapNums").classList.toggle("off",!g.on);
}
$("gapOn").addEventListener("change",function(){ RT.metro.setGap({on:$("gapOn").checked}); renderGap(); this.blur(); });
["gapPlay","gapMute"].forEach(function(id){
  $(id).addEventListener("change",function(){ var o={}; o[id==="gapPlay"?"play":"mute"]=$(id).value; RT.metro.setGap(o); renderGap(); });
});
renderGap();
RT.recorder.init();
function focusOpen(){ return !$("focus").hidden; }
function setFocus(on){
  $("focus").hidden=!on;
  document.body.classList.toggle("focus-on",on);
  if(on){
    if(route!=="practice") RT.go("practice");
    var fe=document.documentElement; if(fe.requestFullscreen && !document.fullscreenElement){ var pr=fe.requestFullscreen(); if(pr&&pr.catch) pr.catch(function(){}); }
    RT.practice.render();
  } else if(document.fullscreenElement && document.exitFullscreen){ var q=document.exitFullscreen(); if(q&&q.catch) q.catch(function(){}); }
}
RT.setFocus=setFocus;
$("focusBtn").addEventListener("click",function(){ setFocus(true); });
$("focusExit").addEventListener("click",function(){ setFocus(false); });
document.addEventListener("fullscreenchange",function(){ if(!document.fullscreenElement && focusOpen()) setFocus(false); });

/* ======================= keyboard ======================= */
document.addEventListener("keydown",function(e){
  var tag=(e.target.tagName||"").toLowerCase();
  if(tag==="input"||tag==="textarea"||tag==="select"||e.target.isContentEditable) return;
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  if(!$("modal").hidden){ if(e.key==="Escape"){ e.preventDefault(); closeModal(); } return; }
  var inPractice=route==="practice"||focusOpen(), inMeasure=route==="measure"&&!focusOpen();
  if(inMeasure){
    if(e.code==="Space"){ e.preventDefault(); if(M.phase==="setup") RT.measure.go(); else RT.measure.mark(); }
    else if(e.key==="Escape" && RT.measure.active()){ e.preventDefault(); RT.measure.cancel(); }
    return;
  }
  if(!inPractice) return;
  var k=e.key;
  if(e.code==="Space"){ e.preventDefault(); if(e.target.blur) e.target.blur(); RT.practice.togglePause(); }
  else if(k==="ArrowUp"){ e.preventDefault(); RT.practice.adjust(e.shiftKey?5:1); }
  else if(k==="ArrowDown"){ e.preventDefault(); RT.practice.adjust(e.shiftKey?-5:-1); }
  else if(k==="ArrowLeft"){ e.preventDefault(); RT.practice.next(); }   // RTL: left = forward
  else if(k==="ArrowRight"){ e.preventDefault(); RT.practice.prev(); }
  else if(k==="1"||k==="2"||k==="3"){ e.preventDefault(); RT.practice.rate({"1":"clean","2":"ok","3":"broke"}[k]); }
  else if(k==="f"||k==="F"||e.code==="KeyF"){ e.preventDefault(); setFocus(!focusOpen()); }
  else if(k==="Escape"){ if(focusOpen()){ e.preventDefault(); setFocus(false); } }
});

/* ======================= boot ======================= */
RT.onChange(function(what){ if(what==="plan" && route==="home") renderHome(); });
RT.measure.init();
applyTheme();
if(!location.hash) history.replaceState(null,"","#home");
go();
if(RT.migratedNow) RT.toast("הנתונים מגרסה 1 הועברו ✓ (נשמר גיבוי)");
document.addEventListener("visibilitychange",function(){ if(!document.hidden && route==="home") renderHome(); });

// test / debugging hooks
window.__rt = {
  state:function(){ return JSON.parse(JSON.stringify(RT.state)); },
  plan:function(){ return JSON.parse(JSON.stringify(RT.plan)); },
  P:function(){ return JSON.parse(JSON.stringify({phase:P.phase,idx:P.idx,paused:P.paused,restIdx:P.restIdx,done:P.done,skipped:P.skipped,results:Object.keys(P.results).reduce(function(o,k){ o[k]={bpm:P.results[k].bpm,rating:P.results[k].rating||null}; return o; },{})})); },
  M:function(){ return {phase:M.phase,bpm:M.bpm,start:M.start,hard:M.hard,brk:M.brk,sub:M.sub,queue:M.queue,qi:M.qi}; },
  metro:function(){ return {bpm:RT.metro.bpm,running:RT.metro.running,sub:RT.metro.sub,gap:Object.assign({},RT.metro.gap),log:RT.metro.log.slice()}; },
  settings:function(){ return JSON.parse(JSON.stringify(RT.settings)); },
  sync:function(){ var S=RT.sync.state(); return JSON.parse(JSON.stringify({url:S.url,queue:S.queue,lastOk:S.lastOk,lastErr:S.lastErr,status:RT.sync.status()})); },
  syncFlush:function(){ return RT.sync.flush(); },
  ui:function(){ return JSON.parse(JSON.stringify(RT.ui)); },
  rec:function(){ return RT.recorder.state(); },
  handGap:RT.handGap, summary:RT.buildTextSummary, wake:function(){ return RT.wake.mode; }
};
})();
