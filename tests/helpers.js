const path = require('path');
const { pathToFileURL } = require('url');

const APP_URL = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const DATA_FILE = path.resolve(__dirname, '..', 'reference', 'rudiments-data-2026-10-17.json');
const K = 'rimon-rudiments-v1';

/** Seed localStorage once per tab (survives reloads) before the app scripts run. */
async function seed(page, items) {
  await page.addInitScript((items) => {
    if (sessionStorage.getItem('__seeded')) return;
    localStorage.clear();
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    sessionStorage.setItem('__seeded', '1');
  }, items);
}

async function open(page, hash = 'home') {
  await page.goto(APP_URL + '#' + hash);
  await page.waitForFunction(() => !!window.__rt);
}

const rt = (page, expr, arg) => page.evaluate(expr, arg);

module.exports = { APP_URL, DATA_FILE, K, seed, open, rt };
