import { expect } from '@playwright/test';
import { mockNetwork, seedRandom, fakeApi, NOW } from '../support/mock-network.js';

export { fakeApi, NOW };
export const VIEWPORTS = {
  landscape: { width: 1280, height: 800 },
  narrow: { width: 1024, height: 768 },
  short: { width: 1000, height: 600 },
  portrait: { width: 800, height: 1280 },
  phone: { width: 390, height: 844 },
};

/**
 * Open the dashboard with every outside service mocked. Returns { errors, api }: errors
 * collects uncaught page errors (tests usually expect none).
 * clock: 'paused' (deterministic, advance with page.clock.runFor), 'real' (real timers).
 */
export async function openDashboard(page, { screen = 'hub', cloud = false, api, query = '', viewport = 'landscape', clock = 'paused', beforeLoad } = {}) {
  const errors = [];
  // test/fixtures/widgets/broken-syntax doesn't parse on purpose; everything else counts.
  page.on('pageerror', (e) => {
    if (!(e.name === 'SyntaxError' && /missing \) after argument list/.test(e.message))) errors.push(e);
  });
  await page.setViewportSize(VIEWPORTS[viewport] || viewport);
  await seedRandom(page);
  if (clock === 'paused') {
    // Installed well before NOW, then paused at NOW: the fake clock runs in real time until then,
    // and on a busy machine a small margin can already be in the past. Nothing runs yet (no page).
    await page.clock.install({ time: new Date(+NOW - 10 * 60000) });
    await page.clock.pauseAt(NOW);
  }
  if (beforeLoad) await page.addInitScript(beforeLoad);
  const theApi = await mockNetwork(page, { cloud, api });
  const q = [cloud ? '' : 'local=1', query].filter(Boolean).join('&');
  await page.goto(`/${q ? `?${q}` : ''}#${screen}`);
  await settle(page, clock);
  return { errors, api: theApi };
}

/** Let data arrive and layouts settle (fonts, "auto" rows at 1.5 s and 6 s). */
export async function settle(page, clock = 'paused', ms = 7000) {
  if (clock === 'paused') {
    for (let t = 0; t < ms; t += 1000) {
      await page.clock.runFor(1000);
      await page.waitForLoadState('networkidle');
    }
  } else {
    await page.waitForLoadState('networkidle');
  }
}

/** The panels of the active screen that are laid out (not hidden in this orientation). */
export const visiblePanels = (page) => page.locator('.screen.is-active > .grid > .panel:not(.is-off)');

export async function expectNoFailedWidgets(page) {
  const failed = await page
    .locator('.panel.is-failed')
    .evaluateAll((els) => els.map((e) => `${e.getAttribute('aria-label')}: ${e.innerText.replace(/\s+/g, ' ')}`));
  expect(failed, 'widgets showing an error card').toEqual([]);
}

/** Box of each visible panel, by slot. */
export const panelBoxes = (page) =>
  visiblePanels(page).evaluateAll((els) =>
    Object.fromEntries(
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return [e.dataset.block, { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }];
      }),
    ),
  );
