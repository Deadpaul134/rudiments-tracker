const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

const theme = (page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe('theme', () => {
  test('defaults to the system preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page);
    expect(await theme(page)).toBe('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => theme(page)).toBe('light');
  });

  test('toggle switches light/dark and is remembered', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page);
    expect(await theme(page)).toBe('light');
    const light = await bg(page);
    await page.click('#themeBtn');
    expect(await theme(page)).toBe('dark');
    expect(await bg(page)).not.toBe(light);
    await page.reload();
    await page.waitForFunction(() => !!window.__rt);
    expect(await theme(page)).toBe('dark');               // remembered across reloads
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await theme(page)).toBe('dark');               // explicit choice beats the system

    // settings: back to "follow system"
    await page.goto(page.url().replace(/#.*$/, '#settings'));
    await expect(page.locator('#themeSeg [data-theme-v="dark"]')).toHaveClass(/on/);
    await page.click('#themeSeg [data-theme-v="system"]');
    expect(await theme(page)).toBe('light');
    expect(await page.evaluate(() => localStorage.getItem('rimon-rudiments-v1-theme'))).toBe('"system"');
  });

  test('UI is Hebrew RTL with the sidebar on the right', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir])).toEqual(['he', 'rtl']);
    const side = await page.locator('.side').boundingBox();
    const main = await page.locator('#main').boundingBox();
    expect(side.x).toBeGreaterThan(main.x);
    for (const r of ['בית', 'תרגול', 'התקדמות', 'ספרייה', 'הגדרות']) await expect(page.locator('.nav-i', { hasText: r })).toBeVisible();
  });
});
