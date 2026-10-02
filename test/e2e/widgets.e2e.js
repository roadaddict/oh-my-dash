// Every widget of the dashboard, on one screen, in both modes: nothing fails to mount.
import { test, expect } from '@playwright/test';
import { openDashboard, expectNoFailedWidgets, fakeApi } from './helpers.js';

for (const cloud of [false, true]) {
  test(`all widgets mount (${cloud ? 'cloud' : 'local'} mode)`, async ({ page }) => {
    const { errors } = await openDashboard(page, { screen: 'all', query: 'SCREENS=all', cloud, viewport: { width: 1920, height: 1080 } });
    expect(errors).toEqual([]);
    await expectNoFailedWidgets(page);
    await expect(page.locator('.screen.is-active > .grid > .panel:not(.is-off)')).toHaveCount(24);
  });
}

test('backend integrations: Todoist tab, Finnhub stocks, TomTom traffic — keys stay on the Worker', async ({ page }) => {
  const api = fakeApi({ services: { todoist: { configured: true }, finnhub: { configured: true }, tomtom: { configured: true } } });
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  const commute = encodeURIComponent('Work | 51.5155,-0.0922 | car');
  await openDashboard(page, { screen: 'all', query: `SCREENS=all&STOCKS=AAPL&COMMUTES=${commute}`, cloud: true, api, viewport: { width: 1920, height: 1080 } });
  await expectNoFailedWidgets(page);
  const lists = page.locator('.screen.is-active .b-lists');
  await lists.getByRole('tab', { name: /Todoist/ }).click();
  await expect(lists.locator('.item').first()).toHaveText('Call the bank');
  await expect(page.locator('.screen.is-active .b-markets .mk-name', { hasText: 'AAPL' })).toBeVisible();
  await expect(page.locator('.screen.is-active .b-commute .commute')).toHaveAttribute('title', /TomTom traffic/);
  await expect(page.locator('.screen.is-active .b-commute .commute-sub')).toContainText('+6 min traffic');
  // The browser only ever talked to the dashboard's own API about these.
  expect(requests.filter((u) => /todoist\.com|finnhub\.io|tomtom\.com/.test(u))).toEqual([]);
});

test('without a backend, integration widgets explain what they need', async ({ page }) => {
  await openDashboard(page, { screen: 'all', query: 'SCREENS=all&STOCKS=AAPL', viewport: { width: 1920, height: 1080 } });
  await expect(page.locator('.screen.is-active .b-spotify')).toContainText('Available when the dashboard runs on its Cloudflare Worker');
  await expect(page.locator('.screen.is-active .b-strava')).toContainText('Cloudflare Worker');
  await expect(page.locator('.screen.is-active .b-markets .panel-meta')).toContainText('FINNHUB_TOKEN');
  await expect(page.locator('.screen.is-active .b-lists [role="tab"]', { hasText: 'Todoist' })).toHaveCount(0);
});

test('cloud mode: feeds due at the same moment share one request to the Worker', async ({ page }) => {
  const api = fakeApi();
  const single = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/proxy') single.push(r.url());
  });
  await openDashboard(page, { screen: 'all', cloud: true, api });
  await expectNoFailedWidgets(page);
  const batched = api.batches.flat();
  expect(api.batches.length).toBeGreaterThan(0);
  expect(batched.length).toBeGreaterThan(api.batches.length); // more feeds than requests
  expect(single.length).toBeLessThan(batched.length);
});

// A stray `null` passed to the browser's own append()/replaceChildren() shows up as the word "null".
test('no "null" or "undefined" shows anywhere: every widget, one list, a quote without an author, the settings', async ({ page }) => {
  const { errors } = await openDashboard(page, {
    screen: 'all',
    query: 'SCREENS=all&LISTS=Groceries&QUOTES=Just%20a%20thought',
    viewport: { width: 1920, height: 1080 },
  });
  await expectNoFailedWidgets(page);
  await page.locator('#btnSettings').click();
  await page.clock.runFor(400);
  await page.$$eval('#settings details', (all) => all.forEach((d) => (d.open = true)));
  const strays = await page.evaluate(() => {
    const found = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      if (/\b(null|undefined)\b/.test(walk.currentNode.textContent) && !walk.currentNode.parentElement.closest('script, style, code, textarea')) {
        found.push(
          `${walk.currentNode.parentElement.className || walk.currentNode.parentElement.tagName}: ${walk.currentNode.textContent.trim().slice(0, 60)}`,
        );
      }
    }
    return found;
  });
  expect(strays).toEqual([]);
  expect(errors).toEqual([]);
});
