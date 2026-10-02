/**
 * Where boot time goes: a CPU profile of loading one screen on a 6× slowed CPU, as self
 * time per function. SCREEN=info npm run bench -- profile
 */
import { test } from '@playwright/test';
import { openDashboard } from '../e2e/helpers.js';

test('profile: boot', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await openDashboard(page, { screen: process.env.SCREEN || 'hub', clock: 'real' });
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  profile.samples.forEach((id, i) => {
    const f = byId.get(id).callFrame;
    const k = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
    self.set(k, (self.get(k) || 0) + (profile.timeDeltas[i] || 0));
  });
  for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${(us / 1000).toFixed(1).padStart(7)} ms  ${k}`);
});
