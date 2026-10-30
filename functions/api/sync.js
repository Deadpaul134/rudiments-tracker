// Cloudflare Pages Function: two-way sync for Rudiments Tracker, stored in D1 (binding "DB").
// Auth: the access code must match the secret SYNC_CODE. The app sends it in the JSON body ("code") as a
// text/plain POST, so browsers never need a CORS preflight; "Authorization: Bearer <code>" also works (curl).
//
// POST /api/sync  {code, since: <cursor>, changes: [{kind, id, data, deleted, updatedAt}]}
//   -> {ok, cursor, changes: [...server rows after `since`], counts, reset}
// POST /api/sync  {code, ping: true} -> {ok, counts, cursor}   (connection test)
// GET  /api/sync  (Bearer header)    -> {ok, counts, cursor}

const KINDS = new Set(['e', 's', 'd', 'x', 'c', 'p']); // entry, session, day, custom exercise, custom sub, plan doc
const MAX_CHANGES = 1000;
const MAX_DATA = 64 * 1024;
const MAX_BODY = 4 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
}

async function digest(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
}
async function sameSecret(a, b) {
  const x = await digest(a), y = await digest(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
async function authorize(request, env, bodyCode) {
  if (!env || !env.SYNC_CODE) return json({ ok: false, error: 'not-configured' }, 500);
  if (!env.DB) return json({ ok: false, error: 'no-database' }, 500);
  const m = /^Bearer\s+(.+)$/.exec(request.headers.get('Authorization') || '');
  const code = m ? m[1] : (typeof bodyCode === 'string' ? bodyCode : '');
  if (!code.trim() || !(await sameSecret(code.trim(), env.SYNC_CODE))) return json({ ok: false, error: 'unauthorized' }, 401);
  return null;
}
async function status(db) {
  return json({ ok: true, app: 'rimon-rudiments-sync', cursor: await maxSeq(db), counts: await counts(db) });
}

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const isWork = (d) => isObj(d) && d.kind === 'work';
const key = (kind, id) => kind + '\u001f' + id;

function validChange(c) {
  return isObj(c) && KINDS.has(c.kind) && typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 200 &&
    Number.isFinite(+c.updatedAt) && (c.deleted ? true : c.data !== undefined && c.data !== null);
}

// Decide what the stored row becomes. Returns null when nothing changes.
export function mergeRecord(existing, incoming) {
  const inc = { deleted: incoming.deleted ? 1 : 0, data: incoming.deleted ? null : incoming.data, updated_at: incoming.updated_at };
  if (!existing) return inc; // first time we see it (tombstones are kept too)
  const ex = { deleted: existing.deleted ? 1 : 0, data: existing.data, updated_at: existing.updated_at };
  let win = inc.updated_at >= ex.updated_at ? inc : ex;
  const lose = win === inc ? ex : inc;
  // Clean max never drops: two live versions of the same max measurement keep the higher clean/hard.
  if (incoming.kind === 'e' && !win.deleted && !lose.deleted && isObj(win.data) && isObj(lose.data) &&
      !isWork(win.data) && !isWork(lose.data)) {
    const d = { ...win.data };
    for (const f of ['clean', 'hard']) {
      const a = +win.data[f] || 0, b = +lose.data[f] || 0;
      if (b > a) d[f] = lose.data[f];
    }
    win = { ...win, data: d };
  }
  const same = win.deleted === ex.deleted && JSON.stringify(win.data) === JSON.stringify(ex.data);
  if (same) return null;
  return { ...win, updated_at: Math.max(win.updated_at, ex.updated_at) };
}

async function counts(db) {
  const r = await db.prepare('SELECT kind, COUNT(*) AS n FROM records WHERE deleted = 0 GROUP BY kind').all();
  const out = { total: 0 };
  for (const row of r.results || []) { out[row.kind] = row.n; out.total += row.n; }
  return out;
}
async function maxSeq(db) {
  const r = await db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM records').first();
  return (r && r.m) || 0;
}

async function handlePost(body, env) {
  if (body.ping) return status(env.DB);
  const changesIn = Array.isArray(body.changes) ? body.changes : [];
  if (changesIn.length > MAX_CHANGES) return json({ ok: false, error: 'too-many-changes' }, 413);
  let since = Math.max(0, Math.floor(+body.since || 0));
  const db = env.DB;
  const now = Date.now();

  // last write per key inside this request
  const byKey = new Map();
  for (const c of changesIn) {
    if (!validChange(c)) return json({ ok: false, error: 'bad-change' }, 400);
    const dataText = c.deleted ? null : JSON.stringify(c.data);
    if (dataText && dataText.length > MAX_DATA) return json({ ok: false, error: 'record-too-large' }, 413);
    byKey.set(key(c.kind, c.id), { kind: c.kind, id: c.id, deleted: !!c.deleted, data: c.deleted ? null : c.data,
      updated_at: Math.min(Math.floor(+c.updatedAt), now) });
  }

  const top = await maxSeq(db);
  const reset = since > top; // database was recreated – client must take everything
  if (reset) since = 0;

  let written = 0;
  if (byKey.size) {
    const keys = [...byKey.keys()];
    const ex = await db.prepare(
      "SELECT kind, id, data, deleted, updated_at FROM records WHERE kind || char(31) || id IN (SELECT value FROM json_each(?1))"
    ).bind(JSON.stringify(keys)).all();
    const existing = new Map();
    for (const r of ex.results || []) {
      existing.set(key(r.kind, r.id), { deleted: r.deleted, updated_at: r.updated_at, data: r.data == null ? null : JSON.parse(r.data) });
    }
    const rows = [];
    for (const [k, inc] of byKey) {
      const m = mergeRecord(existing.get(k), inc);
      if (m) rows.push({ k: inc.kind, i: inc.id, d: m.deleted ? null : JSON.stringify(m.data), x: m.deleted ? 1 : 0, u: m.updated_at });
    }
    if (rows.length) {
      // one statement for all rows; seq is assigned inside SQLite so concurrent requests never share a value
      await db.prepare(
        `INSERT INTO records (kind, id, data, deleted, updated_at, seq)
         SELECT json_extract(value, '$.k'), json_extract(value, '$.i'), json_extract(value, '$.d'),
                json_extract(value, '$.x'), json_extract(value, '$.u'),
                (SELECT COALESCE(MAX(seq), 0) FROM records) + CAST(key AS INTEGER) + 1
         FROM json_each(?1) WHERE 1
         ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, deleted = excluded.deleted,
           updated_at = excluded.updated_at, seq = excluded.seq`
      ).bind(JSON.stringify(rows)).run();
      written = rows.length;
    }
  }

  const out = await db.prepare(
    'SELECT kind, id, data, deleted, updated_at, seq FROM records WHERE seq > ?1 ORDER BY seq'
  ).bind(since).all();
  const changes = (out.results || []).map((r) => ({
    kind: r.kind, id: r.id, deleted: !!r.deleted, updatedAt: r.updated_at, seq: r.seq,
    data: r.data == null ? null : JSON.parse(r.data),
  }));
  const cursor = changes.length ? changes[changes.length - 1].seq : Math.max(since, await maxSeq(db));
  return json({ ok: true, cursor, changes, written, reset, counts: await counts(db) });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
export async function onRequestGet({ request, env }) {
  const denied = await authorize(request, env);
  if (denied) return denied;
  try { return await status(env.DB); }
  catch (e) { return json({ ok: false, error: 'db-error' }, 500); }
}
export async function onRequestPost({ request, env }) {
  const len = +request.headers.get('Content-Length') || 0;
  if (len > MAX_BODY) return json({ ok: false, error: 'too-large' }, 413);
  let text;
  try { text = await request.text(); } catch (e) { return json({ ok: false, error: 'bad-body' }, 400); }
  if (text.length > MAX_BODY) return json({ ok: false, error: 'too-large' }, 413);
  let body = null;
  try { body = JSON.parse(text); } catch (e) { /* rejected below, after the code check */ }
  const denied = await authorize(request, env, isObj(body) ? body.code : '');
  if (denied) return denied;
  if (!isObj(body)) return json({ ok: false, error: 'bad-json' }, 400);
  try { return await handlePost(body, env); }
  catch (e) { return json({ ok: false, error: 'db-error' }, 500); }
}
