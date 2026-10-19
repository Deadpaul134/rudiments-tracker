const { test, expect } = require('@playwright/test');
const { K, seed, open, rt } = require('./helpers');

const M = (page) => rt(page, () => window.__rt.M());

test.describe('weekly measurement', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-19T10:00:00') });
    await seed(page, { [K]: { __v: 2, custom: {}, entries: {
      flamL: [{ date: '2026-10-17T11:00:00.000Z', clean: 120, hard: 135, broke: [], notes: '' }] } } });
  });

  test('auto-rise, hard + break marks → clean max entry', async ({ page }) => {
    await open(page, 'measure');
    await page.selectOption('#mSub', 'flamL');
    await expect(page.locator('#mStart')).toHaveValue('100');   // last clean max − 20
    await expect(page.locator('#mStep')).toHaveValue('5');
    await expect(page.locator('#mEvery')).toHaveValue('30');
    await expect(page.locator('#mLast')).toContainText('120');

    await page.click('#mGo');
    expect((await M(page)).phase).toBe('countin');
    await page.clock.fastForward(2700);
    expect((await M(page)).phase).toBe('run');
    expect(await rt(page, () => window.__rt.metro().bpm)).toBe(100);

    await page.clock.fastForward(30000);
    expect((await M(page)).bpm).toBe(105);
    await page.clock.fastForward(30000);
    expect((await M(page)).bpm).toBe(110);
    expect(await rt(page, () => window.__rt.metro().bpm)).toBe(110);

    await page.click('#mMark');                      // hard at 110
    await expect(page.locator('#mMark')).toHaveText('נשבר');
    await page.clock.fastForward(30000);
    await page.click('#mMark');                      // break at 115
    expect((await M(page)).phase).toBe('result');
    expect(await rt(page, () => window.__rt.metro().running)).toBe(false);
    await expect(page.locator('#mResClean')).toHaveValue('105');
    await expect(page.locator('#mResHard')).toHaveValue('110');
    await expect(page.locator('#mResBreak')).toHaveValue('115');

    await page.click('#mSave');
    const st = await rt(page, () => window.__rt.state());
    expect(st.entries.flamL).toHaveLength(2);
    expect(st.entries.flamL[1]).toMatchObject({ clean: 105, hard: 110, breakBpm: 115, src: 'measure' });
    expect(st.entries.flamL[1].kind).toBeUndefined();
  });

  test('configurable step/interval and keyboard (Space start/mark)', async ({ page }) => {
    await open(page, 'measure');
    await page.selectOption('#mSub', 'flamL');
    await page.fill('#mStart', '90');
    await page.fill('#mStep', '10');
    await page.fill('#mEvery', '10');
    await page.locator('#mStage').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Space');
    await page.clock.fastForward(3000);
    await page.clock.fastForward(10000);
    await page.clock.fastForward(10000);
    expect((await M(page)).bpm).toBe(110);
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');
    const m = await M(page);
    expect(m.phase).toBe('result');
    expect([m.hard, m.brk]).toEqual([110, 110]);
    await expect(page.locator('#mResClean')).toHaveValue('100');
  });

  test('runs the whole weekly list in sequence', async ({ page }) => {
    await open(page, 'measure');
    const list = await rt(page, () => window.__rt.plan().weekly);
    expect(list.length).toBeGreaterThan(3);
    await page.click('#mRunAll');
    let m = await M(page);
    expect(m.queue).toEqual(list);
    expect(m.sub).toBe(list[0]);
    await expect(page.locator('#mQueueLine')).toContainText('1/' + list.length);

    // measure the first one
    await page.click('#mGo');
    await page.clock.fastForward(3000);
    await page.clock.fastForward(30000);
    await page.click('#mMark');
    await page.click('#mMark');
    await page.click('#mSave');
    m = await M(page);
    expect(m.qi).toBe(1);
    expect(m.sub).toBe(list[1]);
    expect(m.phase).toBe('setup');
    // skip the second
    await page.click('#mSkip');
    expect((await M(page)).sub).toBe(list[2]);
    const st = await rt(page, (id) => window.__rt.state().entries[id], list[0]);
    expect(st[st.length - 1].src).toBe('measure');
  });
});
