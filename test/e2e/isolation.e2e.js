// A widget that breaks — while mounting, later in a timer or a tap, in a listener added
// without ctx, in a runaway loop, or in a script that doesn't even parse — is replaced by
// an error card. Everything else on the page keeps running. (Fixtures: test/fixtures/widgets.)
import { test, expect } from '@playwright/test';
import { openDashboard, settle } from './helpers.js';

const card = (page, slot) => page.locator(`.screen.is-active [data-block="${slot}"]`);
const lab = (page, opts = {}) => openDashboard(page, { screen: 'lab', query: 'SCREENS=lab', ...opts });

test('a widget that throws while mounting shows an error card; Retry mounts it again', async ({ page }) => {
  const { errors } = await lab(page);
  expect(errors).toEqual([]);
  await expect(card(page, 'mount')).toHaveClass(/is-failed/);
  await expect(card(page, 'mount')).toContainText('This widget failed');
  await expect(card(page, 'mount')).toContainText('boom while mounting');
  // The rest of the screen is fine.
  await expect(card(page, 'clock')).not.toHaveClass(/is-failed/);
  await expect(card(page, 'later').locator('.alive')).toBeVisible();

  await page.evaluate(() => {
    window.__omdHealBoom = true;
  });
  await card(page, 'mount').getByRole('button', { name: 'Retry' }).click();
  await expect(card(page, 'mount')).not.toHaveClass(/is-failed/);
});

for (const [mode, message] of [
  ['timer', 'boom in a timer'],
  ['promise', 'boom in a stray promise'],
]) {
  test(`an error later on (${mode}) takes down only that widget`, async ({ page }) => {
    await lab(page, { beforeLoad: `window.__omdBoomMode = ${JSON.stringify(mode)};` });
    await page.clock.runFor(1000);
    await expect(card(page, 'later')).toHaveClass(/is-failed/);
    await expect(card(page, 'later')).toContainText(message);
    // Same place in the layout, and the clock still ticks.
    const before = await card(page, 'clock').locator('.clock-hm').textContent();
    await page.clock.runFor(60000);
    await expect(card(page, 'clock').locator('.clock-hm')).not.toHaveText(before);
    await expect(card(page, 'counter')).not.toHaveClass(/is-failed/);
  });
}

test('an exception in a tap handler fails the widget, not the page', async ({ page }) => {
  await lab(page);
  await card(page, 'later').locator('.boom-click').click();
  await expect(card(page, 'later')).toHaveClass(/is-failed/);
  await expect(card(page, 'later')).toContainText('boom in a click handler');
});

test('even a listener added without ctx is traced back to its widget (by line number)', async ({ page }) => {
  await lab(page);
  await card(page, 'later').locator('.boom-raw').click();
  await expect(card(page, 'later')).toHaveClass(/is-failed/);
  await expect(card(page, 'later')).toContainText('boom in a raw listener');
  await expect(card(page, 'mount')).toHaveClass(/is-failed/); // unrelated: it failed on its own
  await expect(card(page, 'counter')).not.toHaveClass(/is-failed/);
});

test("a widget whose script doesn't parse can't load — the rest of the page works", async ({ page }) => {
  const syntaxErrors = [];
  page.on('pageerror', (e) => {
    if (e.name === 'SyntaxError') syntaxErrors.push(e.message);
  });
  await lab(page);
  expect(syntaxErrors.length).toBe(1);
  await expect(card(page, 'syntax')).toHaveClass(/is-failed/);
  await expect(card(page, 'syntax')).toContainText('This widget can’t load');
  await expect(card(page, 'syntax')).toContainText('could not be read by this browser');
  await expect(card(page, 'counter').locator('.counter')).toBeVisible();
});

test('a runaway loop is stopped by the watchdog and the page stays responsive', async ({ page }) => {
  // Real timers: the watchdog measures real time spent in the widget's callbacks.
  await lab(page, { clock: 'real', beforeLoad: 'window.__omdBusy = true;' });
  await expect(card(page, 'busy')).toHaveClass(/is-failed/, { timeout: 15000 });
  await expect(card(page, 'busy')).toContainText(/kept the page busy/);
  // Afterwards the main thread is free again: the shortest setTimeout(0) delay over a few
  // tries (≈ 400 ms while the loop ran) — measured in the page, so machine load doesn't matter.
  const lag = await page.evaluate(async () => {
    const one = () =>
      new Promise((r) => {
        const t = performance.now();
        setTimeout(() => r(performance.now() - t), 0);
      });
    let min = Infinity;
    for (let i = 0; i < 8; i++) min = Math.min(min, await one());
    return min;
  });
  expect(lag).toBeLessThan(100);
  await expect(card(page, 'clock')).not.toHaveClass(/is-failed/);
});

test('an unknown widget type in a layout shows a card instead of breaking the screen', async ({ page }) => {
  const layouts = { devices: { dev1: { name: 'Test', at: Date.now(), screens: { lab: { landscape: { widgets: { clock: { type: 'does-not-exist' } } } } } } } };
  const { errors } = await lab(page, {
    beforeLoad: `localStorage.setItem('omd.device.v1', JSON.stringify({ id: 'dev1', name: 'Test' })); localStorage.setItem('omd.layouts.v1', ${JSON.stringify(JSON.stringify(layouts))});`,
  });
  expect(errors).toEqual([]);
  // A saved spec naming a missing widget falls back to the screen's default for that slot.
  await expect(card(page, 'clock')).not.toHaveClass(/is-failed/);
  await settle(page);
});
