const { test, expect } = require('@playwright/test');
const { K, seed, open, rt } = require('./helpers');
const { createD1, routeToFunction, loadFunction } = require('./d1-fake');
const { createIssuer, payload, installGoogleFetch, loadGoogle } = require('./google-token');

const SERVER = 'https://sync.test';
const CODE = 'drum-code-123';
const CLIENT = 'test-client.apps.googleusercontent.com';
const PAUL = 'paul-sub';
const FRIEND = 'friend-sub';

const issuer = createIssuer();
installGoogleFetch(issuer.jwk);
let google;
test.beforeAll(async () => { google = await loadGoogle(); google.clearJwksCache(); });
test.beforeEach(() => google.clearJwksCache());

const st = (entries) => ({ [K]: { __v: 2, custom: {}, customEx: [], entries } });
function tok(sub, email) { return issuer.sign(payload(CLIENT, { sub, email, name: email })); }

async function switchAccount(page, token, sub) {
  const ready = page.waitForFunction((expectSub) => {
    try { return !!(window.__rt && window.RT && window.RT.sync && window.RT.sync.account().sub === expectSub); }
    catch (e) { return false; }
  }, sub);
  await page.evaluate((t) => window.RT.sync.signIn(t), token).catch((e) => {
    if (!/destroy|navigat|context/i.test(String(e))) throw e;
  });
  await ready;
}
async function signOut(page) {
  const ready = page.waitForFunction(() => {
    try { return !!(window.__rt && window.RT && window.RT.sync && window.RT.sync.account().sub === ''); }
    catch (e) { return false; }
  });
  await page.evaluate(() => window.RT.sync.signOut()).catch((e) => {
    if (!/destroy|navigat|context/i.test(String(e))) throw e;
  });
  await ready;
}

test('a friend who signs in gets an empty history; claiming keeps Paul\'s rows and blocks everyone else', async ({ browser }) => {
  const env = { DB: createD1(), SYNC_CODE: CODE, GOOGLE_CLIENT_ID: CLIENT };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.route('https://accounts.google.com/**', (route) => route.abort());
  await seed(page, st({ drag: [{ date: '2026-10-16T13:34:42.760Z', clean: 90, hard: 100, broke: [], notes: '' }] }));
  await routeToFunction(page, SERVER, env);
  await open(page, 'settings');
  await page.fill('#syncCode', CODE);
  await page.fill('#syncServer', SERVER);
  await page.click('#syncSave');
  await expect.poll(async () => (await rt(page, () => window.__rt.sync())).status, { timeout: 15000 }).toBe('ok');
  const before = legacyRows(env);

  await switchAccount(page, tok(FRIEND, 'friend@example.com'), FRIEND);
  await expect(page.locator('#googleWho')).toContainText('friend@example.com');
  await expect(page.locator('#claimBox')).toBeVisible();
  await expect(page.locator('#claimBox')).toContainText('משייך את הנתונים שכבר בענן');
  await expect(page.locator('#googleHint')).toContainText('כל חשבון Google רואה רק את התרגולים שלו');
  expect(await rt(page, () => Object.keys(window.__rt.state().entries))).toEqual([]);

  await page.click('#claimSkip');
  await expect.poll(async () => (await rt(page, () => window.__rt.sync())).status, { timeout: 15000 }).toBe('ok');
  await rt(page, () => window.RT.addEntry('flamL', { date: '2026-11-01T09:00:00.000Z', clean: 70, hard: 80, broke: [], notes: 'friend' }));
  await expect.poll(() => userRows(env, FRIEND).some((r) => r.id.startsWith('flamL|')), { timeout: 15000 }).toBe(true);
  expect(userRows(env, FRIEND).some((r) => r.id.startsWith('drag|'))).toBe(false);
  expect(legacyRows(env)).toEqual(before);

  await signOut(page);
  const local = await rt(page, () => window.__rt.state().entries);
  expect(local.drag).toHaveLength(1);
  expect(local.drag[0].clean).toBe(90);
  expect(local.flamL).toBeUndefined();

  await switchAccount(page, tok(PAUL, 'paul@example.com'), PAUL);
  await expect(page.locator('#claimBox')).toBeVisible();
  await page.fill('#claimCode', CODE);
  await page.click('#claimBtn');
  await expect(page.locator('#toast')).toContainText('ההיסטוריה שויכה');
  await expect.poll(async () => {
    const entries = await rt(page, () => window.__rt.state().entries);
    return entries.drag && entries.drag[0] && entries.drag[0].clean;
  }, { timeout: 15000 }).toBe(90);
  const pauls = await rt(page, () => window.__rt.state().entries);
  expect(pauls.flamL).toBeUndefined();
  expect(userRows(env, PAUL).some((r) => r.id === 'drag|2026-10-16T13:34:42.760Z' && r.data.clean === 90)).toBe(true);
  expect(userRows(env, PAUL).some((r) => String(r.id).startsWith('flamL|'))).toBe(false);
  expect(legacyRows(env)).toEqual(before);

  const fn = await loadFunction();
  const blocked = await fn.onRequestPost({ env, request: new Request(SERVER + '/api/sync', {
    method: 'POST', headers: { Authorization: 'Bearer ' + CODE }, body: JSON.stringify({ since: 0, changes: [] }),
  }) });
  expect(blocked.status).toBe(409);
  const friendView = await fn.onRequestPost({ env, request: new Request(SERVER + '/api/sync', {
    method: 'POST', body: JSON.stringify({ idToken: tok(FRIEND, 'friend@example.com'), since: 0, changes: [] }),
  }) });
  const fj = await friendView.json();
  expect(fj.changes.some((c) => String(c.id).startsWith('drag|'))).toBe(false);
  expect(fj.changes.some((c) => String(c.id).startsWith('flamL|'))).toBe(true);
  await ctx.close();
});

function legacyRows(env) {
  return env.DB.raw.prepare('SELECT kind, id, data, deleted, updated_at, seq FROM records ORDER BY seq').all();
}
function userRows(env, sub) {
  return env.DB.raw.prepare('SELECT kind, id, data, deleted FROM user_records WHERE user_sub = ? ORDER BY seq').all(sub)
    .map((r) => ({ ...r, data: r.data && JSON.parse(r.data) }));
}
