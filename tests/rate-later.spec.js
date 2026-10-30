const { test, expect } = require('@playwright/test');
const { K, seed, open, rt } = require('./helpers');
const { createD1, routeToFunction } = require('./d1-fake');

const countIn = (bpm) => Math.ceil(4 * 60000 / bpm) + 200;
const NOW = new Date('2026-10-19T10:00:00');
const work = (date, bpm, rating, extra = {}) => ({ date, kind: 'work', work: bpm, clean: null, hard: null, broke: [], notes: '', src: 'routine', ...(rating ? { rating } : {}), ...extra });
const MAX = { date: '2026-10-10T10:00:00.000Z', clean: 225, hard: 235, broke: [], notes: '' };
const state = (entries) => ({ [K]: { __v: 2, custom: {}, entries } });
const single8 = (page) => rt(page, () => window.__rt.state().entries.single8);
const modalBtn = (page, name) => page.locator('#modalBtns button', { hasText: name });

test.describe('rating after the fact', () => {
  test.beforeEach(async ({ page }) => { await page.clock.install({ time: NOW }); });

  test('end-of-routine summary: rate a missed step, change it, clear it; clean max untouched', async ({ page }) => {
    await seed(page, { ...state({ single8: [MAX] }),
      [K + '-plan']: { days: {}, steps: {}, kit: {}, sessions: {}, routine: {},
        routine2: [{ title: 'חימום – סינגל סטרוק', desc: '', min: 0.25, bpm: 120, sub: 1, link: 'single8' }] } });
    await open(page, 'practice');
    await page.click('#pPlay');
    await page.clock.fastForward(countIn(120));
    await page.clock.fastForward(15000 + 300);
    expect((await rt(page, () => window.__rt.P())).phase).toBe('rest');
    await page.clock.fastForward(15000 + 300);                 // rest ends without a rating
    expect((await rt(page, () => window.__rt.P())).phase).toBe('done');
    let w = (await single8(page)).filter((x) => x.kind === 'work');
    expect(w).toHaveLength(1);
    expect(w[0].rating).toBeUndefined();

    const row = page.locator('#donePanel [data-done-i="0"]');
    await row.locator('[data-rl="clean"]').click();
    await expect(row.locator('[data-rl="clean"]')).toHaveClass(/\bon\b/);
    w = (await single8(page)).filter((x) => x.kind === 'work');
    expect(w).toHaveLength(1);                                  // same entry, not a new one
    expect(w[0].rating).toBe('clean');

    await row.locator('[data-rl="broke"]').click();
    expect((await single8(page)).filter((x) => x.kind === 'work')[0].rating).toBe('broke');
    await row.locator('[data-rl="broke"]').click();             // tapping the current one clears it
    expect((await single8(page)).filter((x) => x.kind === 'work')[0].rating).toBeUndefined();
    await expect(row.locator('.rl-b.on')).toHaveCount(0);

    expect((await single8(page)).filter((x) => x.kind !== 'work').map((x) => x.clean)).toEqual([225]);
  });

  test('progress history: rate, change and remove the rating of a working tempo', async ({ page }) => {
    await seed(page, state({ single8: [MAX, work('2026-10-17T10:00:00.000Z', 120)] }));
    await open(page, 'progress');
    const hist = page.locator('#pgHist');
    await expect(hist.locator('[data-rate-entry]')).toHaveCount(1);   // only the working tempo has a rating button
    await expect(hist.locator('[data-rate-entry]')).toHaveText('ללא דירוג');

    await hist.locator('[data-rate-entry]').click();
    await modalBtn(page, 'סביר').click();
    await expect(hist.locator('[data-rate-entry]')).toHaveText('סביר');
    expect((await single8(page))[1].rating).toBe('ok');

    await hist.locator('[data-rate-entry]').click();
    await expect(modalBtn(page, 'סביר ✓')).toBeVisible();
    await modalBtn(page, 'ללא דירוג').click();
    await expect(hist.locator('[data-rate-entry]')).toHaveText('ללא דירוג');
    expect((await single8(page))[1].rating).toBeUndefined();
    expect((await single8(page))[0]).toEqual(MAX);
  });

  test('home reminder counts unrated routine steps from the last 7 days and opens a rating window', async ({ page }) => {
    await seed(page, state({
      single8: [MAX, work('2026-10-19T09:00:00.000Z', 120), work('2026-10-18T09:00:00.000Z', 120, 'clean')],
      flamL: [work('2026-10-14T09:00:00.000Z', 80),               // 6 days ago → counted
        work('2026-10-10T09:00:00.000Z', 80),                       // older than 7 days → not counted
        work('2026-10-18T19:00:00.000Z', 85, null, { src: undefined })], // manual log → not counted
    }));
    await open(page, 'home');
    await expect(page.locator('#rateBar')).toBeVisible();
    await expect(page.locator('#rateText')).toContainText('2');
    expect((await rt(page, () => window.__rt.unrated())).map((o) => o.id)).toEqual(['single8', 'flamL']);

    await page.click('#rateOpen');
    const items = page.locator('#modalBody .rate-list li');
    await expect(items).toHaveCount(2);
    await items.nth(0).locator('[data-rl="clean"]').click();
    await expect(page.locator('#rateText')).toContainText('שלב אחד');
    await items.nth(1).locator('[data-rl="ok"]').click();
    await expect(items.nth(1).locator('[data-rl="ok"]')).toHaveClass(/\bon\b/);
    await modalBtn(page, 'סיום').click();
    await expect(page.locator('#rateBar')).toBeHidden();
    const s = await rt(page, () => window.__rt.state());
    expect(s.entries.single8[1].rating).toBe('clean');
    expect(s.entries.flamL[0].rating).toBe('ok');
    expect(s.entries.flamL[1].rating).toBeUndefined();          // old one untouched
  });

  test('a late rating counts toward the 3-clean streak; a late "broke" breaks it', async ({ page }) => {
    await seed(page, state({ single8: [MAX,
      work('2026-10-16T10:00:00.000Z', 120, 'clean'),
      work('2026-10-17T10:00:00.000Z', 120, 'clean'),
      work('2026-10-18T10:00:00.000Z', 120)] }));
    await open(page, 'home');
    expect(await rt(page, () => window.RT.cleanStreak('single8', 120))).toBe(2);
    await page.click('#rateOpen');
    await page.locator('#modalBody .rate-list li').first().locator('[data-rl="clean"]').click();
    expect(await rt(page, () => window.RT.cleanStreak('single8', 120))).toBe(3);
    // at the next practice the suggestion is there as soon as the step is rated clean
    await modalBtn(page, 'סיום').click();
    await page.goto(page.url().replace(/#.*$/, '#practice'));
    await page.click('#pPlay');
    await page.clock.fastForward(countIn(120));
    await page.clock.fastForward(3 * 60000 + 300);
    await page.click('#restPanel [data-rate="clean"]');
    await expect(page.locator('#restPanel [data-raise-box]')).toBeVisible();
    // tempo itself is never changed without a tap
    expect((await rt(page, () => window.__rt.plan())).routine2[0].bpm).toBe(120);

    // late "broke" on the newest one breaks the streak
    await rt(page, () => { const e = window.RT.state.entries.single8; window.RT.setRating('single8', e[e.length - 1], 'broke'); });
    expect(await rt(page, () => window.RT.cleanStreak('single8', 120))).toBe(0);
  });

  test('setRating refuses clean-max entries', async ({ page }) => {
    await seed(page, state({ single8: [MAX] }));
    await open(page, 'home');
    expect(await rt(page, () => window.RT.setRating('single8', window.RT.state.entries.single8[0], 'clean'))).toBe(false);
    expect((await single8(page))[0]).toEqual(MAX);
  });

  test('a late rating is synced to the cloud as an edit of the same record', async ({ page }) => {
    const env = { DB: createD1(), SYNC_CODE: 'code-1' };
    const date = '2026-10-18T10:00:00.000Z';
    await seed(page, state({ single8: [MAX, work(date, 120)] }));
    await routeToFunction(page, 'https://sync.test', env);
    await open(page, 'settings');
    await page.fill('#syncCode', 'code-1');
    await page.fill('#syncServer', 'https://sync.test');
    await page.click('#syncSave');
    const row = () => { const r = env.DB.raw.prepare('SELECT data FROM records WHERE kind=? AND id=?').get('e', 'single8|' + date); return r && JSON.parse(r.data); };
    await expect.poll(row, { timeout: 10000 }).toBeTruthy();
    expect(row().rating).toBeUndefined();
    await page.goto(page.url().replace(/#.*$/, '#progress'));
    await page.locator('#pgHist [data-rate-entry]').click();
    await modalBtn(page, 'נקי').click();
    await page.clock.fastForward(3000);
    await expect.poll(() => row() && row().rating, { timeout: 10000 }).toBe('clean');
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='e'").get().n).toBe(2);
  });
});
