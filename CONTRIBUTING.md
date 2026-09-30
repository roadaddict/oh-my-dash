# Contributing to FLORA-HOME

Thanks for helping! Most contributions are a new widget or a new backend integration, and both
live in a folder or file of their own: you shouldn't need to touch anything else.

## Getting started

```bash
npm install
npm run build:watch                     # app/ → public/index.html on every change
npx wrangler dev --var OPEN_API:true    # http://localhost:8787 with a local D1 (second terminal)
```
Without the Worker you can also just open `public/index.html` (local mode: demo data, stored in the browser).

Before you open a pull request:
```bash
npm run check    # build · oxlint · oxfmt · unit tests · browser tests — the same as CI
```
Commit `public/index.html` together with your change (it's generated, and it's what Cloudflare deploys; CI checks
that it matches `app/`). `npm run format` formats everything with oxfmt.

## How it's put together

```
app/
├── index.html            page skeleton
├── config.js             the owner's own defaults and screens (OMD.configure)
├── core/
│   ├── runtime.js        window.OMD: defineWidget, icons, util — runs before any widget
│   ├── icons.js          the built-in icons
│   ├── boot/*.js         the dashboard: registry, sync, settings, screens, layout editor, widget host…
│   └── styles/*.css      core styles and shared components (tiles, rows, check marks, weather…)
└── widgets/<name>/       widget.js (+ widget.css) — one folder per widget
lib/
├── api.js                /api routes (state, proxy, lists, and /api/<integration>/…)
├── integration-kit.js    the only module an integration may import
├── integration-host.js   gives each integration its own env and storage
└── integrations/*.js     one file per backend integration, registered automatically
```

`npm run build` (`scripts/build.mjs`, no dependencies) turns this into a single `public/index.html`:
each widget folder becomes its own `<script>` and `<style>`, so a widget whose code a tablet's browser can't
even parse only takes itself down. The build checks that everything parses and records which lines of the
page belong to which widget. It also writes `lib/integrations/index.js`.

## Writing a widget

Copy `app/widgets/example/` (it's hidden from the picker — open the dashboard with `?dev=1` to add it) or start from:

```js
// app/widgets/tides/widget.js
OMD.defineWidget({
  id: 'tides',                 // = folder name, CSS scope (.b-tides), layout type ({ type: 'tides' })
  name: 'Tides',               // picker and settings section
  icon: 'droplet',             // a built-in icon, or your own via OMD.icons({ … })
  group: 'Home & web',         // picker group (new names are added at the end)
  settings: [
    ['TIDES_STATION', 'Station', 'text', { placeholder: 'e.g. 7112', help: 'From <b>tides.example</b>.' }],
    [['TIDES_DAYS', 'Days', 'number', { min: 1 }], ['TIDES_METRES', 'Metres', 'checkbox']],   // one row
  ],
  defaults: { TIDES_STATION: '', TIDES_DAYS: 2, TIDES_METRES: true },

  mount(ctx) {
    const { h, icon, settings: s } = ctx;
    const p = ctx.panel({ tint: 'sky' });
    const feed = ctx.feed(() => ctx.fetchJSON(`https://tides.example/api/${s.TIDES_STATION}`), 30 * 60000, { visibleOnly: true });
    ctx.subscribe(feed, (data, err) => {
      if (err) { p.body.replaceChildren(h('div', { class: 'empty' }, icon('alert'), 'Tides unavailable')); return; }
      if (data) p.body.replaceChildren(h('div', { class: 'next' }, `High water ${data.next}`));
    });
    p.onReload = () => feed.refresh();
  },
});
```
```css
/* app/widgets/tides/widget.css — every selector goes through .b-tides */
.b-tides .next { font-size: 20px; color: var(--tint); }
```
Then put it on a screen in the ▦ layout editor (Change / Add), or in a layout in `app/config.js`.

### The definition

| Field | |
|---|---|
| `id` | lower-case, digits, `-`. The folder name, the panel class `.b-<id>`, the `type` in layouts. |
| `name`, `icon`, `group` | Shown in the picker and as the settings section. |
| `settings` | Fields of the widget's section in ⚙: `[KEY, label, type, options]`; a nested list is a row. Types: `text` `url` `number` `password` `time` `textarea` (one entry per line → a list) `checkbox` `select` (`options: [[value, label], …]`), or your own (`fields`). Options: `help` (HTML), `placeholder`, `min`/`max`/`step`. |
| `defaults` | Every setting the widget owns, `UPPER_CASE`, prefixed with the widget's name for new widgets. Two widgets can't define the same one. |
| `reads` | Settings of another widget this one also reads (the ticker reads News's feeds). |
| `state` | Legacy shared-state keys it owns (`lists`, `chores`, …). New widgets use `ctx.state(name)` without declaring anything. |
| `integrations` | Backend integrations it calls (`ctx.api`, `ctx.status`), e.g. `['strava']`. |
| `fields` | Custom settings field types: `{ mytype(kit) { … return element } }`; the element must contain a form control named `kit.key` (see the Commute editor). `kit`: `key label value help opts settings`, `h icon fmt util fetchJSON fetchText`, `local(name, fallback)`, `setTimeout / clearTimeout` (they live as long as the drawer is open). |
| `variants` | Labels for `variant` / `view` options in the picker, e.g. `{ compact: 'compact' }`. |
| `hidden` | Left out of the picker and settings unless the page has `?dev=1`. |
| `mount(ctx)` | Called for every place the widget appears. Call `ctx.panel()` first; may return a clean-up function. |

Settings precedence: URL params › ⚙ › `app/config.js` › `defaults`. **Never** make an API key a setting: settings are
readable by every screen. Keys belong in a backend integration (below).

### `ctx`

**Panel and DOM**

| | |
|---|---|
| `ctx.panel({ title, icon, tint, meta, actions, head, bare, dark, compact })` | The glass panel: `{ el, body, setMeta(…), setTitle(t), addAction(icon, label, fn), reloadable(fn), setRecording(on, btn), onReload, onResize }`. `tint`: `accent emerald amber crimson violet cyan sky spotify strava`. `actions` default `['retry', 'expand']`: ↻ shows while a feed fails. |
| `ctx.h(tag, attrs, …children)` | Builds elements. `on…` attributes (`onclick`, `oninput`, …) run inside the widget's error boundary. |
| `ctx.icon(name)`, `ctx.svg(markup)` | An icon element; an SVG element from markup. |
| `ctx.spec` | This slot's layout options, e.g. `{ type: 'calendar', view: 'month', dark: true }`. |
| `ctx.ui.frame(host, { url, title, zoom, refreshMin, allow, invert })` | An iframe with skeleton, slow-load hint and seamless reloads. |
| `ctx.ui.dialog({ title, sub, content, className })` | A sheet over the page (like the picker); returns `close()`. |
| `ctx.ui.skeleton(kind)`, `ctx.ui.demoMeta(hint)`, `ctx.ui.analogClock({ tz, seconds })`, `ctx.ui.slideshow(host)`, `ctx.ui.weather(host)` | Shared components. |

**Time and events** — all cleared when the widget is removed, all inside its error boundary

| | |
|---|---|
| `ctx.setTimeout / setInterval / clearTimeout / clearInterval / raf` | As the browser's. |
| `ctx.onTick(fn)` | `fn(now)` on the shared once-a-second tick (and right away). |
| `ctx.listen(target, type, fn, options)` | `addEventListener` that goes away with the widget. |
| `ctx.observeResize(el, fn)` | A `ResizeObserver`. |
| `ctx.onCleanup(fn)`, `ctx.guard(fn)`, `ctx.fail(error)` | Extra clean-up; wrap any other callback (e.g. a `.then`) in the error boundary; give up on purpose. |

**Data**

| | |
|---|---|
| `ctx.settings` | Read-only: the widget's own settings, its `reads`, and `LOCATION_NAME LATITUDE LONGITUDE TEMP_UNIT LOCALE HOUR_12 WEEK_START HOLIDAY_COUNTRY`. |
| `ctx.feed(loader, intervalMs, { visibleOnly })` | A polling data source. Polls only while subscribed (and, with `visibleOnly`, only while on screen), retries after a minute on errors. |
| `ctx.sharedFeed(key, () => loader, intervalMs, options)` | One feed for every instance (and every widget of the same folder) asking for `key`. |
| `ctx.subscribe(feed, (data, error) => …)` | Now if there's data, then on every update. Unsubscribed with the widget. |
| `ctx.fetchJSON(url, init)`, `ctx.fetchText(url, { proxyFirst })`, `ctx.withProxy(url, ttl)`, `ctx.hasProxy` | Fetch with the dashboard's CORS proxy as fallback; counted by ⚙ → Data usage. |
| `ctx.state(name, fallback)` | Family data synced through D1 (key `w-<id>-<name>`; this browser in local mode): `get()`, `update(fn)` (fn gets the latest value and returns the next one; it may run again on top of someone else's edit, so make it idempotent), `onChange(fn)`. |
| `ctx.local(name, fallback)` | This device only (localStorage): `get()`, `set(value)`. |
| `ctx.api(path, init)`, `ctx.apiUrl(path)`, `ctx.status(name)` | Your backend integration: `ctx.api('tides/next')` → `/api/tides/next`. |
| `ctx.weather.feed`, `ctx.holidays()` | Data the dashboard already has. |
| `ctx.fmt`, `ctx.util` (also `OMD.util` outside `mount`), `ctx.imperial`, `ctx.locale`, `ctx.cloud`, `ctx.phoneView` | Formatters (`fmt.time.format(date)`, `fmt.timeAgo(date)`, `fmt.temp(celsius)`, …) and helpers (`ymd`, `addDays`, `pipe`, `hash`, `PALETTE`, …). |
| `ctx.isVisible()`, `ctx.openSettings(key)`, `ctx.toast(message)` | |

### What the dashboard does for you

- **Error boundary.** An exception in `mount` or in anything scheduled through `ctx` replaces the widget with
  *"This widget failed — Retry"*, in the same place. Errors that slip past (a listener added without `ctx`, a stray
  promise) are traced to the widget by the line numbers the build recorded, with the same result.
- **Watchdog.** A widget that keeps the main thread busy (over 2.5 s of every 5 s, or thousands of callbacks a
  second) is stopped the same way. (A single `while (true) {}` can't be interrupted by anything in a web page; this
  catches the render loop that runs away.)
- **Clean-up.** Removing or changing a widget in the editor, a layout variant that leaves it out, or a failure:
  every timer, listener, observer, subscription and frame it made through `ctx` is gone, and your clean-up runs.
- **Style scope.** Widget CSS can only style the widget (checked by the linter, below).

### Rules (checked by `npm run lint`)

- No `setTimeout`, `setInterval`, `requestAnimationFrame`, `ResizeObserver`, `addEventListener`, `fetch`,
  `localStorage` directly in a widget: use the `ctx` versions above.
- No `OMD._internal`, no `document.body` / `head` / `cookie`: a widget touches its own panel (and `ctx.ui.dialog`).
- Every selector in `widget.css` goes through `.b-<id>`; `@keyframes` are named `<id>-…`. Shared pieces you can use:
  `.empty` `.scroll-y` `.cta` `.muted` `.badge` `.legend` `.rows` `.tiles`/`.tile` `.check` `.up`/`.down`/`.late`/`.ontime`
  and the colour classes `.c-amber` … (`app/core/styles/50-components.css`). Phone layout rules go inside
  `@media (max-width: 599px), (orientation: landscape) and (max-height: 480px)`.
- `app/core/boot/*.js` are linted as the one function they're built into, so `no-undef` catches a missing helper.

**About security:** widgets run in the page, not in a sandbox — the boundaries above are about keeping widgets
from breaking each other, not about untrusted code. Review a widget like any other code. What makes it safe to add
widgets is that there is nothing secret in the page: API keys live on the Worker.

## Writing a backend integration

A service that needs an API key or OAuth gets a file in `lib/integrations/` (run `npm run build` once to register it):

```js
// lib/integrations/tides.js — served at /api/tides/<path>, behind the dashboard's sign-in
import { defineIntegration, json, fail } from '../integration-kit.js';

export default defineIntegration({
  id: 'tides',
  env: ['TIDES_KEY'],                 // the ONLY Worker variables it can see: npx wrangler secret put TIDES_KEY
  async handle(request, ctx, path) {
    if (path === 'status') return json({ configured: !!ctx.env.TIDES_KEY });
    if (path === 'next') {
      const r = await fetch(`https://tides.example/v1/next?key=${ctx.env.TIDES_KEY}`);
      if (!r.ok) throw fail(`Tides HTTP ${r.status}`);
      return json(await r.json());
    }
    return json({ error: 'not found' }, 404);
  },
});
```

`ctx.env` has only the declared variables (no D1 binding, no other secrets). `ctx.secrets.get(name)` /
`put(name, value)` / `delete(name)` store tokens in the integration's own rows of the private D1 table (`''` is its
main record); `ctx.oauth.newState()` / `checkState(state)` handle the OAuth `state`. An integration imports only
`../integration-kit.js` (lint-checked). The widget side declares `integrations: ['tides']` and calls `ctx.api('tides/next')`.
Existing examples: `todoist.js` (a token), `strava.js` (OAuth, several accounts), `aqara.js` (signed requests).

## Tests

| | |
|---|---|
| `npm test` | Unit tests of the Worker (`test/unit/`, Node's built-in runner, D1 simulated with Node's SQLite). |
| `npm run test:e2e` | Browser tests (`test/e2e/`, Playwright): every screen at every tablet shape, weather sizes, lists, ticker, settings, editor, error isolation and clean-up. Every outside service is mocked (`test/support/mock-network.js`) and the clock is fixed, so they run offline and deterministically. They use a test build with extra widgets that fail on purpose (`test/fixtures/`). |
| `npm run test:visual` | Before/after screenshots of every screen (not in CI: pixels depend on the machine's fonts). Run it with `-- --update-snapshots` on `main`, then without on your branch. |

A new widget should come with at least its row in `test/fixtures/config.js`'s `all` screen (every widget mounts in
both modes); anything interactive deserves a test of its own.

## Pull requests

- One widget or integration per pull request, with `public/index.html` rebuilt.
- `npm run check` passes (CI runs the same).
- Screenshots of the widget at a couple of sizes help the review.
