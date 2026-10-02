// Lists: add (comma-separated, no duplicates), tick, hold to delete with Undo, quick-add,
// clear ticked, the phone view — and syncing between two screens in cloud mode.
import { test, expect } from '@playwright/test';
import { openDashboard, fakeApi, settle } from './helpers.js';

const lists = (page) => page.locator('.screen.is-active .b-lists');
const items = (page) => lists(page).locator('.item');
const add = async (page, text) => {
  await lists(page).getByRole('textbox', { name: 'New item' }).fill(text);
  await lists(page).getByRole('textbox', { name: 'New item' }).press('Enter');
  await page.clock.runFor(100);
};

test('add items: commas split, spaces are tidied, nothing is duplicated', async ({ page }) => {
  await openDashboard(page, { screen: 'family' });
  await expect(items(page)).toHaveCount(7);
  await add(page, 'Butter, milk ,  Oat   milk');
  await expect(items(page)).toHaveCount(9); // "milk" is already there
  await expect(items(page).first()).toHaveText('Oat milk'); // in the order typed, the last one on top
  await expect(items(page).nth(1)).toHaveText('Butter');
  await expect(lists(page).locator('.panel-meta')).toHaveText('Groceries · 9 open');
});

test('tick moves an item under "Done"; ticking everything celebrates', async ({ page }) => {
  await openDashboard(page, { screen: 'family' });
  await lists(page).getByRole('tab', { name: /To-do/ }).click();
  await expect(items(page)).toHaveCount(4);
  await items(page).filter({ hasText: 'Call the plumber' }).click();
  await expect(lists(page).locator('.items-sep')).toHaveText('Done · 1');
  await expect(items(page).last()).toHaveText('Call the plumber');
  await expect(items(page).last()).toHaveAttribute('aria-pressed', 'true');
  const open = lists(page).locator('.item:not(.is-done)');
  while (await open.count()) await open.first().click();
  await expect(lists(page).locator('.all-done')).toContainText('All done!');
  // 🗑 clears the ticked ones.
  await lists(page).getByRole('button', { name: 'Clear completed' }).click();
  await expect(lists(page).locator('.empty')).toContainText('Nothing here');
});

test('hold to delete, with Undo', async ({ page }) => {
  await openDashboard(page, { screen: 'family' });
  const eggs = items(page).filter({ hasText: 'Eggs' });
  const box = await eggs.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.clock.runFor(700);
  await page.mouse.up();
  await expect(items(page).filter({ hasText: 'Eggs' })).toHaveCount(0);
  await expect(lists(page).locator('.undo-bar')).toContainText('Removed “Eggs”');
  await lists(page).getByRole('button', { name: 'Undo' }).click();
  await expect(items(page).filter({ hasText: 'Eggs' })).toHaveCount(1);
  await expect(items(page).filter({ hasText: 'Eggs' })).toHaveAttribute('aria-pressed', 'false');
});

test('quick-add chips suggest what was added before', async ({ page }) => {
  await openDashboard(page, { screen: 'family', viewport: { width: 1280, height: 1200 } });
  await add(page, 'Lemons');
  await items(page).filter({ hasText: 'Lemons' }).click(); // tick: no longer open…
  await expect(lists(page).locator('.quick-add', { hasText: 'Lemons' })).toBeVisible(); // …so it's suggested
  await lists(page).locator('.quick-add', { hasText: 'Lemons' }).click();
  await expect(items(page).filter({ hasText: 'Lemons' })).toHaveAttribute('aria-pressed', 'false');
});

test('phone view (?view=lists): just the lists, nothing else loads', async ({ page }) => {
  const { errors } = await openDashboard(page, { query: 'view=lists', viewport: 'phone' });
  expect(errors).toEqual([]);
  await expect(page.locator('.app')).toHaveClass(/view-phone/);
  await expect(page.locator('.panel')).toHaveCount(1);
  await expect(page.locator('.b-lists .item')).toHaveCount(7);
  await expect(page).toHaveTitle(/^Lists · /);
});

test('cloud mode: an item added on a phone shows up on the tablet', async ({ browser }) => {
  const api = fakeApi();
  const tablet = await browser.newPage(),
    phone = await browser.newPage();
  await openDashboard(tablet, { screen: 'family', cloud: true, api });
  await openDashboard(phone, { query: 'view=lists', viewport: 'phone', cloud: true, api });
  await phone.locator('.b-lists').getByRole('textbox', { name: 'New item' }).fill('Coffee filters');
  await phone.locator('.b-lists').getByRole('textbox', { name: 'New item' }).press('Enter');
  await phone.clock.runFor(1000);
  expect(api.state.lists.value.Groceries.map((i) => i.text)).toContain('Coffee filters');
  // The tablet polls every 15 s (it's 7 s in): step just past the poll, then let the request finish in
  // small steps — one big jump would also fire the request's 8 s timeout before the response arrives.
  await tablet.clock.runFor(8500);
  await settle(tablet, 'paused', 2000);
  await expect(tablet.locator('.screen.is-active .b-lists .item', { hasText: 'Coffee filters' })).toHaveCount(1);
  // Only lists sync this way: the phone never had a tablet's other widgets.
  await expect(phone.locator('.panel')).toHaveCount(1);
});

test('cloud mode: an item added while the cloud is unreachable survives a reload and merges with edits made elsewhere', async ({ browser }) => {
  const api = fakeApi();
  const tablet = await browser.newPage(),
    phone = await browser.newPage();
  await openDashboard(tablet, { screen: 'family', cloud: true, api });
  await openDashboard(phone, { query: 'view=lists', viewport: 'phone', cloud: true, api });
  // The tablet loses the cloud; its edit waits on the device.
  await tablet.route('**/api/state**', (r) => r.abort());
  await add(tablet, 'Tea');
  // Meanwhile a phone adds something else.
  await phone.locator('.b-lists').getByRole('textbox', { name: 'New item' }).fill('Honey');
  await phone.locator('.b-lists').getByRole('textbox', { name: 'New item' }).press('Enter');
  await phone.clock.runFor(1000);
  expect(api.state.lists.value.Groceries.map((i) => i.text)).toContain('Honey');
  expect(api.state.lists.value.Groceries.map((i) => i.text)).not.toContain('Tea');
  // The tablet restarts, still without the cloud: the item is still there.
  await tablet.reload();
  await settle(tablet, 'paused', 2000);
  await expect(tablet.locator('.screen.is-active .b-lists .item', { hasText: 'Tea' })).toHaveCount(1);
  // The cloud is back: the tablet's item is sent, and nobody's edit is lost.
  await tablet.unroute('**/api/state**');
  await tablet.clock.runFor(15500);
  await settle(tablet, 'paused', 3000);
  const texts = api.state.lists.value.Groceries.map((i) => i.text);
  expect(texts).toContain('Tea');
  expect(texts).toContain('Honey');
  await expect(tablet.locator('.screen.is-active .b-lists .item', { hasText: 'Honey' })).toHaveCount(1);
  expect(await tablet.evaluate(() => localStorage.getItem('omd.sync-pending.v1'))).toBeNull();
});
