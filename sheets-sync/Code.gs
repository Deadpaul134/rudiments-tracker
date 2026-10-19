/**
 * סנכרון "מעקב רודימנטים" ← Google Sheets
 * --------------------------------------------------------------
 * Apps Script שמחובר לגיליון (Extensions > Apps Script).
 * פריסה: Deploy > New deployment > Web app
 *        Execute as: Me   |   Who has access: Anyone
 *
 * הדף שולח POST עם גוף text/plain (JSON) – בלי preflight של CORS.
 * פעולות (action):
 *   ping                    – בדיקת חיבור (גם GET רגיל עושה את זה)
 *   measurement / measurements  – הוספה/עדכון שורות בלשונית "מדידות" (לפי מזהה רשומה)
 *   session / sessions      – הוספה/עדכון שורות בלשונית "סשנים" (לפי מזהה סשן)
 *   delete                  – מחיקת מדידות לפי מזהה {ids:[...]}
 *   snapshot                – דורס את לשונית "גיבוי" עם כל ה-JSON של הדף
 *   batch                   – הכל יחד: {measurements, sessions, deletes, snapshot, full}
 *                             full=true ⇒ "מדידות" ו"סשנים" נכתבות מחדש מאפס (מראה מלאה של הדף)
 * הגיליון הוא מראה של הדף – לא לערוך ידנית את השורות.
 */

var SHEET_ID = '1Qw_hqDivv3dbvwPwZaXj15y2h3I6JnDChWcW0ClDSuI';  // הגיליון "מעקב רודימנטים - סנכרון אוטומטי". ריק = הגיליון שהסקריפט מחובר אליו.
var APP = 'rimon-rudiments-sync';
var VERSION = 1;

var TAB_M = 'מדידות';
var TAB_S = 'סשנים';
var TAB_B = 'גיבוי';

// סדר העמודות בלשונית "מדידות"
var M_HEAD = ['חותמת זמן', 'תאריך', 'קטגוריה', 'רודימנט', 'תת-תרגיל', 'סוג', 'BPM נקי', 'BPM קשה',
              'הערות', 'מזהה רשומה', 'חלוקה', 'איפה נשבר', 'מזהה תת-תרגיל', 'עודכן בגיליון'];
var M_KEYS = ['ts', 'date', 'category', 'rudiment', 'sub', 'type', 'clean', 'hard',
              'notes', 'id', 'subdiv', 'broke', 'subId', '_updated'];
// סדר העמודות בלשונית "סשנים"
var S_HEAD = ['תאריך', 'דקות תרגול', 'שלבים שבוצעו (BPM)', 'הערות', 'סוג סשן', 'חותמת זמן', 'מזהה סשן', 'עודכן בגיליון'];
var S_KEYS = ['date', 'minutes', 'steps', 'notes', 'kind', 'ts', 'id', '_updated'];

var CHUNK = 40000; // תא בגוגל שיטס מוגבל ל-50,000 תווים

/* ---------------- entry points ---------------- */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var out;
  try {
    var ss = book_();
    setup_(ss);
    out = status_(ss);
  } catch (err) {
    out = { ok: false, app: APP, error: String(err && err.message || err) };
  }
  var cb = p.callback;
  if (cb && /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(cb)) { // JSONP לבדיקת חיבור מקובץ מקומי
    return ContentService.createTextOutput(cb + '(' + JSON.stringify(out) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(out);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return json_({ ok: false, app: APP, error: 'busy' });
  }
  try {
    var raw = e && e.postData && e.postData.contents;
    if (!raw) throw new Error('empty body');
    var body = JSON.parse(raw);
    var res = handle_(body);
    return json_(res);
  } catch (err) {
    return json_({ ok: false, app: APP, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- logic ---------------- */

function handle_(b) {
  if (!b || typeof b !== 'object') throw new Error('bad payload');
  var ss = book_();
  setup_(ss);
  var a = String(b.action || 'batch');
  var batch = { measurements: [], sessions: [], deletes: [], snapshot: null, full: false };
  if (a === 'ping') return status_(ss);
  else if (a === 'measurement') batch.measurements = [b.row || b.measurement || b];
  else if (a === 'measurements') batch.measurements = arr_(b.rows || b.measurements);
  else if (a === 'session') batch.sessions = [b.row || b.session || b];
  else if (a === 'sessions') batch.sessions = arr_(b.rows || b.sessions);
  else if (a === 'delete') batch.deletes = arr_(b.ids);
  else if (a === 'snapshot') batch.snapshot = b.snapshot != null ? b.snapshot : b.data;
  else if (a === 'batch') {
    batch.measurements = arr_(b.measurements);
    batch.sessions = arr_(b.sessions);
    batch.deletes = arr_(b.deletes);
    batch.snapshot = b.snapshot != null ? b.snapshot : null;
    batch.full = b.full === true;
  } else throw new Error('unknown action: ' + a);

  var now = new Date();
  var res = { ok: true, app: APP, version: VERSION, action: a, time: now.toISOString() };
  var shM = ss.getSheetByName(TAB_M), shS = ss.getSheetByName(TAB_S);

  if (batch.full) {
    res.measurements = replaceAll_(shM, M_KEYS, batch.measurements, now);
    res.sessions = replaceAll_(shS, S_KEYS, batch.sessions, now);
  } else {
    if (batch.deletes.length) res.deleted = deleteIds_(shM, M_KEYS.indexOf('id'), batch.deletes);
    if (batch.measurements.length) res.measurements = upsert_(shM, M_KEYS, batch.measurements, now);
    if (batch.sessions.length) res.sessions = upsert_(shS, S_KEYS, batch.sessions, now);
  }
  if (batch.snapshot != null) res.snapshot = writeSnapshot_(ss, batch.snapshot, now);
  return res;
}

function book_() {
  var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('no spreadsheet (set SHEET_ID)');
  return ss;
}

function setup_(ss) {
  ensureTab_(ss, TAB_M, M_HEAD);
  ensureTab_(ss, TAB_S, S_HEAD);
  var b = ss.getSheetByName(TAB_B);
  if (!b) {
    b = ss.insertSheet(TAB_B);
    b.getRange(1, 1, 1, 2).setValues([['עודכן ב', 'עדיין לא התקבל גיבוי']]);
  }
  try { b.setRightToLeft(true); } catch (e) {}
}

function ensureTab_(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var cur = sh.getRange(1, 1, 1, head.length).getValues()[0];
  var same = head.every(function (h, i) { return String(cur[i]) === h; });
  if (!same) {
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  try { sh.setRightToLeft(true); } catch (e) {}
  return sh;
}

function status_(ss) {
  var shM = ss.getSheetByName(TAB_M), shS = ss.getSheetByName(TAB_S), shB = ss.getSheetByName(TAB_B);
  return {
    ok: true, app: APP, version: VERSION,
    sheet: ss.getName(), sheetId: ss.getId(), url: ss.getUrl(),
    counts: {
      measurements: Math.max(0, shM.getLastRow() - 1),
      sessions: Math.max(0, shS.getLastRow() - 1)
    },
    snapshotAt: shB ? String(shB.getRange(1, 2).getDisplayValue()) : '',
    time: new Date().toISOString()
  };
}

function rowOf_(keys, obj, now) {
  return keys.map(function (k) {
    if (k === '_updated') return now;
    var v = obj ? obj[k] : '';
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) v = v.join(', ');
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    v = String(v);
    if (/^[=+\-@]/.test(v)) v = "'" + v; // לא לתת לטקסט להפוך לנוסחה
    return v;
  });
}

function upsert_(sh, keys, list, now) {
  var idCol = keys.indexOf('id'), width = keys.length;
  var last = sh.getLastRow(), index = {};
  if (last > 1) {
    var ids = sh.getRange(2, idCol + 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) { var k = String(ids[i][0]); if (k) index[k] = i + 2; }
  }
  var added = [], updated = 0, seen = {};
  list.forEach(function (o) {
    if (!o || o.id == null || o.id === '') return;
    var id = String(o.id), row = rowOf_(keys, o, now);
    if (seen[id] !== undefined) { added[seen[id]] = row; return; } // אותו מזהה פעמיים באותה בקשה
    if (index[id]) { sh.getRange(index[id], 1, 1, width).setValues([row]); updated++; }
    else { seen[id] = added.length; added.push(row); }
  });
  if (added.length) sh.getRange(sh.getLastRow() + 1, 1, added.length, width).setValues(added);
  return { added: added.length, updated: updated };
}

function replaceAll_(sh, keys, list, now) {
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, sh.getMaxColumns()).clearContent();
  var rows = [], seen = {};
  list.forEach(function (o) {
    if (!o || o.id == null || o.id === '') return;
    var id = String(o.id), row = rowOf_(keys, o, now);
    if (seen[id] !== undefined) rows[seen[id]] = row; else { seen[id] = rows.length; rows.push(row); }
  });
  if (rows.length) sh.getRange(2, 1, rows.length, keys.length).setValues(rows);
  return { replaced: rows.length };
}

function deleteIds_(sh, idCol, ids) {
  var want = {}; ids.forEach(function (x) { want[String(x)] = 1; });
  var last = sh.getLastRow(), n = 0;
  if (last < 2) return 0;
  var col = sh.getRange(2, idCol + 1, last - 1, 1).getValues();
  for (var i = col.length - 1; i >= 0; i--) {
    if (want[String(col[i][0])]) { sh.deleteRow(i + 2); n++; }
  }
  return n;
}

function writeSnapshot_(ss, snap, now) {
  var sh = ss.getSheetByName(TAB_B);
  var text = typeof snap === 'string' ? snap : JSON.stringify(snap);
  var parts = [];
  for (var i = 0; i < text.length; i += CHUNK) parts.push([text.substring(i, i + CHUNK)]);
  if (!parts.length) parts.push(['']);
  sh.clear();
  sh.getRange(1, 1, 4, 2).setValues([
    ['עודכן ב', now],
    ['גודל (תווים)', text.length],
    ['מספר חלקים', parts.length],
    ['איך לקרוא', 'כל ה-JSON של הדף (localStorage) נמצא בעמודה A משורה 6 והלאה. אם יש יותר מחלק אחד – לחבר את התאים לפי הסדר.']
  ]);
  sh.getRange(5, 1).setValue('JSON').setFontWeight('bold');
  sh.getRange(6, 1, parts.length, 1).setNumberFormat('@').setValues(parts);
  sh.getRange(1, 1, 5, 1).setFontWeight('bold');
  return { chars: text.length, parts: parts.length };
}

/* ---------------- helpers ---------------- */

function arr_(x) { return Array.isArray(x) ? x : (x ? [x] : []); }

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** להרצה ידנית מתוך העורך (Run > testSetup) כדי לאשר הרשאות ולבדוק שהלשוניות קיימות */
function testSetup() {
  var ss = book_();
  setup_(ss);
  Logger.log(JSON.stringify(status_(ss)));
}
