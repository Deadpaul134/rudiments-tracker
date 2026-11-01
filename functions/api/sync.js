// Cloudflare Pages Function: two-way sync for Rudiments Tracker, stored in D1 (binding "DB").
//
// Auth, in order:
//   1. Google ID token (`idToken` in the JSON body, or `Authorization: Bearer <jwt>`). Data is stored
//      under that Google `sub` in `user_records`. Verified via JWKS (aud, iss, exp).
//   2. Legacy access code (`code` in the body, or Bearer when it is not a JWT). Reads and writes the
//      original `records` table until someone claims it. After a claim this path returns 409.
//
// The app sends a text/plain JSON body so browsers never need a CORS preflight.
//
// POST /api/sync  {code|idToken, since, changes: [{kind, id, data, deleted, updatedAt}]}
//   -> {ok, cursor, changes, counts, reset}
// POST /api/sync  {code|idToken, ping: true} -> {ok, counts, cursor, claim?}
// GET  /api/sync  (Bearer header)            -> {ok, counts, cursor}

import { json, options } from '../../lib/server/http.js';
import { sameSecret } from '../../lib/server/secret.js';
import { userFromRequest } from '../../lib/server/google.js';
import { counts, maxSeq, applyChanges, pullRows, readClaim, hasTable, upsertUser } from '../../lib/server/records.js';

export { mergeRecord } from '../../lib/server/merge.js';

const KINDS = new Set(['e', 's', 'd', 'x', 'c', 'p']); // entry, session, day, custom exercise, custom sub, plan doc
const MAX_CHANGES = 1000;
const MAX_DATA = 64 * 1024;
const MAX_BODY = 4 * 1024 * 1024;

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

function validChange(c) {
  return isObj(c) && KINDS.has(c.kind) && typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 200 &&
    Number.isFinite(+c.updatedAt) && (c.deleted ? true : c.data !== undefined && c.data !== null);
}

async function status(db, sub) {
  const body = { ok: true, app: 'rimon-rudiments-sync', cursor: await maxSeq(db, sub), counts: await counts(db, sub) };
  if (sub) {
    const c = await readClaim(db);
    body.claim = { taken: !!(c && c.user_sub), mine: !!(c && c.user_sub === sub) };
  }
  return json(body);
}

async function authenticate(request, env, body) {
  if (!env) return { error: json({ ok: false, error: 'not-configured' }, 500) };
  const found = await userFromRequest(request, env, body);
  if (found.token) {
    if (found.error === 'not-configured') return { error: json({ ok: false, error: 'not-configured' }, 500) };
    if (found.error === 'auth-unavailable') return { error: json({ ok: false, error: 'auth-unavailable' }, 503) };
    if (!found.user) return { error: json({ ok: false, error: 'unauthorized' }, 401) };
    if (!env.DB) return { error: json({ ok: false, error: 'no-database' }, 500) };
    if (!(await hasTable(env.DB, 'user_records')) || !(await hasTable(env.DB, 'users'))) {
      return { error: json({ ok: false, error: 'not-migrated' }, 503) };
    }
    try { await upsertUser(env.DB, found.user, Date.now()); }
    catch (e) { return { error: json({ ok: false, error: 'db-error' }, 500) }; }
    return { sub: found.user.sub };
  }
  // Legacy sync code. Missing secret is 500, wrong code is 401 — same as before accounts.
  if (!env.SYNC_CODE) return { error: json({ ok: false, error: 'not-configured' }, 500) };
  if (!env.DB) return { error: json({ ok: false, error: 'no-database' }, 500) };
  const header = /^Bearer\s+(.+)$/.exec(request.headers.get('Authorization') || '');
  const code = header ? header[1].trim() : (body && typeof body.code === 'string' ? body.code : '');
  if (!code.trim() || !(await sameSecret(code.trim(), env.SYNC_CODE))) return { error: json({ ok: false, error: 'unauthorized' }, 401) };
  const claim = await readClaim(env.DB);
  if (claim && claim.user_sub) return { error: json({ ok: false, error: 'claimed' }, 409) };
  return { sub: null };
}

async function handlePost(body, env, sub) {
  if (body.ping) return status(env.DB, sub);
  const changesIn = Array.isArray(body.changes) ? body.changes : [];
  if (changesIn.length > MAX_CHANGES) return json({ ok: false, error: 'too-many-changes' }, 413);
  let since = Math.max(0, Math.floor(+body.since || 0));
  const db = env.DB;
  const now = Date.now();

  const byKey = new Map();
  for (const c of changesIn) {
    if (!validChange(c)) return json({ ok: false, error: 'bad-change' }, 400);
    const dataText = c.deleted ? null : JSON.stringify(c.data);
    if (dataText && dataText.length > MAX_DATA) return json({ ok: false, error: 'record-too-large' }, 413);
    byKey.set(c.kind + '\u001f' + c.id, {
      kind: c.kind, id: c.id, deleted: !!c.deleted, data: c.deleted ? null : c.data,
      updated_at: Math.min(Math.floor(+c.updatedAt), now),
    });
  }

  const top = await maxSeq(db, sub);
  const reset = since > top; // database was recreated – client must take everything
  if (reset) since = 0;

  const written = await applyChanges(db, sub, [...byKey.values()]);

  const out = await pullRows(db, sub, since);
  const changes = (out.results || []).map((r) => ({
    kind: r.kind, id: r.id, deleted: !!r.deleted, updatedAt: r.updated_at, seq: r.seq,
    data: r.data == null ? null : JSON.parse(r.data),
  }));
  const cursor = changes.length ? changes[changes.length - 1].seq : Math.max(since, await maxSeq(db, sub));
  const res = { ok: true, cursor, changes, written, reset, counts: await counts(db, sub) };
  if (sub) {
    const c = await readClaim(db);
    res.claim = { taken: !!(c && c.user_sub), mine: !!(c && c.user_sub === sub) };
  }
  return json(res);
}

export async function onRequestOptions() {
  return options();
}
export async function onRequestGet({ request, env }) {
  const auth = await authenticate(request, env, null);
  if (auth.error) return auth.error;
  try { return await status(env.DB, auth.sub); }
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
  const auth = await authenticate(request, env, isObj(body) ? body : null);
  if (auth.error) return auth.error;
  if (!isObj(body)) return json({ ok: false, error: 'bad-json' }, 400);
  try { return await handlePost(body, env, auth.sub); }
  catch (e) { return json({ ok: false, error: 'db-error' }, 500); }
}
