/**
 * Hello (example) — the whole widget API in one small widget. Copy this folder to start
 * your own; CONTRIBUTING.md explains each part.
 *
 * It's `hidden`, so it isn't offered in the widget picker: open the dashboard with ?dev=1,
 * then ▦ Edit layout → Change (or Add) → "Hello (example)".
 *
 * Rules of thumb (npm run lint checks them):
 *   • everything with a lifetime goes through ctx (timers, listeners, feeds, observers):
 *     it's removed when the widget is, and an exception only takes down this widget;
 *   • styles live in widget.css, every selector under .b-<id> (here .b-example);
 *   • settings are UPPER_CASE, each with a default; API keys are never settings (backend
 *     integrations keep them as Worker secrets: lib/integrations/).
 */

// Your own icons (24×24 Lucide-style strokes), next to the built-in ones.
OMD.icons({
  sparkles:
    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
});

// Code outside mount() runs once, when the page loads: constants and pure helpers only.
const { pad2 } = OMD.util;
const mmss = (s) => `${Math.floor(s / 60)}:${pad2(s % 60)}`;

OMD.defineWidget({
  id: 'example', // folder name, CSS scope (.b-example), layout type ({ type: 'example' })
  name: 'Hello (example)', // picker + settings section
  icon: 'sparkles',
  group: 'Examples', // picker group; unknown groups are added at the end
  hidden: true, // only with ?dev=1

  // ⚙ settings: [KEY, label, type, options]. A nested list is one row of fields.
  settings: [
    ['EXAMPLE_NAME', 'Whom to greet', 'text', { placeholder: 'World' }],
    [
      ['EXAMPLE_URL', 'A JSON URL to show', 'url', { help: 'Any JSON API, e.g. <code>https://api.github.com/zen</code>. Empty = off.' }],
      ['EXAMPLE_REFRESH_MIN', 'Refresh (min)', 'number', { min: 1 }],
    ],
  ],
  defaults: {
    EXAMPLE_NAME: 'World',
    EXAMPLE_URL: '',
    EXAMPLE_REFRESH_MIN: 10,
  },

  /**
   * Called for every place the widget appears on a screen. Create the panel first, then fill
   * p.body. Return a function to run extra clean-up when the widget is removed (optional).
   */
  mount(ctx) {
    const { h, icon, fmt, settings: s } = ctx; // h: DOM builder; on… handlers are guarded
    const p = ctx.panel({ tint: 'violet', meta: 'An example widget' });

    const time = h('b'),
      temp = h('span', null, '…'),
      count = h('span', { class: 'count' }),
      fact = h('p', { class: 'fact' });
    // Synced family data: D1 in cloud mode (key "w-example-taps"), this browser otherwise.
    const taps = ctx.state('taps', 0);
    // This device only (localStorage, "omd.w.example.opened").
    const opened = ctx.local('opened', 0);
    opened.set(opened.get() + 1);

    p.body.append(
      h(
        'div',
        { class: 'hello' },
        h('h3', null, `Hello, ${s.EXAMPLE_NAME || 'World'}!`),
        h('p', null, 'It’s ', time, ' in ', s.LOCATION_NAME, ', ', temp, ' outside.'),
        h('div', { class: 'row' }, h('button', { class: 'cta', type: 'button', onclick: () => taps.update((n) => (n || 0) + 1) }, icon('plus'), 'Tap'), count),
        fact,
        h('small', { class: 'muted' }, `Shown ${opened.get()} time${opened.get() === 1 ? '' : 's'} on this device`),
      ),
    );

    const showTaps = () => {
      count.textContent = `${taps.get()} taps, on every screen`;
    };
    taps.onChange(showTaps); // someone tapped on another screen
    showTaps();

    // The shared once-a-second tick (also called right away).
    let up = 0;
    ctx.onTick((now) => {
      time.textContent = fmt.time.format(now);
      p.setMeta(`Up ${mmss(up++)}`);
    });

    // Data the dashboard already has: the weather feed.
    ctx.subscribe(ctx.weather.feed, (d) => {
      if (d) temp.textContent = fmt.temp(d.current.temperature_2m);
    });

    // Your own polling feed: runs only while the widget is on screen, and the panel's ↻ button
    // shows while it fails. ctx.fetchJSON falls back to the dashboard's proxy for CORS-less APIs.
    if (s.EXAMPLE_URL) {
      const feed = ctx.feed(() => ctx.fetchJSON(s.EXAMPLE_URL), s.EXAMPLE_REFRESH_MIN * 60000, { visibleOnly: true });
      ctx.subscribe(feed, (data, err) => {
        fact.textContent = err ? `⚠ ${err.message}` : JSON.stringify(data).slice(0, 140);
      });
      p.onReload = () => feed.refresh();
    }

    return () => console.info('Hello (example): removed — its tick, feed and listeners are already gone');
  },
});
