// The news ticker: headlines from the shared news feed, scrolling at a speed that suits their length.
import { test, expect } from '@playwright/test';
import { openDashboard } from './helpers.js';

const ticker = (page) => page.locator('.screen.is-active .b-ticker');

test('headlines scroll by, newest first, with source and photo', async ({ page }) => {
  const { errors } = await openDashboard(page, { screen: 'frame' });
  expect(errors).toEqual([]);
  const items = ticker(page).locator('.ticker-item');
  await expect(items).toHaveCount(7);
  await expect(items.first()).toContainText('BBC');
  await expect(items.first()).toContainText('Scientists map the deepest canyon');
  await expect(items.nth(1)).toContainText('The Verge');
  await expect(ticker(page).locator('.ticker-img.is-loaded')).toHaveCount(5);
  const anim = await ticker(page)
    .locator('.ticker-track')
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return { name: cs.animationName, iterations: cs.animationIterationCount, dur: parseFloat(cs.getPropertyValue('--dur')) };
    });
  expect(anim).toMatchObject({ name: 'ticker-scroll', iterations: 'infinite' });
  expect(anim.dur).toBeGreaterThanOrEqual(30);
});

test('reduced motion: the ticker stands still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDashboard(page, { screen: 'frame' });
  await expect(ticker(page).locator('.ticker-item')).toHaveCount(7);
  expect(
    await ticker(page)
      .locator('.ticker-track')
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
});

test('News and the ticker share one feed: each RSS feed is fetched once', async ({ page }) => {
  const hits = [];
  page.on('request', (r) => {
    if (/feeds\.bbci|theverge/.test(r.url())) hits.push(r.url());
  });
  await openDashboard(page, { screen: 'all', query: 'SCREENS=all', viewport: { width: 1920, height: 1080 } });
  await expect(page.locator('.screen.is-active .b-ticker .ticker-item')).toHaveCount(7);
  await expect(page.locator('.screen.is-active .b-news .news-item').first()).toBeVisible();
  expect(hits.length).toBe(2);
});
