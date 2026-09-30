// The ⚙ drawer: the dashboard's own sections plus one per widget, generated from the
// widget definitions; saving; custom field types; retired API-key settings.
import { test, expect } from '@playwright/test';
import { openDashboard, fakeApi } from './helpers.js';

const open = async (page) => {
  await page.locator('#btnSettings').click();
  await page.clock.runFor(400);
};
const sections = (page, group) => page.locator('.settings-group', { hasText: group }).locator('summary').allInnerTexts();

test('sections: the system ones, then one per widget with settings, by picker group', async ({ page }) => {
  await openDashboard(page, { screen: 'hub' });
  await open(page);
  expect(await sections(page, 'System')).toEqual(['Screens', 'Location, units & time', 'Status bar', 'Kiosk & display']);
  expect(await sections(page, 'What each widget shows')).toEqual([
    'Clock',
    'Countdowns',
    'World clocks', // Time & weather
    'Calendar',
    'Chores',
    'Family note',
    'Lists',
    'Quote', // Family
    'News',
    'Now Playing',
    'Photo slideshow', // Photos, music & news
    'Commute',
    'Planes overhead',
    'Public transport', // Getting around
    'Data widgets',
    'Smart home',
    'Web page', // Home & web
    'Markets',
    'Sports',
    'Strava', // Fitness & markets
  ]);
  // No API keys among the settings any more.
  for (const key of ['TODOIST_TOKEN', 'FINNHUB_TOKEN', 'TOMTOM_KEY']) await expect(page.locator(`[name="${key}"]`)).toHaveCount(0);
});

test('?dev=1 also lists hidden widgets (the example)', async ({ page }) => {
  await openDashboard(page, { screen: 'hub', query: 'dev=1' });
  await open(page);
  expect(await sections(page, 'What each widget shows')).toContain('Hello (example)');
});

test('saving a widget setting reloads with it (local mode)', async ({ page }) => {
  await openDashboard(page, { screen: 'hub' });
  await expect(page.locator('.screen.is-active .b-clock .clock-hm')).toBeVisible();
  await open(page);
  await page.locator('summary', { hasText: 'Clock' }).first().click();
  await page.locator('select[name="CLOCK_STYLE"]').selectOption('analog');
  await Promise.all([page.waitForEvent('load'), page.locator('#btnSettingsSave').click()]);
  await page.clock.runFor(2000);
  await expect(page.locator('.screen.is-active .b-clock svg.analog')).toBeVisible();
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('omd.settings.v2')))).toEqual({ CLOCK_STYLE: 'analog' });
});

test('a widget’s own field type: the Commute destinations editor', async ({ page }) => {
  await openDashboard(page, { screen: 'info' });
  await open(page);
  const section = page.locator('details.b-commute');
  await section.locator('summary').click();
  await section.getByRole('button', { name: 'Add destination' }).click();
  await section.getByRole('textbox', { name: 'Name' }).fill('Office');
  await section.locator('input[aria-label="Destination"]').fill('51.5155,-0.0922');
  await section.locator('select[aria-label="How"]').selectOption('bike');
  await expect(section.locator('textarea[name="COMMUTES"]')).toHaveValue('Office | 51.5155,-0.0922 | bike');
});

test('the transport demo’s button opens its setting', async ({ page }) => {
  await openDashboard(page, { screen: 'hub', query: 'TRANSPORT_URL=' });
  await page.locator('.b-transport .cta').click();
  await page.clock.runFor(400);
  await expect(page.locator('input[name="TRANSPORT_URL"]')).toBeFocused();
});

test('API keys still in the shared settings: a notice, and saving removes them', async ({ page }) => {
  const api = fakeApi({ state: { config: { rev: 3, value: { TODOIST_TOKEN: 'secret-td', DASHBOARD_NAME: 'Home' } } } });
  await openDashboard(page, { screen: 'hub', cloud: true, api });
  await expect(page.locator('.brand-name')).toHaveText('Home');
  await open(page);
  await expect(page.locator('.settings-top[role="note"]')).toContainText('TODOIST_TOKEN is still in the saved settings');
  await Promise.all([page.waitForEvent('load'), page.locator('#btnSettingsSave').click()]);
  expect(api.state.config.value).toEqual({ DASHBOARD_NAME: 'Home' });
});

test('URL params win over saved settings', async ({ page }) => {
  await openDashboard(page, { screen: 'hub', query: 'DASHBOARD_NAME=Kitchen%20tablet' });
  await expect(page.locator('.brand-name')).toHaveText('Kitchen tablet');
});
