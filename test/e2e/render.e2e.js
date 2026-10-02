/**
 * Rendering that stays cheap on old tablets: no live blur behind panels (a pre-blurred
 * copy of the photo does the frosting), panels contained, hidden screens not rendered.
 */
import { test, expect } from '@playwright/test';
import { openDashboard, expectNoFailedWidgets } from './helpers.js';

const liveBlurs = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.screen.is-active .panel')]
      .filter((p) => {
        const cs = getComputedStyle(p);
        return (cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none');
      })
      .map((p) => p.dataset.block),
  );

test('photo screen: panels are frosted by one pre-blurred layer, cut to their shapes', async ({ page }) => {
  const { errors } = await openDashboard(page, { screen: 'frame' });
  await expectNoFailedWidgets(page);
  expect(await liveBlurs(page)).toEqual([]);
  const glass = page.locator('.screen.is-active .glass-layer');
  await expect(glass).toHaveCount(1);
  const { clip, panels, image } = await glass.evaluate((el) => ({
    clip: getComputedStyle(el).clipPath,
    panels: el.closest('.screen').querySelectorAll('.grid > .panel:not(.is-off):not(.is-bare):not(.is-seamless)').length,
    image: el.querySelector('.slide.is-visible .slide-img')?.style.backgroundImage || '',
  }));
  expect(panels).toBeGreaterThan(0);
  expect((clip.match(/M/g) || []).length).toBe(panels); // one rounded rectangle per panel
  expect(image).toMatch(/^url\("data:image\/jpeg/); // the small blurred copy, not the photo
  expect(errors).toEqual([]);
});

test('plain background: no blur at all', async ({ page }) => {
  await openDashboard(page, { screen: 'hub' });
  expect(await liveBlurs(page)).toEqual([]);
  await expect(page.locator('.glass-layer')).toHaveCount(0);
});

test('panels are contained; a screen that is not showing is not rendered', async ({ page }) => {
  await openDashboard(page, { screen: 'hub' });
  const contain = await page.locator('.screen.is-active .grid > .panel.b-calendar').evaluate((p) => getComputedStyle(p).contain);
  expect(contain).toMatch(/content|layout/); // "layout paint style" reads back as "content"
  await page.locator('.screen-tab[title="Info"]').click();
  await page.clock.runFor(1000);
  await expect(page.locator('.screen[data-screen="hub"]')).toHaveClass(/is-dormant/);
  await page.locator('.screen-tab[title="Home"]').click();
  await expect(page.locator('.screen[data-screen="hub"]')).not.toHaveClass(/is-dormant/);
  await expect(page.locator('.screen[data-screen="hub"] .panel.b-calendar')).toBeVisible();
});

test.describe('low-power mode', () => {
  test('automatic: on for weak hardware', async ({ page }) => {
    await openDashboard(page, { screen: 'hub', beforeLoad: () => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 }) });
    await expect(page.locator('body')).toHaveClass(/low-power/);
    await expect(page.locator('body')).toHaveAttribute('data-power', 'auto');
  });
  test('automatic: on when frames are slow, and remembered', async ({ page }) => {
    // A 4-core tablet (not "weak" on paper) whose every frame takes 60 ms.
    await openDashboard(page, {
      screen: 'hub',
      beforeLoad: () => {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
        const raf = window.requestAnimationFrame.bind(window);
        let t = 0;
        window.requestAnimationFrame = (fn) => raf(() => fn((t += 60)));
      },
    });
    await expect(page.locator('body')).not.toHaveClass(/low-power/);
    await page.clock.runFor(30000);
    await expect(page.locator('body')).toHaveClass(/low-power/);
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('omd.lowpower.auto'))).low).toBe(true);
    await page.reload();
    await page.clock.runFor(1000); // a snapshot is up first; the dashboard starts on the next frame
    await expect(page.locator('body')).toHaveClass(/low-power/);
  });
  test('off means off, on means on', async ({ page }) => {
    await openDashboard(page, {
      screen: 'hub',
      query: 'LOW_POWER=off',
      beforeLoad: () => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 1 }),
    });
    await expect(page.locator('body')).not.toHaveClass(/low-power/);
    await page.goto('/?local=1&LOW_POWER=1#hub');
    await page.clock.runFor(1000);
    await expect(page.locator('body')).toHaveClass(/low-power/);
  });
});

test('whatever keeps animating while the dashboard sits there runs on the GPU (transform / opacity only)', async ({ page }) => {
  for (const screen of ['hub', 'family', 'frame', 'info']) {
    await openDashboard(page, { screen, clock: 'real' });
    await page.waitForTimeout(1500);
    const offGpu = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity)
        .map((a) => {
          const props = new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)));
          ['offset', 'computedOffset', 'easing', 'composite', 'transform', 'opacity'].forEach((p) => props.delete(p));
          const t = a.effect.target;
          return props.size ? `${a.animationName} on .${String(t.className?.baseVal ?? t.className).split(' ')[0]}: ${[...props]}` : null;
        })
        .filter(Boolean),
    );
    expect(offGpu, `endless animations on ${screen} that restyle every frame`).toEqual([]);
  }
});
