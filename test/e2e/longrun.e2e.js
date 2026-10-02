/**
 * Hours on the wall, in seconds: screens rotating, feeds polling, photos changing. Memory
 * and the number of elements must level off, not keep growing (a leak on a tablet that
 * runs for weeks ends in a crash or a stutter). The daily reload is a safety net, not a fix.
 */
import { test, expect } from '@playwright/test';
import { openDashboard, expectNoFailedWidgets } from './helpers.js';

test('three hours of screens rotating: memory and elements level off', async ({ page }) => {
  test.setTimeout(240000);
  const { errors } = await openDashboard(page, { screen: 'hub', query: 'SCREEN_ROTATE_SEC=20' });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const sample = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    return { heapMB: m.JSHeapUsedSize / 1e6, nodes: m.Nodes, listeners: m.JSEventListeners };
  };
  // Warm up: every screen built once, caches filled.
  await page.clock.runFor(30 * 60000);
  const first = await sample();
  const samples = [];
  for (let h = 0; h < 3; h++) {
    await page.clock.runFor(60 * 60000);
    samples.push(await sample());
  }
  const last = samples.at(-1);
  console.log('long run', JSON.stringify({ first, samples }));
  expect(last.nodes, 'elements after 3 h vs after warm-up').toBeLessThan(first.nodes * 1.1 + 200);
  expect(last.listeners, 'event listeners').toBeLessThan(first.listeners * 1.1 + 100);
  expect(last.heapMB, 'JS heap (MB)').toBeLessThan(first.heapMB * 1.25 + 2);
  await expectNoFailedWidgets(page);
  expect(errors).toEqual([]);
});
