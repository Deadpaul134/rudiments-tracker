// Screenshot of the metronome settings card on a phone viewport → screenshots/metro-settings.png
// Usage: node scripts/metro-settings-screenshot.js
const { chromium, devices } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const K = 'rimon-rudiments-v1';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.addInitScript((K) => {
    if (sessionStorage.getItem('__seeded')) return;
    localStorage.clear();
    localStorage.setItem(K, JSON.stringify({ __v: 2, entries: {}, custom: {} }));
    localStorage.setItem(K + '-theme', JSON.stringify('light'));
    sessionStorage.setItem('__seeded', '1');
  }, K);
  await page.goto(URL + '#settings');
  await page.waitForFunction(() => !!window.__rt);
  await page.addStyleTag({ content: '#toast{display:none!important}' });
  await page.locator('#metroCard').scrollIntoViewIfNeeded();
  await page.locator('#metroCard').screenshot({ path: path.join(ROOT, 'screenshots', 'metro-settings.png') });
  await browser.close();
  console.log('saved screenshots/metro-settings.png');
})();
