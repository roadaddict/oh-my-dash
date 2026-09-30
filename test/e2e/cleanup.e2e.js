// Removing or changing a widget in the layout editor stops everything it started:
// ticks, timers, listeners, feed polling — and runs its own clean-up.
import { test, expect } from '@playwright/test';
import { openDashboard } from './helpers.js';

const counter = (page) => page.evaluate(() => ({ ...window.__omdCounter }));

async function removeInEditor(page, slot) {
  await page.locator('#btnEdit').click();
  await page.locator(`.edit-tile[data-slot="${slot}"] [data-act="remove"]`).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.clock.runFor(500);
}

test('a removed widget leaves nothing running', async ({ page }) => {
  await openDashboard(page, { screen: 'lab', query: 'SCREENS=lab' });
  const a = await counter(page);
  await page.clock.runFor(3000);
  const b = await counter(page);
  expect(b.ticks).toBeGreaterThan(a.ticks);
  expect(b.intervals).toBeGreaterThan(a.intervals);
  expect(b.feed).toBeGreaterThan(a.feed);

  await removeInEditor(page, 'counter');
  // Only an empty placeholder is left in its slot (it comes back when the layout shows it again).
  await expect(page.locator('.screen.is-active [data-block="counter"]')).toHaveClass(/is-parked/);
  await expect(page.locator('.screen.is-active .b-counter')).toHaveCount(0);
  const c = await counter(page);
  expect(c.cleanups).toBe(1);
  await page.setViewportSize({ width: 1300, height: 820 });
  await page.clock.runFor(5000);
  const d = await counter(page);
  expect(d).toEqual(c); // no tick, interval, feed poll or resize listener fired
});

test('changing a widget unmounts the old one', async ({ page }) => {
  await openDashboard(page, { screen: 'lab', query: 'SCREENS=lab' });
  await page.locator('#btnEdit').click();
  await page.locator('.edit-tile[data-slot="counter"] [data-act="change"]').click();
  await page.locator('.edit-pick', { hasText: 'Quote' }).first().click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.clock.runFor(500);
  await expect(page.locator('.screen.is-active [data-block="counter"]')).toHaveClass(/b-quote/);
  const c = await counter(page);
  expect(c.cleanups).toBe(1);
  await page.clock.runFor(3000);
  expect(await counter(page)).toEqual(c);
});

test('a failed widget is cleaned up too', async ({ page }) => {
  await openDashboard(page, { screen: 'lab', query: 'SCREENS=lab' });
  await page.evaluate(() => {
    // Make the counter fail from inside: its next tick throws.
    const c = window.__omdCounter;
    Object.defineProperty(c, 'ticks', {
      get: () => 0,
      set: () => {
        throw new Error('tick exploded');
      },
      configurable: true,
    });
  });
  await page.clock.runFor(1500);
  await expect(page.locator('.screen.is-active [data-block="counter"]')).toHaveClass(/is-failed/);
  const c = await page.evaluate(() => ({ intervals: window.__omdCounter.intervals, feed: window.__omdCounter.feed, cleanups: window.__omdCounter.cleanups }));
  expect(c.cleanups).toBe(1);
  await page.clock.runFor(3000);
  expect(
    await page.evaluate(() => ({ intervals: window.__omdCounter.intervals, feed: window.__omdCounter.feed, cleanups: window.__omdCounter.cleanups })),
  ).toEqual(c);
});

test('widgets a layout leaves out in this orientation are parked, and come back when it shows them', async ({ page }) => {
  // Info on a short landscape screen has no world clocks and no quote.
  await openDashboard(page, { screen: 'info', viewport: 'short' });
  await expect(page.locator('.screen.is-active [data-block="clocks"]')).toHaveClass(/is-parked/);
  await expect(page.locator('.screen.is-active .b-worldclock')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.runFor(1000);
  await expect(page.locator('.screen.is-active .b-worldclock .wc')).toHaveCount(3);
  await expect(page.locator('.screen.is-active [data-block="clocks"]')).not.toHaveClass(/is-parked/);
});
