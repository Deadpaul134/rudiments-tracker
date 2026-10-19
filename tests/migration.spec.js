const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { DATA_FILE, K, seed, open, rt } = require('./helpers');

test.describe('v1 migration and import', () => {
  test('migrates existing v1 localStorage on first load and keeps a backup', async ({ page }) => {
    await seed(page, {
      [K]: { __v: 2, entries: { flamL: [{ date: '2026-10-16T13:31:32.534Z', clean: 120, hard: 135, broke: [], notes: '' }] },
        custom: { para: [{ id: 'c_x1', name: 'פרדידל שלי', stick: 'RLRR' }] } },
      [K + '-plan']: { days: { '2026-10-16': 1 }, steps: {}, kit: {}, sessions: {}, routine: { 2: { bpm: 110 }, 3: { link: 'dr_tap' } } },
      [K + '-ui']: { cat: 'rud', open: {}, tab: {} },
    });
    await open(page);
    await expect(page.locator('#toast')).toContainText('הנתונים מגרסה 1 הועברו');

    const st = await rt(page, () => window.__rt.state());
    expect(st.entries.flamL[0].clean).toBe(120);
    expect(st.custom.para[0].name).toBe('פרדידל שלי');

    const plan = await rt(page, () => window.__rt.plan());
    expect(plan.routine2).toHaveLength(5);
    expect(plan.routine2[2].bpm).toBe(110);          // v1 per-step override kept
    expect(plan.routine2[3].link).toBe('dr_tap');
    expect(plan.routine2[0].bpm).toBe(120);          // defaults for the rest
    expect(plan.days['2026-10-16']).toBe(1);

    const ls = await rt(page, () => ({ backup: localStorage.getItem('rimon-rudiments-v1-v1backup'), meta: JSON.parse(localStorage.getItem('rimon-rudiments-v1-v2meta')) }));
    expect(ls.meta.migrated).toBe(true);
    expect(ls.meta.fromV1).toBe(true);
    const backup = JSON.parse(ls.backup);
    expect(JSON.parse(backup['rimon-rudiments-v1']).entries.flamL[0].clean).toBe(120);

    // goal card reads the migrated data
    await page.goto(page.url().replace(/#.*$/, '#progress'));
    await expect(page.locator('.goal[data-goal="flamL"] .goal-foot')).toContainText('120');

    // second load: no migration toast again
    await page.reload();
    await page.waitForFunction(() => !!window.__rt);
    await page.waitForTimeout(300);
    await expect(page.locator('#toast')).not.toContainText('הועברו');
  });

  test('upgrades the oldest flat v1 format (subId → entries)', async ({ page }) => {
    await seed(page, { [K]: { drag: [{ date: '2026-10-10T10:00:00.000Z', clean: 85, hard: 95, broke: [], notes: '' }] } });
    await open(page);
    const st = await rt(page, () => window.__rt.state());
    expect(st.__v).toBe(2);
    expect(st.entries.drag[0].clean).toBe(85);
    const pre = await rt(page, () => localStorage.getItem('rimon-rudiments-v1-premigration'));
    expect(JSON.parse(pre).drag[0].clean).toBe(85);
  });

  test('imports Paul\'s v1 export file (replace) – data, plan and routine override', async ({ page }) => {
    await open(page, 'settings');
    await page.setInputFiles('#importFile', DATA_FILE);
    await expect(page.locator('#modal')).toBeVisible();
    await expect(page.locator('#modalBody')).toContainText('13');
    await page.getByRole('button', { name: 'החלפה' }).click();
    await expect(page.locator('#toast')).toContainText('הוחלפו');

    const st = await rt(page, () => window.__rt.state());
    const n = Object.values(st.entries).reduce((a, x) => a + x.length, 0);
    expect(n).toBe(13);
    expect(st.entries.double8[0].clean).toBe(165);
    expect(st.entries.drag[0].clean).toBe(90);
    expect(st.entries.singleL[1].clean).toBe(120);
    const plan = await rt(page, () => window.__rt.plan());
    expect(plan.days['2026-10-16']).toBe(1);
    expect(plan.routine2[2].bpm).toBe(110);

    // goals reflect the corrected data; quarter-note hands are not compared
    await page.goto(page.url().replace(/#.*$/, '#progress'));
    await expect(page.locator('.goal[data-goal="flamL"] .goal-foot')).toContainText('120');
    await expect(page.locator('.goal[data-goal="drag"] .goal-foot')).toContainText('90');
    await expect(page.locator('.goal[data-goal="double8"] .goal-foot')).toContainText('165');
    await expect(page.locator('#handBody')).toContainText('לא בר-השוואה');
    // the corrected data must not trigger the old 17.10 data-fix banner
    await page.goto(page.url().replace(/#.*$/, '#home'));
    await expect(page.locator('#fixBar')).toBeHidden();
  });

  test('merge import does not duplicate entries', async ({ page }) => {
    const text = fs.readFileSync(DATA_FILE, 'utf8');
    await seed(page, { [K]: JSON.parse(text).data });
    await open(page, 'settings');
    await page.setInputFiles('#importFile', DATA_FILE);
    await page.getByRole('button', { name: 'מיזוג' }).click();
    await expect(page.locator('#toast')).toContainText('מוזגו');
    const st = await rt(page, () => window.__rt.state());
    expect(Object.values(st.entries).reduce((a, x) => a + x.length, 0)).toBe(13);
  });

  test('rejects an invalid file', async ({ page }) => {
    await open(page, 'settings');
    await page.setInputFiles('#importFile', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
    await expect(page.locator('#toast')).toContainText('אינו קובץ נתונים תקין');
  });

  test('offers the 17.10 data fix for the uncorrected v1 data', async ({ page }) => {
    await seed(page, { [K]: { __v: 2, custom: {}, entries: {
      single8: [{ date: '2026-10-16T13:12:57.743Z', clean: 225, hard: 235, broke: [], notes: '' }],
      double8: [{ date: '2026-10-16T13:18:40.028Z', clean: 110, hard: 120, broke: [], notes: '' }],
      drag: [{ date: '2026-10-16T13:34:42.760Z', clean: 70, hard: 80, broke: [], notes: '' }] } } });
    await open(page);
    await expect(page.locator('#fixBar')).toBeVisible();
    await page.click('#fixApply');
    const st = await rt(page, () => window.__rt.state());
    expect(st.entries.double8.map(x => x.clean)).toEqual([165]);
    expect(st.entries.d_acc2[0].clean).toBe(110);
    expect(st.entries.drag.find(x => x.kind === 'work').work).toBe(70);
    expect(st.entries.drag.find(x => x.clean).clean).toBe(90);
    await expect(page.locator('#fixBar')).toBeHidden();
  });
});
