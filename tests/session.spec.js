// "Stay signed in": the server turns a verified Google sign-in into a long session (a year, sliding),
// and the app keeps syncing after the 1-hour Google token runs out, across reloads and browser restarts.
const { test, expect } = require('@playwright/test');
const { rt } = require('./helpers');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

// Serve the app from a real https origin (like rudiments-tracker.pages.dev), with /api/* going to the real
// Pages Functions. file:// is not used here: its storage is not reliable across reloads in a fresh renderer.
const ORIGIN = 'https://app.test';
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
async function serveApp(page, env, hook) {
  await routeToFunction(page, ORIGIN + '/api/', env, hook);
  await page.route((u) => u.href.startsWith(ORIGIN + '/') && !u.pathname.startsWith('/api/'), (route) => {
    let p = new URL(route.request().url()).pathname;
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
}
async function open(page, hash = 'home') {
  await page.goto(ORIGIN + '/#' + hash);
  await page.waitForFunction(() => !!window.__rt);
}

// Seed localStorage once per tab (marker in window.name, which survives reloads), so reloads keep what the app saved.
async function seed(page, items) {
  await page.addInitScript((items) => {
    if (window.name === '__seeded') return;
    localStorage.clear();
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    window.name = '__seeded';
  }, items);
}
const { createD1, routeToFunction, loadFunction } = require('./d1-fake');
const { createIssuer, payload, installGoogleFetch, loadGoogle } = require('./google-token');

const SERVER = 'https://sync.test'; // server-side tests only
const API = SERVER + '/api/sync';
const CODE = 'drum-code-123';
const CLIENT = 'test-client.apps.googleusercontent.com';
const SECRET = 'test-session-secret-0123456789abcdef0123456789';
const PAUL = 'paul-sub';
const K = 'rimon-rudiments-v1';
const SYNC_KEY = K + '-d1sync';
const DAY = 24 * 3600 * 1000;

const issuer = createIssuer();
installGoogleFetch(issuer.jwk);
let google, session;
test.beforeAll(async () => {
  google = await loadGoogle(); google.clearJwksCache();
  session = await import(pathToFileURL(path.resolve(__dirname, '..', 'lib', 'server', 'session.js')).href);
});
test.beforeEach(() => google.clearJwksCache());

const tok = (over) => issuer.sign(payload(CLIENT, Object.assign({ sub: PAUL, email: 'paul@example.com', name: 'Paul' }, over)));
const envOf = (extra) => Object.assign({ DB: createD1(), SYNC_CODE: CODE, GOOGLE_CLIENT_ID: CLIENT }, extra);
async function post(env, body, url = API) {
  const fn = url.endsWith('/api/claim')
    ? await import(pathToFileURL(path.resolve(__dirname, '..', 'functions', 'api', 'claim.js')).href)
    : await loadFunction();
  const res = await fn.onRequestPost({ env, request: new Request(url, { method: 'POST', body: JSON.stringify(body) }) });
  return { status: res.status, body: await res.json() };
}
const userRows = (env, sub) => env.DB.raw.prepare('SELECT kind, id FROM user_records WHERE user_sub = ? ORDER BY seq').all(sub);
const entry = (id, clean) => ({ kind: 'e', id, data: { date: id.split('|')[1], clean, hard: clean + 10, broke: [], notes: '' }, updatedAt: 1000 });

test.describe('server: long session', () => {
  test('without SESSION_SECRET nothing changes: no session is issued and none is accepted', async () => {
    const env = envOf();
    const r = await post(env, { ping: true, idToken: tok() });
    expect(r.status).toBe(200);
    expect(r.body.session).toBeUndefined();
    const forged = await session.createSession({ sub: PAUL }, { SESSION_SECRET: SECRET });
    const s = await post(env, { ping: true, session: forged.session });
    expect(s.status).toBe(401);
    // a too-short secret is treated as missing
    expect(await session.createSession({ sub: PAUL }, { SESSION_SECRET: 'short' })).toBeNull();
  });

  test('a Google sign-in returns a one-year session that reads and writes the same account', async () => {
    const env = envOf({ SESSION_SECRET: SECRET });
    const t0 = Date.now();
    const r = await post(env, { idToken: tok(), since: 0, changes: [entry('drag|2026-10-16T13:34:42.760Z', 90)] });
    expect(r.status).toBe(200);
    expect(r.body.session).toMatch(/^rs1\./);
    expect(r.body.sessionExp).toBeGreaterThan(t0 + 364 * DAY);
    expect(r.body.sessionExp).toBeLessThan(Date.now() + 366 * DAY);

    const later = await post(env, { session: r.body.session, since: 0, changes: [entry('flamL|2026-11-01T09:00:00.000Z', 70)] });
    expect(later.status).toBe(200);
    expect(later.body.changes.map((c) => c.id).sort()).toEqual(['drag|2026-10-16T13:34:42.760Z', 'flamL|2026-11-01T09:00:00.000Z']);
    expect(later.body.session).toBeUndefined(); // fresh session: not re-issued on every call
    expect(userRows(env, PAUL)).toHaveLength(2);
    expect(env.DB.raw.prepare('SELECT count(*) n FROM records').get().n).toBe(0); // legacy table untouched
  });

  test('a session older than a day slides forward; tampered, foreign, expired sessions are rejected', async () => {
    const env = envOf({ SESSION_SECRET: SECRET });
    const old = await session.createSession({ sub: PAUL, email: 'paul@example.com' }, env, Date.now() - 2 * DAY);
    const r = await post(env, { ping: true, session: old.session });
    expect(r.status).toBe(200);
    expect(r.body.session).toMatch(/^rs1\./);
    expect(r.body.session).not.toBe(old.session);
    expect(r.body.sessionExp).toBeGreaterThan(old.sessionExp);

    const fresh = await session.createSession({ sub: PAUL }, env);
    const [head, body, sig] = fresh.session.split('.');
    const otherSub = Buffer.from(JSON.stringify({ sub: 'friend-sub', email: '', name: '', iat: Date.now(), exp: Date.now() + DAY })).toString('base64url');
    const foreign = await session.createSession({ sub: PAUL }, { SESSION_SECRET: SECRET + 'x' });
    const expired = await session.createSession({ sub: PAUL }, env, Date.now() - 366 * DAY);
    for (const bad of [head + '.' + otherSub + '.' + sig, fresh.session.slice(0, -3) + 'AAA', foreign.session, expired.session, 'rs1.', 'rs1.x.y']) {
      const b = await post(env, { ping: true, session: bad });
      expect(b.status).toBe(401);
      expect(b.body.changes).toBeUndefined();
    }
    expect(body.length).toBeGreaterThan(10);
  });

  test('a live Google token wins over a session, and the legacy claim accepts a session', async () => {
    const env = envOf({ SESSION_SECRET: SECRET });
    const friendSession = await session.createSession({ sub: 'friend-sub' }, env);
    const r = await post(env, { ping: true, idToken: tok(), session: friendSession.session });
    expect(r.status).toBe(200);
    expect(env.DB.raw.prepare('SELECT sub FROM users').all().map((u) => u.sub)).toEqual([PAUL]);

    const legacy = await post(env, { code: CODE, since: 0, changes: [entry('drag|2026-10-16T13:34:42.760Z', 90)] });
    expect(legacy.status).toBe(200);
    const mine = await session.createSession({ sub: PAUL, email: 'paul@example.com' }, env);
    const claimed = await post(env, { session: mine.session, code: CODE }, SERVER + '/api/claim');
    expect(claimed.status).toBe(200);
    expect(claimed.body.claimed).toBe(true);
    expect(userRows(env, PAUL).map((x) => x.id)).toEqual(['drag|2026-10-16T13:34:42.760Z']);
  });
});

// This browser already knows Paul's account (as after a first sign-in), so signIn() takes the
// same-account path without a page reload.
const known = (extra) => ({ [SYNC_KEY]: Object.assign({ sub: PAUL, email: 'paul@example.com', idToken: '', exp: 0, hold: false, claimChecked: true }, extra) });
async function signInPage(page, token) {
  await page.evaluate((t) => window.RT.sync.signIn(t), token).catch((e) => { if (!/destroy|navigat|context/i.test(String(e))) throw e; });
  await page.waitForFunction(() => { try { return window.RT.sync.account().sub === 'paul-sub'; } catch (e) { return false; } });
}
// Pretend the 1-hour Google token ran out (time passes, laptop sleeps, browser restarts).
async function expireGoogleToken(page) {
  await page.evaluate((key) => { const s = JSON.parse(localStorage.getItem(key)); s.exp = Math.floor(Date.now() / 1000) - 60; localStorage.setItem(key, JSON.stringify(s)); }, SYNC_KEY);
}

test.describe('app: stays signed in', () => {
  test('after the Google token expires the app keeps syncing on the long session, also in a fresh browser', async ({ browser }) => {
    const env = envOf({ SESSION_SECRET: SECRET });
    const seen = [];
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.route('https://accounts.google.com/**', (r) => r.abort());
    await seed(page, Object.assign({ [K]: { __v: 2, custom: {}, customEx: [], entries: { drag: [{ date: '2026-10-16T13:34:42.760Z', clean: 90, hard: 100, broke: [], notes: '' }] } } }, known()));
    await serveApp(page, env, (req) => { if (req.url().endsWith('/api/sync')) seen.push(JSON.parse(req.postData() || '{}')); });
    await open(page, 'settings');
    await signInPage(page, tok());
    await expect.poll(async () => rt(page, () => window.RT.sync.status()), { timeout: 15000 }).toBe('ok');
    await expect.poll(async () => rt(page, (k) => !!JSON.parse(localStorage.getItem(k)).session, SYNC_KEY)).toBe(true);

    await expireGoogleToken(page);
    await page.reload(); await page.waitForFunction(() => !!window.__rt);
    const a = await rt(page, () => window.RT.sync.account());
    expect(a.signedIn).toBe(true);
    expect(a.expired).toBe(false);
    await expect(page.locator('#googleWho')).toContainText('paul@example.com');
    await expect(page.locator('#googleOut')).toBeVisible();

    seen.length = 0;
    await rt(page, () => window.RT.addEntry('flamL', { date: '2026-11-01T09:00:00.000Z', clean: 70, hard: 80, broke: [], notes: '' }));
    await expect.poll(() => userRows(env, PAUL).some((r) => r.id.startsWith('flamL|')), { timeout: 15000 }).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((b) => !b.idToken && /^rs1\./.test(b.session || ''))).toBe(true);

    // browser restart: a brand-new browser context with only the storage this one saved
    const state = await ctx.storageState();
    await ctx.close();
    const ctx2 = await browser.newContext({ storageState: state, serviceWorkers: 'block' });
    const page2 = await ctx2.newPage();
    await page2.route('https://accounts.google.com/**', (r) => r.abort());
    await serveApp(page2, env);
    await open(page2, 'home');
    expect((await rt(page2, () => window.RT.sync.account())).signedIn).toBe(true);
    const entries = await rt(page2, () => window.__rt.state().entries);
    expect(entries.drag[0].clean).toBe(90); // history intact after the restart
    expect(entries.flamL).toHaveLength(1);
    expect(userRows(env, PAUL).filter((r) => r.kind === 'e').map((r) => r.id).sort()).toEqual(['drag|2026-10-16T13:34:42.760Z', 'flamL|2026-11-01T09:00:00.000Z']);
    await ctx2.close();
  });

  test('a rejected session is dropped and Google is asked quietly for a fresh token', async ({ browser }) => {
    const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage();
    const env = envOf(); // no SESSION_SECRET on the server: the old 1-hour-token world
    await page.route('https://accounts.google.com/gsi/client**', (r) => r.fulfill({ contentType: 'text/javascript', body: `
      window.__gsi = { prompts: 0, init: null };
      window.google = { accounts: { id: {
        initialize: function (c) { window.__gsi.init = c; },
        renderButton: function () {},
        disableAutoSelect: function () {},
        prompt: function () { window.__gsi.prompts++; var c = window.__gsi.init; setTimeout(function () { c.callback({ credential: window.__freshToken }); }, 10); }
      } } };` }));
    await seed(page, known({ session: 'rs1.bad.sig', sessionExp: Date.now() + 1e10 }));
    await serveApp(page, env);
    await page.addInitScript((t) => { window.__freshToken = t; }, tok());
    await open(page, 'home');
    // the bad session is refused once, then the quiet Google prompt signs back in without a click
    await expect.poll(() => rt(page, () => (window.__gsi && window.__gsi.prompts) || 0), { timeout: 15000 }).toBeGreaterThan(0);
    expect((await rt(page, () => window.__gsi.init)).auto_select).toBe(true);
    await expect.poll(() => rt(page, () => window.RT.sync.account().signedIn), { timeout: 15000 }).toBe(true);
    expect(await rt(page, (k) => JSON.parse(localStorage.getItem(k)).session, SYNC_KEY)).toBe('');
  });

  test('signing out forgets the long session and turns off Google auto sign-in', async ({ browser }) => {
    const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage();
    const env = envOf({ SESSION_SECRET: SECRET });
    await page.route('https://accounts.google.com/**', (r) => r.abort());
    await seed(page, known());
    await serveApp(page, env);
    await open(page, 'settings');
    await signInPage(page, tok());
    await expect.poll(async () => rt(page, (k) => !!JSON.parse(localStorage.getItem(k)).session, SYNC_KEY), { timeout: 15000 }).toBe(true);
    await page.evaluate(() => window.RT.sync.signOut()).catch(() => {});
    await page.waitForFunction(() => { try { return window.RT.sync.account().sub === ''; } catch (e) { return false; } });
    const s = await rt(page, (k) => JSON.parse(localStorage.getItem(k) || '{}'), SYNC_KEY);
    expect(s.session || '').toBe('');
    expect(s.idToken || '').toBe('');
    expect(await rt(page, () => window.RT.sync.account().expired)).toBe(false);
    // the copy kept for switching back to Paul's data does not keep the session either
    const kept = await rt(page, (k) => JSON.parse(JSON.parse(localStorage.getItem(k))['g:paul-sub'].sync), K + '-profiles');
    expect(kept.session).toBe('');
    expect((await rt(page, () => window.RT.sync.account())).signedIn).toBe(false);
  });
});
