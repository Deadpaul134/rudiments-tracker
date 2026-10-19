const { test, expect } = require('@playwright/test');
const { K, seed, open, rt } = require('./helpers');

test.describe('gap metronome (X bars click / Y bars silent)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-19T10:00:00') });
    await seed(page, { [K]: { __v: 2, custom: {}, entries: {} } });
  });

  test('pure bar logic: defaults 3 on / 1 off, off = never silent', async ({ page }) => {
    await open(page, 'practice');
    const res = await rt(page, () => {
      const on = { on: true, play: 3, mute: 1 }, off = { on: false, play: 3, mute: 1 }, two = { on: true, play: 2, mute: 2 };
      const run = (g) => [0, 1, 2, 3, 4, 5, 6, 7].map((n) => window.RT.gapSilent(n, g));
      return { on: run(on), off: run(off), two: run(two), countIn: window.RT.gapSilent(-1, on) };
    });
    expect(res.on).toEqual([false, false, false, true, false, false, false, true]);
    expect(res.off.every((x) => !x)).toBe(true);
    expect(res.two).toEqual([false, false, true, true, false, false, true, true]);
    expect(res.countIn).toBe(false);
  });

  test('off by default; toggle + bar counts persist with the metronome settings', async ({ page }) => {
    await open(page, 'practice');
    expect((await rt(page, () => window.__rt.metro())).gap).toEqual({ on: false, play: 3, mute: 1 });
    await expect(page.locator('#gapOn')).not.toBeChecked();
    await page.locator('#gapTool .sw').click();
    await page.fill('#gapPlay', '2');
    await page.locator('#gapPlay').dispatchEvent('change');
    await page.reload(); await page.waitForFunction(() => !!window.__rt);
    await expect(page.locator('#gapOn')).toBeChecked();
    await expect(page.locator('#gapPlay')).toHaveValue('2');
    await expect(page.locator('#gapMute')).toHaveValue('1');
    const saved = await rt(page, (k) => JSON.parse(localStorage.getItem(k + '-metro')), K);
    expect(saved.gap).toEqual({ on: true, play: 2, mute: 1 });
  });

  test('silent bars keep the clock and a dimmed beat indicator going', async ({ page }) => {
    // wall-clock path of the scheduler (no Web Audio) → deterministic under the fake clock
    await page.addInitScript(() => { delete window.AudioContext; delete window.webkitAudioContext; });
    await open(page, 'practice');
    await page.locator('#gapTool .sw').click();
    await rt(page, () => { window.__beats = []; window.RT.metro.onBeat((b, c, s) => { if (b >= 0 && !c) window.__beats.push(!!s); }); });
    await page.click('#pPlay'); // step 1: 120 BPM → 0.5 s per beat, 2 s per bar
    await page.clock.runFor(2000 + 3 * 2000 + 1000); // count-in + 3 audible bars + half of the silent bar
    await expect(page.locator('#stage [data-beats]')).toHaveClass(/mute/);
    expect(await rt(page, () => window.__rt.metro().running)).toBe(true);
    await page.clock.runFor(1000 + 2000); // rest of the silent bar + one audible bar
    await expect(page.locator('#stage [data-beats]')).not.toHaveClass(/mute/);
    const beats = await rt(page, () => window.__beats);
    // 5 bars × 4 beats, nothing dropped: 12 audible, 4 silent, 4 audible
    expect(beats.slice(0, 20)).toEqual([...Array(12).fill(false), ...Array(4).fill(true), ...Array(4).fill(false)]);
    expect((await rt(page, () => window.__rt.P())).phase).toBe('play');
  });

  test('gap off → every bar has a click', async ({ page }) => {
    await page.addInitScript(() => { delete window.AudioContext; delete window.webkitAudioContext; });
    await open(page, 'practice');
    await rt(page, () => { window.__beats = []; window.RT.metro.onBeat((b, c, s) => { if (b >= 0 && !c) window.__beats.push(!!s); }); });
    await page.click('#pPlay');
    await page.clock.runFor(2000 + 5 * 2000);
    const beats = await rt(page, () => window.__beats);
    expect(beats.length).toBeGreaterThanOrEqual(19);
    expect(beats.every((s) => !s)).toBe(true);
  });
});
