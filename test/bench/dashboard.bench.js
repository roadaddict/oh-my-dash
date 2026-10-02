/**
 * Startup and steady-state cost of each screen, on a normal and a 6× slowed CPU
 * (roughly an old tablet). Every outside service is mocked, so only the dashboard's own
 * work is measured. Results: printed, and saved to test/.bench/<BENCH_LABEL or "last">.json.
 *
 *   boot      ms from navigation until the screen's widgets are mounted (first visit)
 *   lcp       ms until the largest piece of content was painted (first visit) — when the
 *             screen looks "there"; the status bar alone paints earlier
 *   warmLcp   the same on the next visit (saved data, snapshot); warmBoot: widgets mounted
 *   snapKB    size of the saved snapshot
 *   blockMs   total main-thread time in long tasks (> 50 ms) during boot; worst = longest one
 *   wakeups   timer / frame callbacks per minute once running (each one wakes the CPU)
 *   layouts   layout passes per minute once running; styles = style recalculations
 *   requests  network requests per minute once running
 *   fps       frames per second over 5 s of real time (animations, blur)
 *   idleMs    main-thread work per second of real time once settled (6× CPU only): what the
 *             tablet spends just keeping the screen up to date — animations, clocks, polling
 */
import { test } from '@playwright/test';
import fs from 'node:fs';
import { openDashboard } from '../e2e/helpers.js';
import { mockNetwork } from '../support/mock-network.js';

const results = [];
const SCREENS = ['hub', 'family', 'frame', 'info', 'all'];

function countCallbacks() {
  // The automatic low-power check (5 s of frames, once) is not part of steady state.
  localStorage.setItem('omd.lowpower.auto', JSON.stringify({ at: Date.now(), low: false }));
  const w = (window.__wake = { n: 0 });
  const wrap = (name, idx) => {
    const orig = window[name];
    window[name] = function (...args) {
      const fn = args[idx];
      if (typeof fn === 'function')
        args[idx] = function (...a) {
          w.n++;
          return fn.apply(this, a);
        };
      return orig.apply(this, args);
    };
  };
  wrap('setTimeout', 0);
  wrap('setInterval', 0);
  wrap('requestAnimationFrame', 0);
  window.__lt = [];
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: 'longtask', buffered: true });
  } catch {
    /* not supported */
  }
}

for (const cpu of [1, 6])
  for (const screen of SCREENS)
    test(`${screen} · cpu ×${cpu}`, async ({ page: first, baseURL, contextOptions }) => {
      let page = first;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      // Boot, on the real clock (the fake one also fakes performance.now).
      await openDashboard(page, { screen, clock: 'real', beforeLoad: countCallbacks });
      const timing = (p) =>
        p.evaluate(async () => ({
          boot: Math.round(performance.getEntriesByName('omd:ready')[0]?.startTime ?? -1),
          lcp: Math.round(
            await new Promise((r) =>
              new PerformanceObserver((l) => r(l.getEntries().at(-1)?.startTime ?? -1)).observe({ type: 'largest-contentful-paint', buffered: true }),
            ),
          ),
        }));
      const { boot, lcp } = await timing(page);
      const bootLT = await page.evaluate(() => window.__lt.splice(0));
      // Steady state on the fake clock, in a fresh page.
      await page.close();
      page = await page.context().newPage();
      const cdp2 = await page.context().newCDPSession(page);
      await cdp2.send('Performance.enable');
      await cdp2.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      await openDashboard(page, { screen, clock: 'paused', beforeLoad: countCallbacks });
      // Steady state: 5 simulated minutes, counted per minute.
      let requests = 0;
      page.on('request', () => requests++);
      const before = Object.fromEntries((await cdp2.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
      const w0 = await page.evaluate(() => window.__wake.n);
      for (let i = 0; i < 5; i++) await page.clock.runFor(60000);
      const w1 = await page.evaluate(() => window.__wake.n);
      const after = Object.fromEntries((await cdp2.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
      // Frames over 5 s of real time.
      await page.clock.resume();
      const fps = await page.evaluate(
        () =>
          new Promise((res) => {
            let n = 0;
            const t = performance.now();
            const f = () => (performance.now() - t < 5000 ? (n++, requestAnimationFrame(f)) : res(Math.round(n / 5)));
            requestAnimationFrame(f);
          }),
      );
      // Next visit (e.g. the daily reload): saved feed data and the snapshot are there now.
      const snapKB = await page.evaluate(() => Math.round((localStorage.getItem('omd.snapshot.v1')?.length || 0) / 1024));
      // Saved on the fake clock (March 2026): re-date to now, as if saved a moment ago.
      await page.evaluate((now) => {
        for (const k of Object.keys(localStorage))
          if (k.startsWith('omd.feed.') || k === 'omd.snapshot.v1')
            localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k)), at: now }));
      }, Date.now());
      // A new browser context: the fake clock belongs to the old one. Same saved data.
      const warmCtx = await page
        .context()
        .browser()
        .newContext({ ...contextOptions, baseURL, storageState: await page.context().storageState() });
      const warm = await warmCtx.newPage();
      await mockNetwork(warm);
      const cdp3 = await warm.context().newCDPSession(warm);
      await cdp3.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      await warm.goto(`/?local=1#${screen}`);
      await warm.waitForLoadState('networkidle');
      const w = await timing(warm);
      await warmCtx.close();
      // Idle cost on the real clock (the fake one fast-forwards timers without frames).
      let idleMs = null;
      if (cpu === 6) {
        const idle = await page
          .context()
          .browser()
          .newContext({ ...contextOptions, baseURL });
        const ip = await idle.newPage();
        await ip.addInitScript(() => localStorage.setItem('omd.lowpower.auto', JSON.stringify({ at: Date.now(), low: false })));
        const c = await idle.newCDPSession(ip);
        await c.send('Emulation.setCPUThrottlingRate', { rate: cpu });
        await openDashboard(ip, { screen, clock: 'real' });
        await ip.waitForTimeout(20000);
        await c.send('Performance.enable');
        const task = async () => (await c.send('Performance.getMetrics')).metrics.find((x) => x.name === 'TaskDuration').value;
        const t0 = await task();
        await ip.waitForTimeout(10000);
        idleMs = Math.round(((await task()) - t0) * 100); // s per 10 s → ms per s
        await idle.close();
      }
      const r = {
        screen,
        cpu,
        boot,
        lcp,
        warmLcp: w.lcp,
        warmBoot: w.boot,
        snapKB,
        idleMs,
        blockMs: Math.round(bootLT.reduce((a, b) => a + b, 0)),
        worst: Math.round(Math.max(0, ...bootLT)),
        wakeups: Math.round((w1 - w0) / 5),
        layouts: Math.round((after.LayoutCount - before.LayoutCount) / 5),
        styles: Math.round((after.RecalcStyleCount - before.RecalcStyleCount) / 5),
        requests: Math.round(requests / 5),
        fps,
        nodes: after.Nodes,
        heapMB: +(after.JSHeapUsedSize / 1e6).toFixed(1),
      };
      results.push(r);
      console.log(JSON.stringify(r));
    });

test.afterAll(() => {
  fs.mkdirSync('test/.bench', { recursive: true });
  const file = `test/.bench/${process.env.BENCH_LABEL || 'last'}.json`;
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  console.table(results);
});
