// Build Google-shaped ID tokens for tests, and serve the matching public JWK to the verifier.
const { generateKeyPairSync, createSign } = require('crypto');
const { pathToFileURL } = require('url');
const path = require('path');

const GOOGLE_URL = pathToFileURL(path.resolve(__dirname, '..', 'lib', 'server', 'google.js')).href;

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function createIssuer() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'test-key-1';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  function sign(payload, header) {
    const h = Object.assign({ alg: 'RS256', typ: 'JWT', kid: jwk.kid }, header || {});
    const body = b64url(JSON.stringify(h)) + '.' + b64url(JSON.stringify(payload));
    const sig = createSign('RSA-SHA256').update(body).sign(privateKey);
    return body + '.' + b64url(sig);
  }
  return { jwk, sign };
}

function payload(clientId, over) {
  const now = Math.floor(Date.now() / 1000);
  return Object.assign({
    iss: 'https://accounts.google.com',
    aud: clientId,
    sub: 'paul-sub',
    email: 'paul@example.com',
    email_verified: true,
    name: 'Paul',
    iat: now,
    exp: now + 3600,
  }, over || {});
}

// mode: 'ok' | 'down'. Call clearJwksCache() after switching mode.
function installGoogleFetch(jwk) {
  const real = global.fetch ? global.fetch.bind(global) : null;
  const state = { mode: 'ok' };
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('googleapis.com/oauth2/v3/certs')) {
      if (state.mode === 'down') return new Response('no', { status: 503 });
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { 'cache-control': 'public, max-age=600', 'content-type': 'application/json' },
      });
    }
    if (real) return real(url, opts);
    throw new Error('unexpected fetch ' + u);
  };
  return state;
}

function loadGoogle() { return import(GOOGLE_URL); }

module.exports = { b64url, createIssuer, payload, installGoogleFetch, loadGoogle };
