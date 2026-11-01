// One-time link from the legacy sync-code dataset to the signed-in Google account.
// POST /api/claim  {idToken, code}  -> {ok, claimed, already, counts}
// The code must match SYNC_CODE. After the first successful claim, nobody else can claim.

import { json, options } from '../../lib/server/http.js';
import { sameSecret } from '../../lib/server/secret.js';
import { userFromRequest } from '../../lib/server/google.js';
import { hasTable, upsertUser, lockClaim, copyLegacyToUser, counts } from '../../lib/server/records.js';

const MAX_BODY = 100 * 1024;
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

export function onRequestOptions() {
  return options();
}

export async function onRequestPost({ request, env }) {
  if (!env || !env.DB) return json({ ok: false, error: 'no-database' }, 500);
  if (!env.GOOGLE_CLIENT_ID || !env.SYNC_CODE) return json({ ok: false, error: 'not-configured' }, 500);
  let text;
  try { text = await request.text(); } catch (e) { return json({ ok: false, error: 'bad-body' }, 400); }
  if (text.length > MAX_BODY) return json({ ok: false, error: 'too-large' }, 413);
  let body = null;
  try { body = JSON.parse(text); } catch (e) { return json({ ok: false, error: 'bad-json' }, 400); }
  if (!isObj(body)) return json({ ok: false, error: 'bad-json' }, 400);

  const found = await userFromRequest(request, env, body);
  if (!found.token || !found.user) {
    const status = found.error === 'auth-unavailable' ? 503 : found.error === 'not-configured' ? 500 : 401;
    const error = found.error === 'auth-unavailable' ? 'auth-unavailable' : found.error === 'not-configured' ? 'not-configured' : 'unauthorized';
    return json({ ok: false, error }, status);
  }
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code || !(await sameSecret(code, env.SYNC_CODE))) return json({ ok: false, error: 'bad-code' }, 401);
  if (!(await hasTable(env.DB, 'user_records')) || !(await hasTable(env.DB, 'legacy_claim')) || !(await hasTable(env.DB, 'users'))) {
    return json({ ok: false, error: 'not-migrated' }, 503);
  }
  try {
    const now = Date.now();
    await upsertUser(env.DB, found.user, now);
    const lock = await lockClaim(env.DB, found.user.sub, now);
    if (lock.error) return json({ ok: false, error: lock.error }, 409);
    const written = await copyLegacyToUser(env.DB, found.user.sub);
    return json({
      ok: true, claimed: true, already: !!lock.already, written,
      counts: await counts(env.DB, found.user.sub),
    });
  } catch (e) {
    return json({ ok: false, error: 'db-error' }, 500);
  }
}
