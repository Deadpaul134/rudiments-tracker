// Verify a Google Identity Services ID token (RS256) against Google's JWKS.
// Checks signature, iss, aud, and exp. The caller keys data by `sub`.

const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const SKEW_MS = 60 * 1000;

let cache = { at: 0, keys: null, ttl: 0 };

export function clearJwksCache() {
  cache = { at: 0, keys: null, ttl: 0 };
}

function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

function jwksError() {
  const err = new Error('jwks');
  err.code = 'jwks';
  return err;
}

async function getKeys(force) {
  const now = Date.now();
  if (!force && cache.keys && now - cache.at < cache.ttl) return cache.keys;
  const res = await fetch(CERTS, { headers: { accept: 'application/json' } });
  if (!res.ok) throw jwksError();
  const body = await res.json();
  const keys = Array.isArray(body.keys) ? body.keys : [];
  if (!keys.length) throw jwksError();
  let ttl = 3600 * 1000;
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  if (m) ttl = Math.min(24 * 3600 * 1000, Math.max(60 * 1000, parseInt(m[1], 10) * 1000));
  cache = { at: now, keys, ttl };
  return keys;
}

function audOk(aud, clientId) {
  if (aud === clientId) return true;
  return Array.isArray(aud) && aud.indexOf(clientId) !== -1;
}

export async function verifyGoogleIdToken(token, clientId, now = Date.now()) {
  clientId = typeof clientId === 'string' ? clientId.trim() : '';
  if (!clientId || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[2]) return null;
  let header, payload;
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch (e) {
    return null;
  }
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return null;
  if (!payload || typeof payload !== 'object') return null;

  let keys = await getKeys(false);
  let jwk = keys.find((k) => k && k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) {
    keys = await getKeys(true);
    jwk = keys.find((k) => k && k.kid === header.kid && k.kty === 'RSA');
  }
  if (!jwk || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') return null;

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256' },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), data);
  if (!ok) return null;

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub || sub.length > 255 || /[\u0000-\u001f]/.test(sub)) return null;
  if (!ISSUERS.has(payload.iss)) return null;
  if (!audOk(payload.aud, clientId)) return null;
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp * 1000 + SKEW_MS <= now) return null;
  const iat = Number(payload.iat);
  if (Number.isFinite(iat) && iat * 1000 > now + SKEW_MS) return null;
  if (payload.nbf != null && Number(payload.nbf) * 1000 > now + SKEW_MS) return null;
  if (payload.email_verified === false) return null;

  const email = typeof payload.email === 'string' ? payload.email.trim().slice(0, 320) : '';
  const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 200) : '';
  return { sub, email, name };
}

/** Pull a Google ID token off the request. Empty `token` means the caller should try the sync code. */
export async function userFromRequest(request, env, body) {
  const header = /^Bearer\s+(.+)$/.exec(request.headers.get('Authorization') || '');
  const bearer = header ? header[1].trim() : '';
  const bodyToken = body && typeof body.idToken === 'string' ? body.idToken.trim() : '';
  const bearerJwt = bearer.startsWith('eyJ') && bearer.split('.').length === 3;
  const token = bodyToken || (bearerJwt ? bearer : '');
  if (!token) return { token: '' };
  const clientId = env && typeof env.GOOGLE_CLIENT_ID === 'string' ? env.GOOGLE_CLIENT_ID.trim() : '';
  if (!clientId) return { token, error: 'not-configured' };
  try {
    const user = await verifyGoogleIdToken(token, clientId);
    if (!user) return { token, error: 'unauthorized' };
    return { token, user };
  } catch (e) {
    return { token, error: e && e.code === 'jwks' ? 'auth-unavailable' : 'unauthorized' };
  }
}
