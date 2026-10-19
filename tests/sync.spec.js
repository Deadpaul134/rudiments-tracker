const { test, expect } = require('@playwright/test');
const { K, seed, open, rt } = require('./helpers');

const URL = 'https://script.google.com/macros/s/TEST-DEPLOYMENT/exec';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

async function mockEndpoint(page) {
  const posts = [];
  await page.route(URL + '**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      posts.push(JSON.parse(req.postData()));
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true, app: 'rimon-rudiments-sync', version: 1, url: 'https://docs.google.com/spreadsheets/d/TEST' }) });
    }
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true, app: 'rimon-rudiments-sync', sheet: 'גיליון בדיקה', counts: { measurements: 0, sessions: 0 } }) });
  });
  return posts;
}

async function connect(page) {
  await open(page, 'settings');
  await page.fill('#syncUrl', URL);
  await page.click('#syncSave');
}

test.describe('Google Sheets sync (mocked Apps Script endpoint)', () => {
  test('test connection + full sync posts every measurement', async ({ page }) => {
    await seed(page, {
      [K]: { __v: 2, custom: {}, entries: { drag: [{ date: '2026-10-16T13:34:42.760Z', clean: 90, hard: 100, broke: [], notes: '' }] } },
      [K + '-plan']: { days: { '2026-10-16': 1 }, steps: {}, kit: {}, sessions: {}, routine: {},
        log: [{ id: 's_x', date: '2026-10-18', ts: '2026-10-18 10:00', minutes: 25, steps: '', notes: '', kind: 'שגרה מלאה' }] },
    });
    const posts = await mockEndpoint(page);
    await connect(page);
    await page.click('#syncTest');
    await expect(page.locator('#toast')).toContainText('החיבור תקין');
    await page.click('#syncAll');
    await expect.poll(() => posts.length).toBeGreaterThan(0);
    const full = posts.find(p => p.full === true);
    expect(full.action).toBe('batch');
    expect(full.measurements).toHaveLength(1);
    expect(full.measurements[0]).toMatchObject({ id: 'drag|2026-10-16T13:34:42.760Z', type: 'מקסימום נקי', clean: 90, hard: 100, category: 'רודימנטים' });
    expect(full.sessions.map(x => x.id).sort()).toEqual(['day_2026-10-16', 's_x']);
    expect(full.snapshot.app).toBe('rimon-rudiments');
    await expect(page.locator('#syncStatus')).toContainText('מסונכרן');
  });

  test('a rated routine step is posted as a working-tempo row', async ({ page }) => {
    const posts = await mockEndpoint(page);
    await connect(page);
    // run the first step quickly: shorten it in the routine editor (0.25 min)
    await page.locator('#routineEditor [data-i="0"] [data-k="min"]').fill('0.25');
    await page.locator('#routineEditor [data-i="0"] [data-k="min"]').press('Enter');
    await page.locator('#routineEditor [data-i="0"] [data-k="title"]').click();
    await page.goto(page.url().replace(/#.*$/, '#practice'));
    await page.click('#pPlay');
    await expect(page.locator('#restPanel')).toBeVisible({ timeout: 25000 });
    await page.click('#restPanel [data-rate="clean"]');

    await expect.poll(() => posts.flatMap(p => p.measurements || []).length, { timeout: 10000 }).toBeGreaterThan(0);
    const row = posts.flatMap(p => p.measurements || [])[0];
    expect(row).toMatchObject({ subId: 'single8', type: 'טמפו עבודה', clean: 120, hard: null, rudiment: 'סינגל סטרוק' });
    expect(row.notes).toContain('דירוג: נקי');
    expect(row.id).toMatch(/^single8\|/);
  });

  test('offline queue: failures are kept and retried', async ({ page }) => {
    let fail = true; const posts = [];
    await page.route(URL + '**', async (route) => {
      if (route.request().method() !== 'POST') return route.fulfill({ status: 200, headers: CORS, body: '{"ok":true}' });
      if (fail) return route.fulfill({ status: 500, headers: CORS, body: 'err' });
      posts.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, headers: CORS, body: '{"ok":true}' });
    });
    await connect(page);
    await page.goto(page.url().replace(/#.*$/, '#library'));
    await page.click('.ex[data-ex="flam"] .ex-head');
    await page.click('.sub[data-sub="flamL"] [data-act="log"]');
    await page.fill('#fLogBpm', '125');
    await page.getByRole('button', { name: 'מקסימום נקי (מדידה)' }).click();
    await expect.poll(() => rt(page, () => window.__rt.sync().status), { timeout: 10000 }).toBe('err');
    expect((await rt(page, () => window.__rt.sync())).queue.length).toBe(1);
    fail = false;
    await rt(page, () => window.__rt.syncFlush());
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].measurements[0]).toMatchObject({ subId: 'flamL', type: 'מקסימום נקי', clean: 125 });
    expect((await rt(page, () => window.__rt.sync())).queue.length).toBe(0);
  });

  test('no URL configured → nothing is sent and the URL is never hardcoded', async ({ page }) => {
    let calls = 0;
    await page.route('https://script.google.com/**', r => { calls++; return r.abort(); });
    await open(page, 'settings');
    await expect(page.locator('#syncUrl')).toHaveValue('');
    await expect(page.locator('#syncStatus')).toContainText('לא מוגדר');
    await page.waitForTimeout(500);
    expect(calls).toBe(0);
  });
});
