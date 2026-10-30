const { test, expect } = require('@playwright/test');
const { open, rt } = require('./helpers');

const P = (page) => rt(page, () => window.__rt.P());
const bpm = (page, i) => rt(page, (i) => window.__rt.plan().routine2[i].bpm, i);

test.describe('keyboard shortcuts (practice)', () => {
  test.beforeEach(async ({ page }) => { await page.clock.install({ time: new Date('2026-10-19T10:00:00') }); });

  test('Space, arrows (RTL), Shift, F / Esc, 1-2-3', async ({ page }) => {
    await open(page, 'practice');
    await expect(page.locator('.keys').first()).toContainText('רווח');

    // idle: Left = next step, Right = previous (RTL)
    await page.keyboard.press('ArrowLeft');
    expect((await P(page)).idx).toBe(1);
    await page.keyboard.press('ArrowRight');
    expect((await P(page)).idx).toBe(0);

    // tempo ±1, Shift ±5 – persisted on the step, never automatic
    await page.keyboard.press('ArrowUp');
    expect(await bpm(page, 0)).toBe(121);
    await page.keyboard.press('Shift+ArrowUp');
    expect(await bpm(page, 0)).toBe(126);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    expect(await bpm(page, 0)).toBe(120);
    await expect(page.locator('#stageBpm')).toHaveText('120');

    // Space starts, live tempo change reaches the metronome
    await page.keyboard.press('Space');
    expect((await P(page)).phase).toBe('countin');
    await page.clock.fastForward(2300);
    expect((await P(page)).phase).toBe('play');
    await page.keyboard.press('ArrowUp');
    expect(await rt(page, () => window.__rt.metro().bpm)).toBe(121);

    // Space pauses / resumes
    await page.keyboard.press('Space');
    let p = await P(page);
    expect(p.paused).toBe(true);
    expect(await rt(page, () => window.__rt.metro().running)).toBe(false);
    await page.keyboard.press('Space');
    expect((await P(page)).paused).toBe(false);
    expect(await rt(page, () => window.__rt.metro().running)).toBe(true);

    // F opens focus mode, Esc closes it
    await page.keyboard.press('f');
    await expect(page.locator('#focus')).toBeVisible();
    await expect(page.locator('#focus [data-p="bpm"]')).toHaveText('121');
    await page.keyboard.press('Escape');
    await expect(page.locator('#focus')).toBeHidden();

    // Left while playing skips to the next step
    await page.keyboard.press('ArrowLeft');
    p = await P(page);
    expect(p.idx).toBe(1);
    expect(p.skipped).toEqual([0]);

    // finish step 2 and rate it with the keyboard ("3" = נשבר)
    await page.clock.fastForward(3200);
    await page.clock.fastForward(7 * 60000);
    expect((await P(page)).phase).toBe('rest');
    await page.keyboard.press('3');
    expect((await P(page)).results['1'].rating).toBe('broke');
    const st = await rt(page, () => window.__rt.state());
    expect(st.entries.flamL[0]).toMatchObject({ kind: 'work', rating: 'broke', work: 80 });
    await page.keyboard.press('1');
    expect((await rt(page, () => window.__rt.state())).entries.flamL[0].rating).toBe('clean');

    // in the rest, arrows adjust the upcoming step
    await page.keyboard.press('ArrowDown');
    expect(await bpm(page, 2)).toBe(99);

    // Left during the rest = continue now
    await page.keyboard.press('ArrowLeft');
    p = await P(page);
    expect(p.idx).toBe(2);
    expect(p.phase).toBe('countin');
  });

  test('shortcuts are ignored while typing in a field', async ({ page }) => {
    await open(page, 'settings');
    await page.click('#syncCode');
    await page.keyboard.press('Space');
    await page.goto(page.url().replace(/#.*$/, '#practice'));
    expect((await P(page)).phase).toBe('idle');
  });

  test('wake lock is requested while practising', async ({ page }) => {
    await open(page, 'practice');
    await page.keyboard.press('Space');
    await page.clock.fastForward(500);
    expect(['wakelock', 'fallback']).toContain(await rt(page, () => window.__rt.wake()));
  });
});
