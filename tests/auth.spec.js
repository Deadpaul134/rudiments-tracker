const { test, expect } = require('@playwright/test');
const { createD1, loadFunction } = require('./d1-fake');
const { createIssuer, payload, installGoogleFetch, loadGoogle, b64url } = require('./google-token');

const API = 'https://sync.test/api/sync';
const CLAIM = 'https://sync.test/api/claim';
const CODE = 'drum-code-123';
const CLIENT = 'test-client.apps.googleusercontent.com';

const issuer = createIssuer();
const fetchState = installGoogleFetch(issuer.jwk);
let google;

test.beforeAll(async () => { google = await loadGoogle(); google.clearJwksCache(); });
test.beforeEach(() => { fetchState.mode = 'ok'; google.clearJwksCache(); });

function token(over, header) { return issuer.sign(payload(CLIENT, over), header); }

async function call(env, method, body, { token: tok, code, url } = {}) {
  const headers = {};
  const auth = tok || (code != null ? code : undefined);
  if (auth) headers.Authorization = 'Bearer ' + auth;
  const fn = url && url.endsWith('/api/claim') ? await import(require('url').pathToFileURL(require('path').resolve(__dirname, '..', 'functions', 'api', 'claim.js')).href)
    : url && url.endsWith('/api/config') ? await import(require('url').pathToFileURL(require('path').resolve(__dirname, '..', 'functions', 'api', 'config.js')).href)
    : await loadFunction();
  const name = 'onRequest' + method;
  return fn[name]({ env, request: new Request(url || API, {
    method: method === 'Options' ? 'OPTIONS' : method.toUpperCase(),
    headers,
    body: body == null || method === 'Get' || method === 'Options' ? undefined : JSON.stringify(body),
  }) });
}

const envOf = (extra) => Object.assign({ DB: createD1(), SYNC_CODE: CODE, GOOGLE_CLIENT_ID: CLIENT }, extra);
const legacyRows = (env) => env.DB.raw.prepare('SELECT kind, id, data, deleted, updated_at, seq FROM records ORDER BY seq').all();
const userRows = (env, sub) => env.DB.raw.prepare('SELECT kind, id, data, deleted FROM user_records WHERE user_sub = ? ORDER BY seq').all(sub)
  .map((r) => ({ ...r, data: r.data && JSON.parse(r.data) }));

test('accepts a real RS256 token and rejects aud, iss, exp, signature, alg and unverified email', async () => {
  const env = envOf();
  const ok = await call(env, 'Post', { ping: true, idToken: token() }, { token: 'ignored-not-a-jwt' });
  expect(ok.status).toBe(200);
  expect((await ok.json()).ok).toBe(true);
  expect(env.DB.raw.prepare('SELECT email FROM users WHERE sub = ?').get('paul-sub').email).toBe('paul@example.com');

  const bareIss = await call(envOf(), 'Post', { ping: true, idToken: token({ iss: 'accounts.google.com' }) });
  expect(bareIss.status).toBe(200);
  const audList = await call(envOf(), 'Post', { ping: true, idToken: token({ aud: ['other', CLIENT], sub: 'list-sub', email: 'list@example.com' }) });
  expect(audList.status).toBe(200);

  const cases = [
    token({ aud: 'wrong.apps.googleusercontent.com' }),
    token({ iss: 'https://evil.example' }),
    token({ exp: Math.floor(Date.now() / 1000) - 120 }),
    token({ email_verified: false }),
    token().slice(0, -4) + (token().endsWith('a') ? 'b' : 'a'),
    b64url(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + b64url(JSON.stringify(payload(CLIENT))) + '.',
  ];
  for (const bad of cases) {
    const r = await call(env, 'Post', { ping: true, idToken: bad });
    expect(r.status).toBe(401);
    expect((await r.json()).changes).toBeUndefined();
  }
  expect(legacyRows(env)).toHaveLength(0);

  google.clearJwksCache();
  fetchState.mode = 'down';
  const down = await call(envOf(), 'Post', { ping: true, idToken: token() });
  expect(down.status).toBe(503);
  expect((await down.json()).error).toBe('auth-unavailable');
});

test('two Google accounts cannot see each other, and a body sub is ignored', async () => {
  const env = envOf();
  const paul = token({ sub: 'paul-sub', email: 'paul@example.com' });
  const friend = token({ sub: 'friend-sub', email: 'friend@example.com', name: 'Friend' });
  const entry = { kind: 'e', id: 'drag|2026-10-16T13:34:42.760Z', data: { date: '2026-10-16T13:34:42.760Z', clean: 90, hard: 100, broke: [], notes: '' }, updatedAt: 1000 };
  let r = await call(env, 'Post', { idToken: paul, sub: 'friend-sub', since: 0, changes: [entry] });
  expect(r.status).toBe(200);
  expect(userRows(env, 'paul-sub').map((x) => x.id)).toEqual([entry.id]);
  expect(userRows(env, 'friend-sub')).toHaveLength(0);
  expect(legacyRows(env)).toHaveLength(0);

  r = await call(env, 'Post', { idToken: friend, since: 0, changes: [] });
  const j = await r.json();
  expect(j.changes).toEqual([]);
  expect(j.counts.total).toBe(0);
  expect(j.claim).toEqual({ taken: false, mine: false });

  const again = await (await call(env, 'Post', { idToken: paul, since: 0, changes: [] })).json();
  expect(again.changes.map((c) => c.id)).toEqual([entry.id]);
  expect(again.changes[0].data.clean).toBe(90);
});

test('legacy sync code keeps working until claim, then only the claiming account has the history', async () => {
  const env = envOf();
  const entry = { kind: 'e', id: 'drag|A', data: { date: 'A', clean: 90, hard: 100, notes: '' }, updatedAt: 1000 };
  expect((await call(env, 'Post', { since: 0, changes: [entry] }, { code: CODE })).status).toBe(200);
  const before = legacyRows(env);
  expect(before).toHaveLength(1);

  const paul = token();
  const friend = token({ sub: 'friend-sub', email: 'friend@example.com' });
  const bad = await call(env, 'Post', { idToken: friend, code: 'nope' }, { url: CLAIM });
  expect(bad.status).toBe(401);
  expect((await bad.json()).error).toBe('bad-code');
  expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM legacy_claim').get().n).toBe(0);
  expect(legacyRows(env)).toEqual(before);

  const claimed = await call(env, 'Post', { idToken: paul, code: CODE }, { url: CLAIM });
  expect(claimed.status).toBe(200);
  const cj = await claimed.json();
  expect(cj.claimed).toBe(true);
  expect(cj.already).toBe(false);
  expect(userRows(env, 'paul-sub')[0].data).toEqual(entry.data);
  expect(legacyRows(env)).toEqual(before);

  const again = await (await call(env, 'Post', { idToken: paul, code: CODE }, { url: CLAIM })).json();
  expect(again.already).toBe(true);
  expect(legacyRows(env)).toEqual(before);

  const stolen = await call(env, 'Post', { idToken: friend, code: CODE }, { url: CLAIM });
  expect(stolen.status).toBe(409);
  expect((await stolen.json()).error).toBe('already-claimed');
  expect(userRows(env, 'friend-sub')).toHaveLength(0);

  const blocked = await call(env, 'Post', { since: 0, changes: [{ kind: 'e', id: 'drag|B', data: { date: 'B', clean: 1 }, updatedAt: Date.now() }] }, { code: CODE });
  expect(blocked.status).toBe(409);
  expect((await blocked.json()).changes).toBeUndefined();
  expect((await call(env, 'Get', null, { code: CODE })).status).toBe(409);
  expect(legacyRows(env)).toEqual(before);

  const friendView = await (await call(env, 'Post', { idToken: friend, since: 0, changes: [] })).json();
  expect(friendView.changes).toEqual([]);
  expect(friendView.claim).toEqual({ taken: true, mine: false });
  const paulView = await (await call(env, 'Post', { idToken: paul, since: 0, changes: [] })).json();
  expect(paulView.changes.map((c) => c.data.clean)).toEqual([90]);
  expect(paulView.claim.mine).toBe(true);
});

test('config exposes only the client id; a token works without the sync code; old databases keep the code path', async () => {
  const cfg = await (await call({ GOOGLE_CLIENT_ID: CLIENT, SYNC_CODE: 'secret-value', DB: createD1() }, 'Get', null, { url: 'https://sync.test/api/config' })).json();
  expect(cfg).toEqual({ ok: true, googleClientId: CLIENT });
  expect(JSON.stringify(cfg)).not.toContain('secret');
  expect((await call({}, 'Get', null, { url: 'https://sync.test/api/config' })).status).toBe(200);

  const noSecret = { DB: createD1(), GOOGLE_CLIENT_ID: CLIENT };
  expect((await call(noSecret, 'Post', { ping: true, idToken: token() })).status).toBe(200);
  expect((await call({ DB: createD1() }, 'Post', { ping: true, idToken: token() })).status).toBe(500);

  const old = { DB: createD1({ until: '0001_init.sql' }), SYNC_CODE: CODE, GOOGLE_CLIENT_ID: CLIENT };
  const legacy = await call(old, 'Post', { since: 0, changes: [{ kind: 'p', id: 'weekly', data: ['drag'], updatedAt: 5 }] }, { code: CODE });
  expect(legacy.status).toBe(200);
  expect((await legacy.json()).counts.total).toBe(1);
  const migrated = await call(old, 'Post', { ping: true, idToken: token() });
  expect(migrated.status).toBe(503);
  expect((await migrated.json()).error).toBe('not-migrated');
  expect(legacyRows(old)).toHaveLength(1);
});
