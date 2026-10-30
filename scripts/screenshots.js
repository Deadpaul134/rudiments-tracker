// Screenshots of every screen, light + dark, desktop (1440x900) + tablet (1024x768) → screenshots/
// Usage: npm run screenshots
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const OUT = path.join(ROOT, 'screenshots');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'reference', 'rudiments-data-2026-10-17.json'), 'utf8'));
const K = 'rimon-rudiments-v1';

const VIEWS = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 1024, height: 768 }];
const THEMES = ['light', 'dark'];

async function shoot(browser, view, theme) {
  const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, colorScheme: theme, deviceScaleFactor: 1, hasTouch: view.name === 'tablet' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-10-19T10:00:00') });
  // Paul's real data + a couple of practice days and working tempi so the screens show something meaningful
  const entries = JSON.parse(JSON.stringify(data.data.entries));
  entries.flamL.push({ date: '2026-10-18T09:00:00.000Z', kind: 'work', work: 85, clean: null, hard: null, broke: [], notes: '', rating: 'ok' });
  entries.flamL.push({ date: '2026-10-18T19:00:00.000Z', clean: 125, hard: 135, broke: [], notes: '', breakBpm: 140, src: 'measure' });
  entries.drag.push({ date: '2026-10-18T09:20:00.000Z', kind: 'work', work: 72, clean: null, hard: null, broke: [], notes: '', rating: 'clean' });
  // two clean takes at the step-3 tempo → rating it clean once more shows the +4 BPM suggestion
  entries.d_acc2.push({ date: '2026-10-17T09:30:00.000Z', kind: 'work', work: 110, clean: null, hard: null, broke: [], notes: '', rating: 'clean' });
  entries.d_acc2.push({ date: '2026-10-18T09:30:00.000Z', kind: 'work', work: 110, clean: null, hard: null, broke: [], notes: '', rating: 'clean' });
  entries.double8.push({ date: '2026-10-18T19:10:00.000Z', clean: 170, hard: 180, broke: [], notes: '', breakBpm: 185, src: 'measure' });
  const plan = JSON.parse(JSON.stringify(data.plan));
  plan.days['2026-10-17'] = 1; plan.days['2026-10-18'] = 1;
  plan.steps['2026-10-19'] = [0, 1];
  await page.addInitScript(({ K, entries, plan, theme }) => {
    if (sessionStorage.getItem('__seeded')) return;
    localStorage.clear();
    localStorage.setItem(K, JSON.stringify({ __v: 2, entries, custom: {} }));
    localStorage.setItem(K + '-plan', JSON.stringify(plan));
    localStorage.setItem(K + '-theme', JSON.stringify(theme));
    localStorage.setItem(K + '-v2meta', JSON.stringify({ migrated: true, at: '2026-10-19T07:00:00.000Z', fromV1: true }));
    sessionStorage.setItem('__seeded', '1');
  }, { K, entries, plan, theme });

  // fake microphone so the recorder can be shown (nothing is captured)
  await page.addInitScript(() => {
    const md = navigator.mediaDevices || {};
    md.getUserMedia = () => Promise.resolve({ getTracks: () => [{ stop() {} }] });
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: md });
    window.MediaRecorder = class { constructor() { this.mimeType = 'audio/webm'; this.state = 'inactive'; }
      static isTypeSupported() { return true; } start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; setTimeout(() => { this.ondataavailable({ data: new Blob(['x']) }); this.onstop(); }, 0); } };
  });

  const file = (n) => path.join(OUT, `${n}-${theme}-${view.name}.png`);
  const go = async (hash) => { await page.goto(URL + '#' + hash); await page.waitForFunction(() => !!window.__rt); await page.evaluate(() => document.fonts && document.fonts.ready); await page.waitForTimeout(250); };
  const snap = async (n, full = true) => { await page.waitForTimeout(150); await page.screenshot({ path: file(n), fullPage: full }); };

  await go('home'); await snap('01-home');

  await go('practice');
  await page.evaluate(() => window.RT.practice.start(2));
  await page.clock.fastForward(2300);
  await page.clock.fastForward(95000);
  await snap('02-practice');

  await page.evaluate(() => window.RT.setFocus(true));
  await snap('03-focus', false);
  await page.evaluate(() => window.RT.setFocus(false));
  // rest + rating prompt
  await page.clock.fastForward(6 * 60000);
  await snap('04-practice-rating');
  // third clean in a row at this tempo → one-tap +4 BPM suggestion
  await page.click('#restPanel [data-rate="clean"]');
  await snap('09-practice-raise');
  await page.evaluate(() => window.RT.practice.stop());

  // recorder (recording, with countdown) + gap metronome switched on
  await go('practice');
  await page.locator('#gapTool .sw').click();
  await page.evaluate(() => window.RT.practice.start(0));
  await page.clock.fastForward(2300);
  await page.clock.fastForward(20000);
  await page.click('#recBtn');
  await page.clock.runFor(7000);
  await snap('10-practice-tools');
  await page.click('#recBtn');
  await page.clock.runFor(200);
  await snap('11-practice-playback');
  await page.evaluate(() => { window.RT.practice.stop(); window.RT.metro.setGap({ on: false }); });

  await go('measure');
  await page.selectOption('#mSub', 'flamL');
  await page.click('#mGo');
  await page.clock.fastForward(3000);
  await page.clock.fastForward(30000);
  await page.clock.fastForward(12000);
  await page.click('#mMark');
  await snap('05-measure');
  await page.click('#mCancel');

  await go('progress'); await snap('06-progress');
  await go('library');
  await page.click('.ex[data-ex="flam"] .ex-head');
  await snap('07-library');
  await go('settings'); await snap('08-settings');

  // rating after the fact: two routine steps that were never rated
  await page.evaluate(() => {
    window.RT.addEntry('single8', { date: '2026-10-19T07:30:00.000Z', kind: 'work', work: 120, clean: null, hard: null, broke: [], notes: '', src: 'routine' });
    window.RT.addEntry('flamL', { date: '2026-10-17T08:00:00.000Z', kind: 'work', work: 80, clean: null, hard: null, broke: [], notes: '', src: 'routine' });
  });
  await go('home'); await snap('12-home-rate-reminder', false);
  await page.click('#rateOpen'); await snap('13-rate-window', false);
  await page.locator('#modalBtns button', { hasText: 'סיום' }).click();
  await go('progress');
  await page.locator('#pgHist [data-rate-entry]').first().scrollIntoViewIfNeeded();
  await page.locator('#pgHist [data-rate-entry]').first().click();
  await snap('14-progress-rate-picker', false);
  await ctx.close();
  if (errors.length) throw new Error(`${view.name}/${theme}: ${errors.join('; ')}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const view of VIEWS) for (const theme of THEMES) { await shoot(browser, view, theme); console.log('✓', view.name, theme); }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
