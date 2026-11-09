// Long-lived "stay signed in" token, so the app keeps syncing after the 1-hour Google ID token expires.
//
// Format: rs1.<base64url(JSON {sub, email, name, iat, exp})>.<base64url(HMAC-SHA256)>
// Signed with the SESSION_SECRET Pages secret. Without that secret nothing here issues or accepts a
// session, and the app keeps working exactly as before (Google ID token, then silent Google re-sign-in).
// The session is minted only from a verified Google ID token, lasts a year, and slides forward on use.
// Rotating SESSION_SECRET signs everyone out.

export const SESSION_PREFIX = 'rs1.';
export const SESSION_DAYS = 365;
const DAY_MS = 24 * 3600 * 1000;
export const SESSION_MS = SESSION_DAYS * DAY_MS;
export const REFRESH_AFTER_MS = DAY_MS; // re-issue at most once a day

const enc = new TextEncoder();

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function sessionSecret(env) {
  const s = env && typeof env.SESSION_SECRET === 'string' ? env.SESSION_SECRET.trim() : '';
  return s.length >= 32 ? s : '';
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode('rudiments-session-v1:' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Mint a session for a verified user. Returns null when SESSION_SECRET is not set. */
export async function createSession(user, env, now = Date.now()) {
  const secret = sessionSecret(env);
  if (!secret || !user || typeof user.sub !== 'string' || !user.sub) return null;
  const claims = { sub: user.sub, email: user.email || '', name: user.name || '', iat: now, exp: now + SESSION_MS };
  const body = bytesToB64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(SESSION_PREFIX + body)));
  return { session: SESSION_PREFIX + body + '.' + bytesToB64url(sig), sessionExp: claims.exp };
}

/** Verify a session token. Returns {sub, email, name, iat, exp} or null. */
export async function verifySession(token, env, now = Date.now()) {
  const secret = sessionSecret(env);
  if (!secret || typeof token !== 'string' || !token.startsWith(SESSION_PREFIX) || token.length > 2048) return null;
  const parts = token.slice(SESSION_PREFIX.length).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlToBytes(parts[1]), enc.encode(SESSION_PREFIX + parts[0]));
  } catch (e) { return null; }
  if (!ok) return null;
  let c;
  try { c = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))); } catch (e) { return null; }
  if (!c || typeof c.sub !== 'string' || !c.sub || c.sub.length > 255) return null;
  if (!Number.isFinite(c.exp) || c.exp <= now || !Number.isFinite(c.iat) || c.iat > now + 60000) return null;
  return { sub: c.sub, email: typeof c.email === 'string' ? c.email : '', name: typeof c.name === 'string' ? c.name : '', iat: c.iat, exp: c.exp };
}

/** Fields to add to a successful response: a fresh session after a Google sign-in, or once a day on use. */
export async function sessionFields(found, env, now = Date.now()) {
  if (!found || !found.user) return {};
  if (found.via === 'session' && found.iat && now - found.iat < REFRESH_AFTER_MS) return {};
  const s = await createSession(found.user, env, now);
  return s || {};
}
