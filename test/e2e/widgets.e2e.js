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
