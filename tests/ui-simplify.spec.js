const { test, expect } = require('@playwright/test');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { K, seed, open } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9876;

function waitForServer() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    const once = () => {
      const req = http.get('http://127.0.0.1:' + PORT + '/index.html', (res) => { res.resume(); resolve(); });
      req.on('error', () => { if (Date.now() > deadline) reject(new Error('static server did not start')); else setTimeout(once, 80); });
    };
    once();
  });
}

test.describe('simplified home and settings', () => {
  let server;
  test.beforeAll(async () => {
    server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
    await waitForServer();
  });
  test.afterAll(() => { if (server) server.kill(); });

  test('home is the practice card plus a thin stats row', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-19T10:00:00') });
    await open(page, 'home');
    await expect(page.locator('#startToday')).toBeVisible();
    await expect(page.locator('#homeStage [data-p="name"]')).toBeVisible();
    await expect(page.locator('#homeBpm')).toBeVisible();
    await expect(page.locator('#stStreak')).toBeVisible();
    await expect(page.locator('#stWeek')).toHaveText('0/7');
    await expect(page.locator('#stGoal')).toBeVisible();
    await expect(page.locator('#stLeft')).toHaveText('11');
    for (const name of ['נקי', 'סביר', 'נשבר', 'לא עכשיו']) {
      await expect(page.locator('#homeRates').getByRole('button', { name })).toBeVisible();
    }
    await expect(page.locator('#todayPlan')).toHaveCount(0);
    await expect(page.locator('#screen-home #week')).toHaveCount(0);
    await expect(page.locator('#screen-progress #week')).toHaveCount(1);
  });

  test('home opens on the first step that is not done today', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-19T10:00:00') });
    await seed(page, { [K + '-plan']: { days: {}, steps: { '2026-10-19': [0, 1] } } });
    await open(page, 'home');
    await expect(page.locator('#homeStage [data-p="name"]')).toHaveText('דאבל סטרוק');
    await expect(page.locator('#homeBpm')).toHaveText('100');
    await expect(page.locator('#homeRingN')).toHaveText('2/5');
  });

  test('days-to-goal disappears after 30.10', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-02T10:00:00') });
    await open(page, 'home');
    await expect(page.locator('#stGoal')).toBeHidden();
    await expect(page.locator('#stStreak')).toBeVisible();
    await expect(page.locator('#stWeek')).toBeVisible();
  });

  test('long explanations stay behind an info icon until tapped', async ({ page }) => {
    await open(page, 'practice');
    await expect(page.locator('#helpSteps')).toBeHidden();
    await page.locator('[aria-controls="helpSteps"]').click();
    await expect(page.locator('#helpSteps')).toBeVisible();
    await expect(page.locator('#helpSteps')).toContainText('הקצבים נקבעים רק על ידך');
    await page.locator('[aria-controls="helpSteps"]').click();
    await expect(page.locator('#helpSteps')).toBeHidden();

    await page.goto(page.url().replace(/#.*$/, '#measure'));
    await expect(page.locator('#helpTempo')).toBeHidden();
    await page.locator('[aria-controls="helpTempo"]').click();
    await expect(page.locator('#helpTempo')).toContainText('המקסימום הנקי האחרון');
  });

  test('settings group account and sound, and the week strip lives on progress', async ({ page }) => {
    await open(page, 'settings');
    await expect(page.locator('#syncCard h2')).toContainText('חשבון וגיבוי');
    await expect(page.locator('#metroCard h2')).toContainText('צליל ותזמון');
    await expect(page.locator('#syncNow')).toBeVisible();
    await expect(page.locator('#exportBtn')).toBeVisible();
    await expect(page.locator('#importBtn')).toBeVisible();
    await expect(page.locator('#setLoud')).toBeVisible();
    await expect(page.locator('#setSubClicks')).toBeVisible();
    await expect(page.locator('#setRest')).toBeVisible();
    await expect(page.locator('#setMEvery')).toBeVisible();
    await expect(page.locator('#routineEditor')).toBeVisible();
    await expect(page.locator('#weeklyEditor')).toBeVisible();
    await expect(page.locator('#syncServerFld')).toBeVisible();
    await expect(page.locator('#helpSync')).toBeHidden();
    await expect(page.locator('#helpImport')).toBeHidden();
    await page.locator('[aria-controls="helpSync"]').click();
    await expect(page.locator('#helpSync')).toContainText('המקסימום הנקי אף פעם לא יורד');
    await page.locator('[aria-controls="helpImport"]').click();
    await expect(page.locator('#helpImport')).toContainText('מקבל קבצי ייצוא');

    await page.goto(page.url().replace(/#.*$/, '#progress'));
    await expect(page.locator('#week')).toBeVisible();
    await expect(page.locator('#wkPrev')).toBeVisible();
  });

  test('the server address field is hidden when the app is not a local file', async ({ page }) => {
    await page.goto('http://127.0.0.1:' + PORT + '/index.html#settings');
    await page.waitForFunction(() => !!window.__rt);
    await expect(page.locator('#syncServerFld')).toBeHidden();
    await expect(page.locator('#syncCode')).toBeVisible();
    await expect(page.locator('#syncCard h2')).toContainText('חשבון וגיבוי');
  });

  test('space on the home screen starts the routine', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-19T10:00:00') });
    await open(page, 'home');
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => window.__rt.P().phase)).toBe('countin');
    await expect(page.locator('#startToday .lbl')).toHaveText('השהה');
  });
});
