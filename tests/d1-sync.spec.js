const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { K, DATA_FILE, seed, open, rt } = require('./helpers');
const { createD1, loadFunction, routeToFunction } = require('./d1-fake');

const SERVER = 'https://sync.test';
const API = SERVER + '/api/sync';
const CODE = 'drum-code-123';

const st = (entries, extra = {}) => ({ [K]: { __v: 2, custom: {}, customEx: [], entries }, ...extra });
const plan = (p) => ({ [K + '-plan']: { days: {}, steps: {}, kit: {}, sessions: {}, routine: {}, ...p } });
const rows = (env, where = '1') => env.DB.raw.prepare(`SELECT kind, id, data, deleted FROM records WHERE ${where} ORDER BY seq`).all()
  .map((r) => ({ ...r, data: r.data && JSON.parse(r.data) }));

async function device(browser, env, items, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const calls = [];
  await seed(page, items || {});
  await routeToFunction(page, SERVER, env, async (req) => { calls.push(req.method()); return opts.hook ? opts.hook(req) : undefined; });
  return { ctx, page, calls };
}
async function connect(page, code = CODE) {
  await open(page, 'settings');
  await page.fill('#syncCode', code);
  await page.fill('#syncServer', SERVER);
  await page.click('#syncSave');
}
const syncState = (page) => rt(page, () => window.__rt.sync());
const waitSynced = (page) => expect.poll(async () => { const s = await syncState(page); return s.status; }, { timeout: 15000 }).toBe('ok');
const entries = (page, id) => rt(page, (id) => (window.__rt.state().entries[id] || []), id);

test.describe('server function (real code, in-memory D1)', () => {
  let fn;
  test.beforeAll(async () => { fn = await loadFunction(); });
  const call = (env, method, body, code = CODE) => fn['onRequest' + method]({ env, request: new Request(API, {
    method: method.toUpperCase(), headers: code == null ? {} : { Authorization: 'Bearer ' + code }, body: body && JSON.stringify(body) }) });

  test('access code: missing or wrong → 401 with no data; secret not set → 500', async () => {
    const env = { DB: createD1(), SYNC_CODE: CODE };
    await call(env, 'Post', { since: 0, changes: [{ kind: 'e', id: 'drag|A', data: { date: 'A', clean: 90 }, updatedAt: 1 }] });
    for (const code of [null, 'wrong']) {
      const r = await call(env, 'Post', { since: 0 }, code);
      expect(r.status).toBe(401);
      const j = await r.json();
      expect(j.changes).toBeUndefined();
    }
    // code inside a text/plain body (what the app sends)
    const body = (code) => new Request(API, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ code, ping: true }) });
    expect((await fn.onRequestPost({ env, request: body('wrong') })).status).toBe(401);
    expect((await fn.onRequestPost({ env, request: body(CODE) })).status).toBe(200);
    expect((await call({ DB: createD1() }, 'Get')).status).toBe(500);
    expect((await call(env, 'Get')).status).toBe(200);
  });

  test('merge: last change wins, clean max never drops, tombstones, clock clamp, reset', async () => {
    const env = { DB: createD1(), SYNC_CODE: CODE };
    let j = await (await call(env, 'Post', { since: 0, changes: [{ kind: 'e', id: 'drag|A', data: { date: 'A', clean: 90, hard: 100, notes: '' }, updatedAt: 1000 }] })).json();
    j = await (await call(env, 'Post', { since: j.cursor, changes: [{ kind: 'e', id: 'drag|A', data: { date: 'A', clean: 80, hard: 85, notes: 'later' }, updatedAt: 2000 }] })).json();
    expect(j.changes[0].data).toEqual({ date: 'A', clean: 90, hard: 100, notes: 'later' });
    // older change loses (but still cannot lower the max)
    j = await (await call(env, 'Post', { since: j.cursor, changes: [{ kind: 'e', id: 'drag|A', data: { date: 'A', clean: 95, hard: 100, notes: 'old' }, updatedAt: 1500 }] })).json();
    expect(rows(env)[0].data).toEqual({ date: 'A', clean: 95, hard: 100, notes: 'later' });
    // a device clock in the future is clamped to server time
    const far = Date.now() + 10 * 365 * 864e5;
    await call(env, 'Post', { since: 0, changes: [{ kind: 'p', id: 'weekly', data: ['drag'], updatedAt: far }] });
    expect(env.DB.raw.prepare("SELECT updated_at FROM records WHERE kind='p'").get().updated_at).toBeLessThanOrEqual(Date.now());
    // explicit delete wins when newer
    j = await (await call(env, 'Post', { since: 0, changes: [{ kind: 'e', id: 'drag|A', deleted: true, updatedAt: Date.now() }] })).json();
    expect(j.counts.e || 0).toBe(0);
    expect(rows(env, "kind='e'")[0].deleted).toBe(1);
    // client cursor ahead of the database (recreated DB) → reset and full list
    j = await (await call(env, 'Post', { since: 9999 })).json();
    expect(j.reset).toBe(true);
    expect(j.changes.length).toBe(2);
    // bad input is rejected
    expect((await call(env, 'Post', { since: 0, changes: [{ kind: 'zz', id: 'x', data: 1, updatedAt: 1 }] })).status).toBe(400);
    expect((await call(env, 'Options')).status).toBe(204);
  });
});

test.describe('two-way sync in the app', () => {
  test('two devices merge without losing any practice; clean max kept; stable ids', async ({ browser }) => {
    const env = { DB: createD1(), SYNC_CODE: CODE };
    const A = await device(browser, env, { ...st({
      drag: [{ date: '2026-10-16T13:34:42.760Z', clean: 90, hard: 100, broke: [], notes: '' }],
      single8: [{ date: '2026-10-20T10:00:00.000Z', clean: 200, hard: 210, broke: [], notes: 'A' }],
    }), ...plan({ days: { '2026-10-16': 1 }, steps: { '2026-10-16': [0, 1] },
      log: [{ id: 's_a', date: '2026-10-16', ts: '2026-10-16 10:00', minutes: 25, steps: '', notes: '', kind: 'שגרה מלאה' }] }) });
    const B = await device(browser, env, { ...st({
      drag: [{ date: '2026-10-16T13:34:42.760Z', clean: 85, hard: 95, broke: [], notes: '' }], // same practice, lower number
      flamL: [{ date: '2026-10-21T09:00:00.000Z', clean: 125, hard: 130, broke: [], notes: 'B' }],
    }), ...plan({ days: { '2026-10-16': 1, '2026-10-21': 1 }, steps: { '2026-10-16': [2] },
      log: [{ id: 's_b', date: '2026-10-21', ts: '2026-10-21 09:30', minutes: 10, steps: '', notes: '', kind: 'שגרה מלאה' }] }) });

    await connect(A.page); await waitSynced(A.page);
    await connect(B.page); await waitSynced(B.page);
    await A.page.click('#syncNow'); await expect(A.page.locator('#toast')).toContainText('הסנכרון הושלם');
    await waitSynced(A.page);

    for (const { page } of [A, B]) {
      const s = await rt(page, () => window.__rt.state());
      expect(Object.keys(s.entries).sort()).toEqual(['drag', 'flamL', 'single8']);
      expect(s.entries.drag).toHaveLength(1);                       // same id → one record, not two
      expect(s.entries.drag[0].clean).toBe(90);                       // never lowered
      expect(s.entries.flamL[0].clean).toBe(125);
      const p = await rt(page, () => window.__rt.plan());
      expect(p.log.map((r) => r.id).sort()).toEqual(['s_a', 's_b']);
      expect(Object.keys(p.days).sort()).toEqual(['2026-10-16', '2026-10-21']);
      expect(p.steps['2026-10-16']).toEqual([0, 1, 2]);               // practice days merged, not replaced
    }
    const ids = rows(env, "kind='e'").map((r) => r.id).sort();
    expect(ids).toEqual(['drag|2026-10-16T13:34:42.760Z', 'flamL|2026-10-21T09:00:00.000Z', 'single8|2026-10-20T10:00:00.000Z']);
    await expect(A.page.locator('[data-sync-count]')).toHaveText(String(rows(env).filter((r) => !r.deleted).length));
    await expect(A.page.locator('[data-sync-last]')).not.toBeEmpty();
    await A.ctx.close(); await B.ctx.close();
  });

  test('a fresh device takes the cloud routine instead of overwriting it with defaults', async ({ browser }) => {
    const env = { DB: createD1(), SYNC_CODE: CODE };
    const A = await device(browser, env, {});
    await open(A.page, 'settings');
    await rt(A.page, () => { window.RT.plan.routine2[0].bpm = 133; window.RT.savePlan(); });
    await connect(A.page); await waitSynced(A.page);
    const B = await device(browser, env, {});
    await connect(B.page); await waitSynced(B.page);
    expect((await rt(B.page, () => window.__rt.plan())).routine2[0].bpm).toBe(133);
    expect(rows(env, "kind='p' AND id='routine'")[0].data[0].bpm).toBe(133);
    await A.ctx.close(); await B.ctx.close();
  });

  test('explicit delete on one device deletes everywhere; nothing else disappears', async ({ browser }) => {
    const env = { DB: createD1(), SYNC_CODE: CODE };
    const data = st({ drag: [
      { date: '2026-10-16T13:34:42.760Z', clean: 90, hard: 100, broke: [], notes: '' },
      { date: '2026-10-18T13:00:00.000Z', clean: 92, hard: 100, broke: [], notes: '' }] });
    const A = await device(browser, env, data);
    const B = await device(browser, env, data);
    await connect(A.page); await waitSynced(A.page);
    await connect(B.page); await waitSynced(B.page);

    await rt(B.page, () => { const x = window.RT.state.entries.drag[0]; window.RT.deleteEntry('drag', x); });
    await expect.poll(() => rows(env, "kind='e' AND deleted=1").length, { timeout: 10000 }).toBe(1);
    await A.page.click('#syncNow'); await waitSynced(A.page);
    expect((await entries(A.page, 'drag')).map((x) => x.date)).toEqual(['2026-10-18T13:00:00.000Z']);

    // an entry that vanishes locally without an explicit delete is restored by "sync now"
    await rt(A.page, () => { window.RT.state.entries.drag = []; window.RT.save(); });
    await A.page.click('#syncNow'); await waitSynced(A.page);
    expect((await entries(A.page, 'drag')).map((x) => x.date)).toEqual(['2026-10-18T13:00:00.000Z']);
    expect(rows(env, "kind='e' AND deleted=0")).toHaveLength(1);
    await A.ctx.close(); await B.ctx.close();
  });

  test('syncs on load, after every record, and on the button', async ({ browser }) => {
    const env = { DB: createD1(), SYNC_CODE: CODE };
    const A = await device(browser, env, {});
    await connect(A.page); await waitSynced(A.page);
    // after a record: manual clean-max log from the library
    const before = A.calls.length;
    await A.page.goto(A.page.url().replace(/#.*$/, '#library'));
    await A.page.click('.ex[data-ex="flam"] .ex-head');
    await A.page.click('.sub[data-sub="flamL"] [data-act="log"]');
    await A.page.fill('#fLogBpm', '125');
    await A.page.getByRole('button', { name: 'מקסימום נקי (מדידה)' }).click();
    await expect.poll(() => rows(env, "kind='e'").length, { timeout: 10000 }).toBe(1);
    expect(rows(env, "kind='e'")[0].data).toMatchObject({ clean: 125 });
    expect(A.calls.length).toBeGreaterThan(before);
    // on load: another device's change arrives just by reloading
    await fn_post(env, { kind: 'e', id: 'drag|2026-10-25T08:00:00.000Z', data: { date: '2026-10-25T08:00:00.000Z', clean: 99, hard: 105, broke: [], notes: '' } });
    const n = A.calls.length;
    await A.page.reload(); await A.page.waitForFunction(() => !!window.__rt);
    await expect.poll(() => entries(A.page, 'drag').then((e) => e.length), { timeout: 10000 }).toBe(1);
    expect(A.calls.length).toBeGreaterThan(n);
    // button
    const m = A.calls.length;
    await A.page.goto(A.page.url().replace(/#.*$/, '#settings'));
    await A.page.click('#syncNow');
    await expect(A.page.locator('#toast')).toContainText('הסנכרון הושלם');
    expect(A.calls.length).toBeGreaterThan(m);
    await A.ctx.close();
  });

  test('a rated routine step is synced as working tempo and does not touch clean max', async ({ browser }) => {
    const env = { DB: createD1(), SYNC_CODE: CODE };
    const A = await device(browser, env, st({ single8: [{ date: '2026-10-16T10:00:00.000Z', clean: 225, hard: 240, broke: [], notes: '' }] }));
    await connect(A.page); await waitSynced(A.page);
    await A.page.locator('#routineEditor [data-i="0"] [data-k="min"]').fill('0.25');
    await A.page.locator('#routineEditor [data-i="0"] [data-k="min"]').press('Enter');
    await A.page.locator('#routineEditor [data-i="0"] [data-k="title"]').click();
    await A.page.goto(A.page.url().replace(/#.*$/, '#practice'));
    await A.page.click('#pPlay');
    await expect(A.page.locator('#restPanel')).toBeVisible({ timeout: 25000 });
    await A.page.click('#restPanel [data-rate="clean"]');
    await expect.poll(() => rows(env, "kind='e' AND id LIKE 'single8|%'").filter((r) => r.data.kind === 'work' && r.data.rating === 'clean').length, { timeout: 10000 }).toBe(1);
    const max = rows(env, "kind='e' AND id LIKE 'single8|%'").find((r) => r.data.kind !== 'work');
    expect(max.data.clean).toBe(225);
    await A.ctx.close();
  });

  test('offline: changes stay on the device and go up when the connection returns', async ({ browser }) => {
    const env = { DB: createD1(), SYNC_CODE: CODE };
    let offline = false;
    const A = await device(browser, env, {}, { hook: () => (offline ? 'abort' : undefined) });
    await connect(A.page); await waitSynced(A.page);
    offline = true;
    await rt(A.page, () => window.RT.addEntry('drag', { date: '2026-10-28T08:00:00.000Z', clean: 95, hard: 100, broke: [], notes: '' }));
    await expect.poll(async () => (await syncState(A.page)).status, { timeout: 10000 }).toBe('err');
    expect((await syncState(A.page)).pending).toBeGreaterThan(0);
    expect(rows(env, "kind='e'")).toHaveLength(0);
    offline = false;
    await rt(A.page, () => window.__rt.syncFlush());
    await waitSynced(A.page);
    expect(rows(env, "kind='e'")).toHaveLength(1);
    expect((await syncState(A.page)).pending).toBe(0);
    await A.ctx.close();
  });

  test('wrong access code: clear message, nothing exchanged', async ({ browser }) => {
    const env = { DB: createD1(), SYNC_CODE: CODE };
    const A = await device(browser, env, st({ drag: [{ date: '2026-10-16T13:34:42.760Z', clean: 90, hard: 100, broke: [], notes: '' }] }));
    await connect(A.page, 'not-the-code');
    await expect.poll(async () => (await syncState(A.page)).status, { timeout: 10000 }).toBe('err');
    await expect(A.page.locator('#syncStatus')).toContainText('קוד הגישה שגוי');
    expect(rows(env)).toHaveLength(0);
    await A.ctx.close();
  });

  test('not configured: no requests, code never hardcoded, old Sheets queue removed', async ({ browser }) => {
    const env = { DB: createD1(), SYNC_CODE: CODE };
    const A = await device(browser, env, { [K + '-sync']: { url: 'https://script.google.com/x', queue: [{ k: 'full' }] } });
    await open(A.page, 'settings');
    await expect(A.page.locator('#syncCode')).toHaveValue('');
    await expect(A.page.locator('#syncServerFld')).toBeVisible();   // opened as a local file
    await expect(A.page.locator('#syncStatus')).toContainText('לא מוגדר');
    await rt(A.page, () => window.RT.addEntry('drag', { date: '2026-10-28T08:00:00.000Z', clean: 95, hard: 100, broke: [], notes: '' }));
    await A.page.waitForTimeout(2000);
    expect(A.calls).toHaveLength(0);
    expect(await A.page.evaluate((k) => localStorage.getItem(k), K + '-sync')).toBeNull();
    await A.ctx.close();
  });

  test('export button in the sync card downloads the full data file', async ({ browser }) => {
    const env = { DB: createD1(), SYNC_CODE: CODE };
    const A = await device(browser, env, st({ drag: [{ date: '2026-10-16T13:34:42.760Z', clean: 90, hard: 100, broke: [], notes: '' }] }));
    await open(A.page, 'settings');
    const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.click('#syncExport')]);
    expect(dl.suggestedFilename()).toMatch(/^rudiments-\d{4}-\d{2}-\d{2}\.json$/);
    const j = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    expect(j.app).toBe('rimon-rudiments');
    expect(j.data.entries.drag[0].clean).toBe(90);
    await A.ctx.close();
  });

  test("Paul's real v1 export: every measurement reaches the cloud once", async ({ browser }) => {
    const env = { DB: createD1(), SYNC_CODE: CODE };
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const A = await device(browser, env, {});
    await open(A.page, 'settings');
    const n = await rt(A.page, (text) => { const p = window.RT.parseImport(text); window.RT.applyImport(p, true); return p.n; }, JSON.stringify(raw));
    await connect(A.page); await waitSynced(A.page);
    const total = await rt(A.page, () => Object.values(window.__rt.state().entries).reduce((a, e) => a + e.length, 0));
    expect(rows(env, "kind='e' AND deleted=0")).toHaveLength(total);
    expect(total).toBe(n);
    // a second sync sends nothing new
    const before = env.DB.raw.prepare('SELECT MAX(seq) AS m FROM records').get().m;
    await A.page.click('#syncNow'); await waitSynced(A.page);
    expect(env.DB.raw.prepare('SELECT MAX(seq) AS m FROM records').get().m).toBe(before);
    await A.ctx.close();
  });
});

// write a change straight to the server, as another device would
async function fn_post(env, change) {
  const fn = await loadFunction();
  const r = await fn.onRequestPost({ env, request: new Request(API, { method: 'POST', headers: { Authorization: 'Bearer ' + CODE },
    body: JSON.stringify({ since: 0, changes: [{ ...change, updatedAt: Date.now() }] }) }) });
  if (r.status !== 200) throw new Error('post failed ' + r.status);
}
