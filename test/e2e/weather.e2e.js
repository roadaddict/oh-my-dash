// The one weather component adapts to its own box (container queries, see
// app/core/styles/45-weather.css). The "wx" test screen shows it at six sizes at once.
import { test, expect } from '@playwright/test';
import { openDashboard, expectNoFailedWidgets } from './helpers.js';

async function states(page) {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.screen.is-active .panel')].map((p) => {
        const shown = (s) => {
          const e = p.querySelector(s);
          return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
        };
        return [
          p.dataset.block,
          {
            stats: shown('.wxd-stats'),
            caption: shown('.chart-cap'),
            chart: shown('.wx-graph'),
            days: shown('.forecast'),
            rangeBars: shown('.fc-range'),
            dayIcons: shown('.fc-ic'),
            sideBySide: getComputedStyle(p.querySelector('.wx')).gridTemplateColumns.split(' ').length === 2,
            dayRows: getComputedStyle(p.querySelector('.forecast')).gridTemplateColumns.split(' ').length === 1,
          },
        ];
      }),
    ),
  );
}

test('weather adapts to its box: wide/narrow × tall/medium/short', async ({ page }) => {
  const { errors } = await openDashboard(page, { screen: 'wx', query: 'SCREENS=wx', viewport: { width: 1280, height: 1200 } });
  expect(errors).toEqual([]);
  await expectNoFailedWidgets(page);
  const s = await states(page);
  // Wide & tall: conditions + facts beside the days, chart underneath.
  expect(s.a).toMatchObject({ sideBySide: true, stats: true, caption: true, chart: true, days: true, dayRows: false, rangeBars: false });
  // Narrow & tall: days as Apple-style rows with temperature-range bars.
  expect(s.b).toMatchObject({ sideBySide: false, stats: true, chart: true, days: true, dayRows: true, rangeBars: true });
  // Wide & short: no facts line, no chart caption.
  expect(s.c).toMatchObject({ sideBySide: true, stats: false, caption: false, chart: true, days: true });
  // Narrow, medium: compact days without icons.
  expect(s.d).toMatchObject({ sideBySide: false, stats: false, chart: true, days: true, dayIcons: false });
  expect(s.e).toMatchObject({ sideBySide: true, stats: false, chart: true, days: true });
  // Narrow & short: the days make way for the chart.
  expect(s.f).toMatchObject({ sideBySide: false, stats: false, chart: true, days: false });
});

test('the facts line never shows a chip cut in half', async ({ page }) => {
  await openDashboard(page, { screen: 'wx', query: 'SCREENS=wx', viewport: { width: 1280, height: 1200 } });
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll('.screen.is-active .wxd-stats')]
      .filter((e) => getComputedStyle(e).display !== 'none')
      .flatMap((line) =>
        [...line.children].filter((c) => c.getBoundingClientRect().bottom > line.getBoundingClientRect().bottom + 1).map((c) => c.textContent),
      ),
  );
  expect(cut).toEqual([]);
});

test('tap a day for its hours; tap again, or wait a minute, for the next 24 h', async ({ page }) => {
  await openDashboard(page, { screen: 'info' });
  const weather = page.locator('.screen.is-active .b-weather');
  const caption = weather.locator('.chart-cap b');
  await expect(caption).toHaveText('Next 24 hours');
  await weather.locator('.fc-day').nth(2).click();
  await expect(caption).toHaveText('Friday');
  await expect(weather.locator('.fc-day').nth(2)).toHaveAttribute('aria-pressed', 'true');
  await weather.locator('.fc-day').nth(2).click();
  await expect(caption).toHaveText('Next 24 hours');
  await weather.locator('.fc-day').nth(1).click();
  await expect(caption).toHaveText('Thursday');
  await page.clock.runFor(61000);
  await expect(caption).toHaveText('Next 24 hours');
});

test('Home clock shows the same weather component; Family and Frame their compact versions', async ({ page }) => {
  await openDashboard(page, { screen: 'hub' });
  await expect(page.locator('.screen.is-active .b-clock .wx-temp')).toHaveText('11°');
  await expect(page.locator('.screen.is-active .b-clock .fc-day')).toHaveCount(5);
  await page.getByRole('tab', { name: 'Family' }).click();
  await page.clock.runFor(1500);
  await expect(page.locator('.screen.is-active .b-clock .wx-mini b')).toHaveText('11°');
  await page.getByRole('tab', { name: 'Frame' }).click();
  await page.clock.runFor(1500);
  await expect(page.locator('.screen.is-active .b-clock .ov-fc > div')).toHaveCount(4);
});
