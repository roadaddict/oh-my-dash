import { test, expect } from '@playwright/test';
import { mockNetwork, seedRandom, NOW } from '../support/mock-network.js';

const VIEWPORTS = {
  landscape: { width: 1280, height: 800 },
  narrow: { width: 1024, height: 768 },
  short: { width: 1000, height: 600 },
  portrait: { width: 800, height: 1280 },
  phone: { width: 390, height: 844 },
};
const SCREENS = ['hub', 'family', 'frame', 'info'];

const shot = (page, opts = {}) =>
  page.screenshot({
    animations: 'disabled',
    style: '#netChip { visibility: hidden; width: 220px; flex: none; } .np-bar i, .np-times { visibility: hidden; }',
    ...opts,
  });

async function open(page, { cloud, screen, viewport }) {
  await page.setViewportSize(VIEWPORTS[viewport]);
  await seedRandom(page);
  await page.clock.install({ time: new Date(+NOW - 10 * 60000) });
  await page.clock.pauseAt(NOW);
  await mockNetwork(page, { cloud });
  await page.goto(`/${cloud ? '' : '?local=1'}#${screen}`);
  for (let i = 0; i < 4; i++) {
    await page.clock.runFor(2000);
    await page.waitForLoadState('networkidle');
  }
  await page.clock.runFor(1000);
}

for (const cloud of [false, true]) {
  for (const viewport of Object.keys(VIEWPORTS)) {
    for (const screen of SCREENS) {
      const name = `${cloud ? 'cloud' : 'local'}-${viewport}-${screen}`;
      test(name, async ({ page }) => {
        await open(page, { cloud, screen, viewport });
        expect(await shot(page, { fullPage: viewport === 'phone' })).toMatchSnapshot(`${name}.png`);
      });
    }
  }
}

test('cloud-editor-picker', async ({ page }) => {
  await open(page, { cloud: true, screen: 'hub', viewport: 'landscape' });
  await page.click('#btnEdit');
  await page.clock.runFor(500);
  expect(await shot(page)).toMatchSnapshot('cloud-editor.png');
  await page.locator('.edit-tile[data-slot="calendar"] [data-act="change"]').click();
  await page.clock.runFor(500);
  expect(await shot(page)).toMatchSnapshot('cloud-picker.png');
});

test('local-expanded-weather', async ({ page }) => {
  await open(page, { cloud: false, screen: 'info', viewport: 'landscape' });
  await page.locator('.b-weather [data-action="expand"]').click();
  await page.clock.runFor(1000);
  expect(await shot(page)).toMatchSnapshot('local-expanded-weather.png');
});
