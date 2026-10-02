/**
 * Performance budgets that don't depend on how fast the CI machine is: how often the
 * dashboard wakes the CPU, lays out the page and uses the network while it just sits on
 * the wall. Timings (boot, frame rates) are machine-dependent — see npm run bench.
 */
import { test, expect } from '@playwright/test';
import { openDashboard, expectNoFailedWidgets } from './helpers.js';

/** Counts timer and frame callbacks (each one wakes the CPU). */
function countWakeups() {
  // Steady state: the one-off frame check of automatic low-power mode (5 s, after startup) is done.
  localStorage.setItem('omd.lowpower.auto', JSON.stringify({ at: Date.now(), low: false }));
  const w = (window.__wake = { n: 0 });
  for (const name of ['setTimeout', 'setInterval', 'requestAnimationFrame']) {
    const orig = window[name];
    window[name] = function (fn, ...rest) {
      if (typeof fn !== 'function') return orig.call(this, fn, ...rest);
      return orig.call(
        this,
        function (...a) {
          w.n++;
          return fn.apply(this, a);
        },
        ...rest,
      );
    };
  }
}

/** Per simulated minute, over `minutes` minutes on the fake clock. */
async function steadyState(page, minutes = 5) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  let requests = 0;
  page.on('request', () => requests++);
  const m0 = await metrics(),
    w0 = await page.evaluate(() => window.__wake.n);
  for (let i = 0; i < minutes; i++) await page.clock.runFor(60000);
  const m1 = await metrics(),
    w1 = await page.evaluate(() => window.__wake.n);
  return {
    wakeups: (w1 - w0) / minutes,
    layouts: (m1.LayoutCount - m0.LayoutCount) / minutes,
    styles: (m1.RecalcStyleCount - m0.RecalcStyleCount) / minutes,
    requests: requests / minutes,
  };
}

// Budgets per screen, per minute. Lower them when an optimisation lands; never raise them
// without a reason in the commit message.
const BUDGET = {
  // ~60 wake-ups: the one heartbeat a second (clocks with seconds); everything else rides on it.
  // Layout and style counts vary by machine (the CI runner lays out more often than a laptop):
  // the margins cover that, not regressions.
  hub: { wakeups: 66, layouts: 14, styles: 16, requests: 3 },
  family: { wakeups: 66, layouts: 15, styles: 17, requests: 3 },
  frame: { wakeups: 66, layouts: 14, styles: 17, requests: 5 },
  info: { wakeups: 76, layouts: 30, styles: 33, requests: 3 },
};

for (const [screen, budget] of Object.entries(BUDGET)) {
  test(`${screen}: stays within its idle budget`, async ({ page }) => {
    const { errors } = await openDashboard(page, { screen, beforeLoad: countWakeups });
    await expectNoFailedWidgets(page);
    const got = await steadyState(page);
    console.log(screen, JSON.stringify(got));
    for (const [k, max] of Object.entries(budget)) expect(got[k], `${k} per minute on ${screen}: ${JSON.stringify(got)}`).toBeLessThanOrEqual(max);
    expect(errors).toEqual([]);
  });
}

test('?perf=1 shows the performance overlay', async ({ page }) => {
  const { errors } = await openDashboard(page, { query: 'perf=1' });
  const hud = page.locator('.perf-hud');
  await expect(hud).toContainText('fps');
  await expect(hud).toContainText('boot');
  expect(errors).toEqual([]);
});
