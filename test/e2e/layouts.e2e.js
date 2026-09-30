// Every built-in screen at every tablet shape: widgets mount, fill the screen without
// overlapping, and phones stack them in reading order.
import { test, expect } from '@playwright/test';
import { openDashboard, expectNoFailedWidgets, panelBoxes, visiblePanels, VIEWPORTS } from './helpers.js';

const SCREENS = { hub: 5, family: 7, frame: 4, info: 7 };
const overlap = (a, b) => Math.min(a.r, b.r) - Math.max(a.x, b.x) > 1 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 1;

for (const cloud of [false, true]) {
  for (const viewport of ['landscape', 'narrow', 'short', 'portrait']) {
    for (const screen of Object.keys(SCREENS)) {
      test(`${screen} · ${viewport} · ${cloud ? 'cloud' : 'local'}: widgets tile the screen`, async ({ page }) => {
        const { errors } = await openDashboard(page, { screen, cloud, viewport });
        expect(errors).toEqual([]);
        await expectNoFailedWidgets(page);
        const boxes = await panelBoxes(page);
        const slots = Object.keys(boxes);
        expect(slots.length).toBeGreaterThanOrEqual(3);
        expect(slots.length).toBeLessThanOrEqual(SCREENS[screen]);
        const { width, height } = VIEWPORTS[viewport];
        for (const [slot, b] of Object.entries(boxes)) {
          expect(b.w, `${slot} width`).toBeGreaterThan(60);
          expect(b.h, `${slot} height`).toBeGreaterThan(30);
          expect(b.x, `${slot} left`).toBeGreaterThanOrEqual(-1);
          expect(b.r, `${slot} right`).toBeLessThanOrEqual(width + 1);
          expect(b.b, `${slot} bottom`).toBeLessThanOrEqual(height + 1);
        }
        for (let i = 0; i < slots.length; i++) {
          for (let j = i + 1; j < slots.length; j++) expect(overlap(boxes[slots[i]], boxes[slots[j]]), `${slots[i]} overlaps ${slots[j]}`).toBe(false);
        }
      });
    }
  }
}

test('Home landscape: transit on the left, clock in the middle, calendar top right', async ({ page }) => {
  await openDashboard(page, { screen: 'hub' });
  const b = await panelBoxes(page);
  expect(b.transport.x).toBeLessThan(b.hero.x);
  expect(b.hero.x).toBeLessThan(b.calendar.x);
  expect(b.calendar.y).toBeLessThan(b.home.y);
  expect(Math.abs(b.transport.h - (b.hero.h + b.spotify.h))).toBeLessThan(40); // full height
});

test('Home portrait: clock and weather across the top', async ({ page }) => {
  await openDashboard(page, { screen: 'hub', viewport: 'portrait' });
  const b = await panelBoxes(page);
  for (const slot of ['transport', 'calendar', 'home', 'spotify']) expect(b.hero.b).toBeLessThanOrEqual(b[slot].y + 1);
  expect(b.hero.w).toBeGreaterThan(700);
});

test('Info short landscape: fewer, roomier widgets (no clocks, no quote)', async ({ page }) => {
  await openDashboard(page, { screen: 'info', viewport: 'short' });
  expect(Object.keys(await panelBoxes(page)).sort()).toEqual(['commute', 'markets', 'news', 'planes', 'weather']);
});

for (const screen of Object.keys(SCREENS)) {
  test(`${screen} · phone: one scrolling column in reading order`, async ({ page }) => {
    const { errors } = await openDashboard(page, { screen, viewport: 'phone' });
    expect(errors).toEqual([]);
    await expectNoFailedWidgets(page);
    const boxes = Object.values(await panelBoxes(page)).sort((a, b) => a.y - b.y);
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.r).toBeLessThanOrEqual(391);
    }
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].b - 1);
  });
}

test('screens switch with the tabs and keep their widgets', async ({ page }) => {
  await openDashboard(page, { screen: 'hub' });
  await page.getByRole('tab', { name: 'Family' }).click();
  await page.clock.runFor(1000);
  await expect(page.locator('.screen.is-active')).toHaveAttribute('data-screen', 'family');
  await expect(visiblePanels(page)).toHaveCount(7);
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.clock.runFor(1000);
  await expect(page.locator('.screen.is-active')).toHaveAttribute('data-screen', 'hub');
  expect(page.url()).toContain('#hub');
});
