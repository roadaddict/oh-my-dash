// The ▦ layout editor: swap, pick from the generated widget catalog, reset.
import { test, expect } from '@playwright/test';
import { openDashboard, panelBoxes } from './helpers.js';

test('tap two widgets to swap them; Reset screen puts them back', async ({ page }) => {
  await openDashboard(page, { screen: 'hub' });
  const before = await panelBoxes(page);
  await page.locator('#btnEdit').click();
  // Pick two tiles (Enter = tap; a tile's middle holds its Change / Add / Remove buttons).
  await page.locator('.edit-tile[data-slot="calendar"]').press('Enter');
  await page.locator('.edit-tile[data-slot="home"]').press('Enter');
  await page.clock.runFor(500);
  const swapped = await panelBoxes(page);
  expect(swapped.calendar.x).toBeCloseTo(before.home.x, 0);
  expect(swapped.calendar.y).toBeCloseTo(before.home.y, 0);
  await page.getByRole('button', { name: 'Reset screen' }).click();
  await page.clock.runFor(500);
  expect((await panelBoxes(page)).calendar.y).toBeCloseTo(before.calendar.y, 0);
});

test('the picker lists every widget by group, generated from the definitions', async ({ page }) => {
  await openDashboard(page, { screen: 'hub' });
  await page.locator('#btnEdit').click();
  await page.locator('.edit-tile[data-slot="calendar"] [data-act="change"]').click();
  const groups = await page.locator('.edit-pick-group').allInnerTexts();
  // (The test build's fixture widgets add groups after these.)
  expect(groups.slice(0, 6).map((g) => g.toUpperCase())).toEqual([
    'TIME & WEATHER',
    'FAMILY',
    'PHOTOS, MUSIC & NEWS',
    'GETTING AROUND',
    'HOME & WEB',
    'FITNESS & MARKETS',
  ]);
  await expect(page.locator('.edit-pick', { hasText: 'Clock · with weather' })).toHaveCount(1);
  await expect(page.locator('.edit-pick', { hasText: 'Strava' })).toHaveCount(1);
  await page.locator('.edit-pick', { hasText: 'World clocks' }).click();
  await page.clock.runFor(500);
  await expect(page.locator('.screen.is-active [data-block="calendar"]')).toHaveClass(/b-worldclock/);
});

test('?dev=1: the example widget can be added', async ({ page }) => {
  const { errors } = await openDashboard(page, { screen: 'hub', query: 'dev=1' });
  await page.locator('#btnEdit').click();
  await page.locator('.edit-tile[data-slot="calendar"] [data-act="change"]').click();
  await page.locator('.edit-pick', { hasText: 'Hello (example)' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.clock.runFor(1500);
  const hello = page.locator('.screen.is-active .b-example');
  await expect(hello.locator('h3')).toHaveText('Hello, World!');
  await hello.getByRole('button', { name: 'Tap' }).click();
  await expect(hello.locator('.count')).toHaveText('1 taps, on every screen');
  expect(errors).toEqual([]);
});
