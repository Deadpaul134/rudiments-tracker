const { test, expect } = require('@playwright/test');
const { K, seed, open, rt } = require('./helpers');

const countIn = (bpm) => Math.ceil(4 * 60000 / bpm) + 200;
const work = (date, bpm, rating) => ({ date, kind: 'work', work: bpm, clean: null, hard: null, broke: [], notes: '', src: 'routine', ...(rating ? { rating } : {}) });

// step 1 of the default routine is single8 @ 120 BPM, 3 minutes
async function toRest(page) {
  await open(page, 'practice');
  await page.click('#pPlay');
  await page.clock.fastForward(countIn(120));
  await page.clock.fastForward(3 * 60000 + 300);
  expect((await rt(page, () => window.__rt.P())).phase).toBe('rest');
}
const box = (page) => page.locator('#restPanel [data-raise-box]');

test.describe('3 clean in a row → +4 BPM target suggestion', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-19T10:00:00') });
    await seed(page, { [K]: { __v: 2, custom: {}, entries: { single8: [
      { date: '2026-10-10T10:00:00.000Z', clean: 225, hard: 235, broke: [], notes: '' },
      work('2026-10-16T10:00:00.000Z', 120, 'clean'),
      work('2026-10-17T10:00:00.000Z', 120),            // unrated – doesn't break the streak
      work('2026-10-18T10:00:00.000Z', 120, 'clean'),
    ] } } });
  });

  test('pure streak counter', async ({ page }) => {
    await open(page, 'home');
    expect(await rt(page, () => window.RT.cleanStreak('single8', 120))).toBe(2);
    expect(await rt(page, () => window.RT.cleanStreak('single8', 124))).toBe(0);
    expect(await rt(page, () => window.RT.raiseSuggestion(0))).toBeNull();
  });

  test('third clean shows the suggestion; accept raises the step target by 4', async ({ page }) => {
    await toRest(page);
    await expect(box(page)).toBeHidden();
    await page.click('#restPanel [data-rate="clean"]');
    await expect(box(page)).toBeVisible();
    await expect(box(page).locator('[data-raise="accept"]')).toHaveText('העלה ל-124');
    // rating something else removes it again (streak broken), clean brings it back
    await page.click('#restPanel [data-rate="ok"]');
    await expect(box(page)).toBeHidden();
    await page.click('#restPanel [data-rate="clean"]');
    await expect(box(page)).toBeVisible();

    await box(page).locator('[data-raise="accept"]').click();
    await expect(box(page)).toBeHidden();
    const plan = await rt(page, () => window.__rt.plan());
    expect(plan.routine2[0].bpm).toBe(124);
    expect(plan.routine2[1].bpm).toBe(80); // the next step is untouched
    // clean max never touched
    const st = await rt(page, () => window.__rt.state());
    expect(st.entries.single8.filter(x => x.kind !== 'work').map(x => x.clean)).toEqual([225]);
    await expect(page.locator('#pSteps li[data-step="0"] .step-bpm')).toHaveText('124');
  });

  test('dismiss hides it and it stays dismissed for that BPM', async ({ page }) => {
    await toRest(page);
    await page.keyboard.press('1');
    await expect(box(page)).toBeVisible();
    await box(page).locator('[data-raise="dismiss"]').click();
    await expect(box(page)).toBeHidden();
    expect((await rt(page, () => window.__rt.plan())).routine2[0].bpm).toBe(120);
    expect((await rt(page, () => window.__rt.ui())).raiseOff).toEqual({ 'single8@120': 1 });
    await page.keyboard.press('1');
    await expect(box(page)).toBeHidden();
    // also after a reload (persisted in the ui key)
    await page.reload(); await page.waitForFunction(() => !!window.__rt);
    expect(await rt(page, () => window.RT.raiseSuggestion(0))).toBeNull();
  });

  test('focus mode shows the same suggestion', async ({ page }) => {
    await toRest(page);
    await page.keyboard.press('f');
    await page.keyboard.press('1');
    const fbox = page.locator('#focus [data-raise-box]');
    await expect(fbox).toBeVisible();
    await fbox.locator('[data-raise="accept"]').click();
    expect((await rt(page, () => window.__rt.plan())).routine2[0].bpm).toBe(124);
  });
});
