const { test, expect } = require('@playwright/test');
const { K, seed, open, rt } = require('./helpers');

// count-in (4 beats) at bpm + small scheduling margin
const countIn = (bpm) => Math.ceil(4 * 60000 / bpm) + 200;
const P = (page) => rt(page, () => window.__rt.P());

test.describe('practice routine: auto-advance + rating logging', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-19T10:00:00') });
    await seed(page, { [K]: { __v: 2, custom: {}, entries: {
      single8: [{ date: '2026-10-16T13:12:57.743Z', clean: 225, hard: 235, broke: [], notes: '' }] } } });
  });

  test('count-in → step → rest with rating → next step starts automatically', async ({ page }) => {
    await open(page, 'home');
    await page.click('#startToday');
    await expect(page).toHaveURL(/#practice$/);
    expect((await P(page)).phase).toBe('countin');
    expect(await rt(page, () => window.__rt.metro().running)).toBe(true);

    await page.clock.fastForward(countIn(120));
    expect((await P(page)).phase).toBe('play');
    await expect(page.locator('#stage [data-p="name"]')).toHaveText('חימום – סינגל סטרוק');
    await expect(page.locator('#stageBpm')).toHaveText('120');

    await page.clock.fastForward(3 * 60000);
    let p = await P(page);
    expect(p.phase).toBe('rest');
    expect(p.restIdx).toBe(0);
    await expect(page.locator('#restPanel')).toBeVisible();
    expect(await rt(page, () => window.__rt.metro().log.some(e => e.ev === 'chime' && e.kind === 'end'))).toBe(true);
    // the rest panel previews the next step
    await expect(page.locator('#restPanel [data-p="nextname"]')).toHaveText('פלאם יד שמאל');

    await page.click('#restPanel [data-rate="clean"]');
    let st = await rt(page, () => window.__rt.state());
    const w = st.entries.single8.filter(x => x.kind === 'work');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ kind: 'work', work: 120, rating: 'clean', clean: null, hard: null });
    // clean max untouched
    expect(st.entries.single8.filter(x => x.kind !== 'work').map(x => x.clean)).toEqual([225]);

    // changing the rating during the rest updates the same entry
    await page.click('#restPanel [data-rate="ok"]');
    st = await rt(page, () => window.__rt.state());
    expect(st.entries.single8.filter(x => x.kind === 'work').map(x => x.rating)).toEqual(['ok']);

    // ~15 s rest, then the next step's count-in starts by itself
    await page.clock.fastForward(15000 + 300);
    p = await P(page);
    expect(p.idx).toBe(1);
    expect(p.phase).toBe('countin');
    expect(await rt(page, () => window.__rt.metro().bpm)).toBe(80);

    // unrated step: working tempo is still logged at the end of the rest
    await page.clock.fastForward(countIn(80));
    await page.clock.fastForward(7 * 60000);
    await page.clock.fastForward(15300);
    p = await P(page);
    expect(p.idx).toBe(2);
    st = await rt(page, () => window.__rt.state());
    expect(st.entries.flamL).toHaveLength(1);
    expect(st.entries.flamL[0]).toMatchObject({ kind: 'work', work: 80 });
    expect(st.entries.flamL[0].rating).toBeUndefined();
    expect(await rt(page, () => window.__rt.metro().sub)).toBe(2); // step 3 is in eighths
  });

  test('full routine marks the day, logs a session and never writes a clean max', async ({ page }) => {
    await open(page, 'practice');
    await page.click('#pPlay');
    const steps = await rt(page, () => window.__rt.plan().routine2);
    for (let i = 0; i < steps.length; i++) {
      await page.clock.fastForward(countIn(steps[i].bpm));
      await page.clock.fastForward(steps[i].min * 60000);
      expect((await P(page)).phase).toBe('rest');
      await page.keyboard.press(String((i % 3) + 1));
      await page.clock.fastForward(15300);
    }
    const p = await P(page);
    expect(p.phase).toBe('done');
    await expect(page.locator('#donePanel')).toBeVisible();
    const plan = await rt(page, () => window.__rt.plan());
    expect(plan.days['2026-10-19']).toBe(1);
    expect(plan.steps['2026-10-19']).toEqual([0, 1, 2, 3, 4]);
    expect(plan.log).toHaveLength(1);
    expect(plan.log[0]).toMatchObject({ kind: 'שגרה מלאה', minutes: 25 });
    expect(plan.log[0].steps).toContain('נקי');
    const st = await rt(page, () => window.__rt.state());
    const all = Object.values(st.entries).flat();
    expect(all.filter(x => x.kind === 'work')).toHaveLength(5);
    expect(all.filter(x => x.kind !== 'work').map(x => x.clean)).toEqual([225]);
    // home shows the completed day
    await page.goto(page.url().replace(/#.*$/, '#home'));
    await expect(page.locator('#homeRingN')).toHaveText('5/5');
    await expect(page.locator('#stStreak')).toHaveText('1');
  });

  test('stopping mid-routine logs a partial session', async ({ page }) => {
    await open(page, 'practice');
    await page.click('#pPlay');
    await page.clock.fastForward(countIn(120));
    await page.clock.fastForward(3 * 60000 + 300);
    await page.click('#restPanel [data-rate="broke"]');
    await page.click('#pStop');
    const p = await P(page);
    expect(p.phase).toBe('idle');
    const plan = await rt(page, () => window.__rt.plan());
    expect(plan.log[0].kind).toBe('שגרה – נעצרה באמצע');
    expect(plan.steps['2026-10-19']).toEqual([0]);
    expect(plan.days['2026-10-19']).toBeUndefined();
    expect(await rt(page, () => window.__rt.metro().running)).toBe(false);
  });
});
