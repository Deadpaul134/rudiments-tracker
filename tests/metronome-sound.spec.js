const { test, expect } = require('@playwright/test');
const { K, seed, open, rt } = require('./helpers');

const SOUNDS = ['click', 'cowbell', 'woodblock', 'beep'];

async function setVol(page, v) {
  await page.locator('#setVol').evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
}
const saved = (page) => rt(page, (k) => JSON.parse(localStorage.getItem(k + '-settings') || 'null'), K);

test.describe('metronome sound, volume and loud mode', () => {
  test('defaults: sharp click, volume 80, loud off – shown in settings and practice', async ({ page }) => {
    await seed(page, { [K]: { __v: 2, custom: {}, entries: {} } });
    await open(page, 'settings');
    const s = await rt(page, () => window.__rt.settings());
    expect([s.metroSound, s.metroVolume, s.metroLoud]).toEqual(['click', 80, false]);
    await expect(page.locator('#metroSoundSeg [data-sound="click"]')).toHaveClass(/on/);
    await expect(page.locator('#metroSoundSeg [data-sound="click"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#setVol')).toHaveValue('80');
    await expect(page.locator('#setVolVal')).toHaveText('80');
    await expect(page.locator('#setLoud')).not.toBeChecked();
    await open(page, 'practice');
    await expect(page.locator('#pSound')).toHaveValue('click');
  });

  test('old settings without metronome keys keep their values and gain the defaults', async ({ page }) => {
    await seed(page, { [K]: { __v: 2, custom: {}, entries: {} }, [K + '-settings']: { restSec: 20, countIn: 4, subClicks: false } });
    await open(page, 'settings');
    const s = await rt(page, () => window.__rt.settings());
    expect(s).toMatchObject({ restSec: 20, subClicks: false, metroSound: 'click', metroVolume: 80, metroLoud: false });
    await expect(page.locator('#setRest')).toHaveValue('20');
  });

  test('malformed saved values fall back safely', async ({ page }) => {
    await seed(page, { [K]: { __v: 2, custom: {}, entries: {} }, [K + '-settings']: { metroSound: 'gong', metroVolume: 'loud', metroLoud: 'yes' } });
    await open(page, 'settings');
    expect(await rt(page, () => window.__rt.settings())).toMatchObject({ metroSound: 'click', metroVolume: 80, metroLoud: false });
    const clamp = await rt(page, () => [window.RT.normMetroSettings({ metroVolume: 250 }).metroVolume, window.RT.normMetroSettings({ metroVolume: -3 }).metroVolume, window.RT.normMetroSettings({ metroVolume: '42.4' }).metroVolume]);
    expect(clamp).toEqual([100, 0, 42]);
  });

  test('sound, volume and loud mode persist across reloads', async ({ page }) => {
    await seed(page, { [K]: { __v: 2, custom: {}, entries: {} } });
    await open(page, 'settings');
    await page.click('#metroSoundSeg [data-sound="cowbell"]');
    await setVol(page, 35);
    await expect(page.locator('#setVolVal')).toHaveText('35');
    await page.locator('#metroCard label.sw:has(#setLoud)').click();
    expect(await saved(page)).toMatchObject({ metroSound: 'cowbell', metroVolume: 35, metroLoud: true });
    await page.reload(); await page.waitForFunction(() => !!window.__rt);
    await expect(page.locator('#metroSoundSeg [data-sound="cowbell"]')).toHaveClass(/on/);
    await expect(page.locator('#metroSoundSeg [data-sound="click"]')).not.toHaveClass(/on/);
    await expect(page.locator('#setVol')).toHaveValue('35');
    await expect(page.locator('#setLoud')).toBeChecked();
    expect(await rt(page, () => window.__rt.metro().log.filter((e) => e.ev === 'preview').length)).toBe(0);
  });

  test('practice-screen selector and settings stay in sync', async ({ page }) => {
    await seed(page, { [K]: { __v: 2, custom: {}, entries: {} } });
    await open(page, 'practice');
    await page.selectOption('#pSound', 'woodblock');
    expect((await saved(page)).metroSound).toBe('woodblock');
    await page.click('a[data-route="settings"]');
    await expect(page.locator('#metroSoundSeg [data-sound="woodblock"]')).toHaveClass(/on/);
    await page.click('#metroSoundSeg [data-sound="beep"]');
    await page.click('a[data-route="practice"]');
    await expect(page.locator('#pSound')).toHaveValue('beep');
  });

  test('every sound renders without errors, accent louder than the beat, limiter keeps peaks below 0 dBFS', async ({ page }) => {
    await seed(page, { [K]: { __v: 2, custom: {}, entries: {} } });
    await open(page, 'settings');
    const res = await rt(page, async (SOUNDS) => {
      const A = window.RT.metroAudio, out = {};
      for (const sound of SOUNDS) {
        for (const loud of [false, true]) {
          for (const vol of [50, 100]) {
            const rate = 44100, ctx = new OfflineAudioContext(1, rate * 2.2, rate);
            const o = A.makeOut(ctx);
            A.setOut(o, { metroVolume: vol, metroLoud: loud }, ctx);
            [3, 2, 1, 0].forEach((lvl, i) => A.voice(ctx, o.vol, 0.05 + i * 0.5, lvl, sound, loud));
            const d = (await ctx.startRendering()).getChannelData(0);
            const seg = (i) => { let pk = 0, e = 0; for (let j = Math.round((0.05 + i * 0.5) * rate); j < Math.round((0.5 + i * 0.5) * rate); j++) { const v = Math.abs(d[j]); if (v > pk) pk = v; e += v * v; } return { pk, e }; };
            const s = [0, 1, 2, 3].map(seg);
            out[sound + (loud ? '-loud' : '') + '-' + vol] = { peak: Math.max(...s.map((x) => x.pk)), countIn: s[0].e, accent: s[1].e, beat: s[2].e, sub: s[3].e };
          }
        }
      }
      return out;
    }, SOUNDS);
    for (const [k, r] of Object.entries(res)) {
      expect(r.peak, k).toBeGreaterThan(0.02);
      expect(r.peak, k).toBeLessThan(1);
      expect(r.countIn, k).toBeGreaterThan(0);
      expect(r.sub, k).toBeGreaterThan(0);
      if (k.endsWith('-50') && !k.includes('loud')) expect(r.accent, k).toBeGreaterThan(r.beat);
    }
    // loud mode is clearly louder at the same slider position
    for (const s of SOUNDS) expect(res[s + '-loud-50'].beat, s).toBeGreaterThan(res[s + '-50'].beat * 1.5);
    // volume 0 = silence
    const silent = await rt(page, async () => {
      const A = window.RT.metroAudio, ctx = new OfflineAudioContext(1, 22050, 44100), o = A.makeOut(ctx);
      A.setOut(o, { metroVolume: 0, metroLoud: true }, ctx); A.voice(ctx, o.vol, 0.01, 2, 'click', true);
      return Math.max(...(await ctx.startRendering()).getChannelData(0).map(Math.abs));
    });
    expect(silent).toBeLessThan(1e-4);
  });

  test('live metronome with gap mode runs every sound without errors, settings change while playing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await seed(page, { [K]: { __v: 2, custom: {}, entries: {} } });
    await open(page, 'settings');
    const ok = await rt(page, async (SOUNDS) => {
      const RT = window.RT, m = RT.metro, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      m.setGap({ on: true, play: 3, mute: 1 });
      m.setBpm(300);
      m.start({ countIn: 2, gap: true });
      for (const s of SOUNDS) {
        for (const loud of [false, true]) {
          Object.assign(RT.settings, { metroSound: s, metroLoud: loud, metroVolume: 100 });
          m.applySound();
          await wait(500);
        }
      }
      const running = m.ctx && m.ctx.state === 'running';
      m.stop();
      return { running, bar: m.bar };
    }, SOUNDS);
    expect(ok.running).toBe(true);
    expect(ok.bar).toBeGreaterThan(3); // passed through at least one silent gap bar
    await page.click('#metroPreview');
    expect(await rt(page, () => window.__rt.metro().log.some((e) => e.ev === 'preview'))).toBe(true);
    expect(errors).toEqual([]);
  });
});
