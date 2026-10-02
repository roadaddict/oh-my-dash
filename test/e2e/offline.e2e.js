/**
 * Internet down, device restarted: the dashboard still comes up (service worker), and
 * widgets show their last good data (saved feeds) with its age once it's overdue.
 */
import { test, expect } from '@playwright/test';
import { openDashboard, settle, NOW } from './helpers.js';

const weatherShowsData = (page) =>
  expect(page.locator('.screen.is-active .panel.b-clock .wx-temp, .screen.is-active .panel.b-weather .wx-temp').first()).toBeVisible();

test('after a reload, widgets show their saved data before the network answers', async ({ page }) => {
  await openDashboard(page, { screen: 'hub' });
  const saved = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('omd.feed.')));
  expect(saved.some((k) => k.startsWith('omd.feed.weather.'))).toBe(true);

  // The forecast service now never answers: the saved forecast is all there is.
  await page.route('https://api.open-meteo.com/**', () => {});
  await page.reload();
  await settle(page, 'paused', 1000);
  await weatherShowsData(page);
  await expect(page.locator('.screen.is-active .panel.b-clock .sk')).toHaveCount(0);
});

test('data that is overdue says how old it is', async ({ page }) => {
  await openDashboard(page, { screen: 'hub' });
  await page.route('https://api.open-meteo.com/**', (r) => r.abort());
  await expect(page.locator('.screen.is-active .panel[data-stale]')).toHaveCount(0);
  await page.clock.runFor(45 * 60000);
  const badge = page.locator('.screen.is-active .panel.b-clock[data-stale]');
  await expect(badge).toHaveAttribute('data-stale', /min/);
  // Back online: the next successful update clears it.
  await page.unroute('https://api.open-meteo.com/**');
  await page.clock.runFor(16 * 60000);
  await expect(page.locator('.screen.is-active .panel.b-clock[data-stale]')).toHaveCount(0);
});

test.describe('with the service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('the dashboard starts without internet', async ({ page, context }) => {
    await openDashboard(page, { screen: 'hub', clock: 'real' });
    // Registered a moment after startup; wait until it controls the page.
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys.find((k) => /^omd-[0-9a-f]+$/.test(k)));
      return (await c.keys()).map((r) => new URL(r.url).pathname);
    });
    expect(cached).toEqual(expect.arrayContaining(['/', '/fonts/inter-latin.woff2']));

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('meta[name="omd-build"]')).toHaveCount(1);
    await expect(page.locator('.screen.is-active .panel').first()).toBeVisible();
    await weatherShowsData(page);
    // Fonts come from the device, too.
    expect(await page.evaluate(() => document.fonts.check('16px Inter'))).toBe(true);
  });

  test('an expired sign-in still reaches the login page, and the login page is never saved', async ({ page, context }) => {
    await openDashboard(page, { screen: 'hub', clock: 'real' });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    // Like Cloudflare Access once its session has expired: the site redirects to the login page
    // (test/support/server.js does that while this cookie is set).
    const login = 'https://login.example.test/cdn-cgi/access/login';
    await page.route(`${login}**`, (r) => r.fulfill({ contentType: 'text/html', body: '<title>Sign in</title><h1>Sign in</h1>' }));
    await context.addCookies([{ name: 'omd-test-signed-out', value: '1', url: 'http://localhost:4173' }]);
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`^${login}`));
    await expect(page.locator('h1')).toHaveText('Sign in');

    // Signed in again: the dashboard, and what the device saved is still the dashboard.
    await context.clearCookies({ name: 'omd-test-signed-out' });
    await page.goto('/?local=1#hub');
    await expect(page.locator('meta[name="omd-build"]')).toHaveCount(1);
    const saved = await page.evaluate(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys.find((k) => /^omd-[0-9a-f]+$/.test(k)));
      return (await (await c.match(new URL('/', location).href))?.text()) || '';
    });
    expect(saved).toContain('name="omd-build"');
    expect(saved).not.toContain('Sign in</h1>');
  });

  test('?nosw=1 removes it again', async ({ page }) => {
    await openDashboard(page, { screen: 'hub', clock: 'real' });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    await page.goto('/?local=1&nosw=1#hub');
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  });
});

test('instant start: the saved picture of the screen shows before any dashboard code runs, then the live screen takes over', async ({ page }) => {
  await openDashboard(page, { screen: 'hub' });
  await page.clock.runFor(25000); // saved ~20 s after startup
  const size = await page.evaluate(() => localStorage.getItem('omd.snapshot.v1')?.length || 0);
  expect(size).toBeGreaterThan(1000);
  expect(size).toBeLessThan(1.5e6);

  // The fake clock is paused, so after this reload the dashboard waits for its first frame:
  // only the picture is there.
  await page.reload();
  const snap = page.locator('.screen.is-snapshot');
  await expect(snap).toHaveCount(1);
  await expect(snap.locator('.wx-temp').first()).toBeVisible();
  expect(await snap.locator('[id]').count()).toBe(0);
  await expect(page.locator('.screen:not(.is-snapshot)')).toHaveCount(0);

  await page.clock.runFor(1000);
  await expect(snap).toHaveCount(0);
  await expect(page.locator('.screen.is-active .panel.b-clock .wx-temp')).toBeVisible();
  // Tabs: the live ones only, once each.
  const tabs = await page.locator('#screenTabs .screen-tab').count();
  expect(tabs).toBe(await page.evaluate(() => new Set([...document.querySelectorAll('#screenTabs .screen-tab')].map((t) => t.title)).size));
});

test('the picture is only used for the same build and window size', async ({ page, context }) => {
  await openDashboard(page, { screen: 'hub' });
  await page.clock.runFor(25000);
  // A second tab (the first stays open, so it doesn't save again on the way out).
  const other = async (viewport) => {
    const p = await context.newPage();
    await p.setViewportSize(viewport);
    await p.clock.install({ time: +NOW });
    await p.clock.pauseAt(+NOW + 60000);
    await p.goto('/?local=1#hub');
    const n = await p.locator('.screen.is-snapshot').count();
    await p.close();
    return n;
  };
  expect(await other({ width: 1280, height: 800 })).toBe(1);
  expect(await other({ width: 1100, height: 800 })).toBe(0);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('omd.snapshot.v1'));
    localStorage.setItem('omd.snapshot.v1', JSON.stringify({ ...s, build: 'older' }));
  });
  expect(await other({ width: 1280, height: 800 })).toBe(0);
});

test.describe('network hiccups', () => {
  const forecastRequests = (page) => {
    const log = [];
    page.on('request', (r) => {
      if (r.url().startsWith('https://api.open-meteo.com/v1/forecast')) log.push(r.url());
    });
    return log;
  };

  test('offline: nothing is tried; back online: feeds catch up at once', async ({ page, context }) => {
    await openDashboard(page, { screen: 'hub' });
    const log = forecastRequests(page);
    await context.setOffline(true);
    await page.clock.runFor(40 * 60000);
    expect(log).toHaveLength(0);
    await context.setOffline(false);
    await page.clock.runFor(1000);
    expect(log.length).toBeGreaterThan(0);
  });

  test('a request that never answers does not stall its feed', async ({ page }) => {
    await openDashboard(page, { screen: 'hub' });
    const log = [];
    await page.route('https://api.open-meteo.com/v1/forecast**', (r) => log.push(r.request().url())); // never answers
    // The next poll (10:45, on the quarter hour) hangs; after 20 s it's abandoned and retried.
    await page.clock.runFor(4 * 60000);
    expect(log.length).toBeGreaterThanOrEqual(2);
  });

  test('failures back off instead of hammering the service', async ({ page }) => {
    await openDashboard(page, { screen: 'hub' });
    const log = forecastRequests(page);
    await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 503, body: 'busy' }));
    await page.clock.runFor(10 * 60000); // from the 10:45 poll on
    // 15 s, 30 s, 1 min, 2 min, 4 min … (±20 %): about 5 tries in 10 minutes, not one a minute.
    expect(log.length).toBeGreaterThanOrEqual(3);
    expect(log.length).toBeLessThanOrEqual(7);
  });
});
