/**
 * Settings for the public demo (GitHub Pages), used instead of app/config.js:
 *
 *   node scripts/build.mjs --config demo/config.js --out _site/index.html
 *
 * The demo is a static page with no Worker behind it, so it always runs in local mode: sample
 * data, and whatever a visitor changes stays in their own browser. Link to it with ?local=1 so
 * the page doesn't first ask the (missing) backend for /api/state.
 */
OMD.configure({
  defaults: {
    DASHBOARD_NAME: 'FLORA-HOME demo',
    // There's no /api/ping without the Worker; the status-bar latency chip measures this instead.
    PING_URL: 'https://www.gstatic.com/generate_204',
    // Kiosk behaviour that only confuses a visitor: dimming at night, reloading at 03:30,
    // hiding the cursor, nudging the layout, holding a wake lock.
    NIGHT_MODE_START: '',
    DAILY_RELOAD_AT: '',
    HIDE_CURSOR_SEC: 0,
    BURN_IN_SHIFT: false,
    KEEP_SCREEN_AWAKE: false,
  },
});
