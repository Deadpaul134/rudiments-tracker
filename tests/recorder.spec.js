const { test, expect } = require('@playwright/test');
const { K, seed, open, rt } = require('./helpers');

/** Fake mic + MediaRecorder. opts.supported = mime types isTypeSupported() accepts, opts.deny = reject getUserMedia. */
async function mockMedia(page, opts = {}) {
  await page.addInitScript((opts) => {
    const M = window.__media = { tracksStopped: 0, gum: 0, revoked: [], mimeAsked: null };
    const rev = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (u) => { M.revoked.push(u); rev(u); };
    if (opts.noRecorder) { delete window.MediaRecorder; return; }
    const md = navigator.mediaDevices || {};
    md.getUserMedia = (c) => {
      M.gum++; M.constraints = c;
      if (opts.deny) return Promise.reject(new DOMException('denied', 'NotAllowedError'));
      return Promise.resolve({ getTracks: () => [{ kind: 'audio', stop: () => { M.tracksStopped++; } }] });
    };
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: md });
    class FakeRecorder {
      constructor(stream, o) { this.stream = stream; this.mimeType = (o && o.mimeType) || 'audio/webm'; this.state = 'inactive'; M.mimeAsked = o ? o.mimeType : ''; }
      static isTypeSupported(t) { return (opts.supported || []).includes(t); }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        setTimeout(() => { this.ondataavailable({ data: new Blob(['fake-audio'], { type: this.mimeType }) }); this.onstop(); }, 0);
      }
    }
    window.MediaRecorder = FakeRecorder;
  }, opts);
}
const media = (page) => rt(page, () => window.__media);
const R = (page) => rt(page, () => window.__rt.rec());

test.describe('practice recording (30 s, in-memory)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-19T10:00:00') });
    await seed(page, { [K]: { __v: 2, custom: {}, entries: {} } });
  });

  test('records, auto-stops at 30 s, releases the mic and plays back', async ({ page }) => {
    await mockMedia(page, { supported: ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] });
    await open(page, 'practice');
    await expect(page.locator('#recPlay')).toBeDisabled();
    await page.click('#recBtn');
    await expect(page.locator('#recTool')).toHaveAttribute('data-state', 'rec');
    expect((await media(page)).mimeAsked).toBe('audio/webm;codecs=opus');
    await expect(page.locator('#recLbl')).toHaveText('עצור');
    await page.clock.runFor(10000);
    await expect(page.locator('#recTime')).toHaveText('נותרו 0:20');
    await page.clock.runFor(20500);
    await expect(page.locator('#recTool')).toHaveAttribute('data-state', 'idle');
    const r = await R(page);
    expect(r.url).toMatch(/^blob:/);
    expect(r.ms).toBe(30000);
    expect((await media(page)).tracksStopped).toBe(1);
    await expect(page.locator('#recTime')).toHaveText('הקלטה של 0:30');
    await expect(page.locator('#recPlay')).toBeEnabled();
    expect(await rt(page, () => document.getElementById('recAudio').src)).toBe(r.url);
    // nothing persisted or synced
    expect(await rt(page, () => Object.keys(localStorage).some((k) => /rec/i.test(k)))).toBe(false);
  });

  test('manual stop; a new take replaces (and revokes) the old one', async ({ page }) => {
    await mockMedia(page, { supported: ['audio/mp4'] }); // iPad / Safari
    await open(page, 'practice');
    await page.click('#recBtn');
    expect((await media(page)).mimeAsked).toBe('audio/mp4');
    await page.clock.runFor(4000);
    await page.click('#recBtn');
    await page.clock.runFor(100);
    const first = (await R(page)).url;
    expect(first).toMatch(/^blob:/);
    expect(Math.round((await R(page)).ms / 1000)).toBe(4);
    await page.click('#recBtn');
    await page.clock.runFor(2000);
    await page.click('#recBtn');
    await page.clock.runFor(100);
    const second = (await R(page)).url;
    expect(second).not.toBe(first);
    expect((await media(page)).revoked).toEqual([first]);
    expect((await media(page)).tracksStopped).toBe(2);
  });

  test('falls back to the default mime type when none is supported', async ({ page }) => {
    await mockMedia(page, { supported: [] });
    await open(page, 'practice');
    expect(await rt(page, () => window.RT.recorder.pickMime())).toBe('');
    await page.click('#recBtn');
    expect((await media(page)).mimeAsked).toBe('');
  });

  test('permission denied → short Hebrew message, nothing recorded', async ({ page }) => {
    await mockMedia(page, { deny: true });
    await open(page, 'practice');
    await page.click('#recBtn');
    await expect(page.locator('#recMsg')).toHaveText(/אין הרשאה למיקרופון/);
    await expect(page.locator('#recTool')).toHaveAttribute('data-state', 'idle');
    await expect(page.locator('#recPlay')).toBeDisabled();
  });

  test('unsupported browser → short Hebrew message', async ({ page }) => {
    await mockMedia(page, { noRecorder: true });
    await open(page, 'practice');
    await page.click('#recBtn');
    await expect(page.locator('#recMsg')).toHaveText('ההקלטה לא נתמכת בדפדפן הזה');
  });
});
