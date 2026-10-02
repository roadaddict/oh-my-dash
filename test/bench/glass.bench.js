/**
 * The frosted glass over a busy photo: the old live blur vs the pre-blurred layer, as two
 * screenshots to compare by eye — test/.bench/glass-old.png and glass-new.png.
 *   npm run bench -- glass
 */
import { test } from '@playwright/test';
import fs from 'node:fs';
import { openDashboard } from '../e2e/helpers.js';
const OLD =
  '.glass-layer{display:none!important}.panel:not(.is-bare):not(.is-seamless){backdrop-filter:blur(12px) saturate(1.4)!important;-webkit-backdrop-filter:blur(12px) saturate(1.4)!important}';
// A busy photo: stripes, circles and text, so blur differences show.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><defs><pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="20" height="40" fill="#e0a040"/><rect x="20" width="20" height="40" fill="#2050a0"/></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/>${Array.from({ length: 30 }, (_, i) => `<circle cx="${(i * 173) % 1600}" cy="${(i * 97) % 1000}" r="${40 + (i % 5) * 20}" fill="hsl(${i * 37},70%,55%)"/>`).join('')}<text x="100" y="500" font-size="160" fill="white">SHARP TEXT</text></svg>`;
test('glass: live blur vs pre-blurred layer', async ({ page }) => {
  await openDashboard(page, { screen: 'frame' });
  await page.route('https://picsum.photos/id/**', (r) =>
    r.fulfill({ contentType: 'image/svg+xml', body: svg, headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  for (let i = 0; i < 4; i++) {
    await page.clock.runFor(30000); // next slides: the busy photo
    await page.waitForLoadState('networkidle');
  }
  await page.clock.runFor(3000);
  const nu = await page.screenshot({ animations: 'disabled' });
  await page.addStyleTag({ content: OLD });
  await page.clock.runFor(100);
  const old = await page.screenshot({ animations: 'disabled' });
  fs.writeFileSync('test/.bench/glass-new.png', nu);
  fs.writeFileSync('test/.bench/glass-old.png', old);
});
