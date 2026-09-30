/**
 * Data widgets — one tile per JSON value from any API (Home Assistant, Node-RED, …).
 * "Label | JSON URL | path.to.value | unit | Authorization header (optional)";
 * {lat} and {lon} are replaced with your location.
 */
const getPath = (obj, path) =>
  (path || '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce((o, k) => (o == null ? o : o[k]), obj);

OMD.defineWidget({
  id: 'data',
  name: 'Data widgets',
  icon: 'gauge',
  group: 'Home & web',
  settings: [
    [
      'DATA_WIDGETS',
      'Data widgets (JSON)',
      'textarea',
      { help: '<code>Label | https://api… | path.to.value | unit | Bearer token (optional)</code>. <code>{lat}</code>/<code>{lon}</code> are replaced.' },
    ],
  ],
  defaults: {
    DATA_WIDGETS: [], // Outdoor air quality + PM2.5 are built into the Smart home widget.
    DATA_REFRESH_MIN: 5,
  },

  mount(ctx) {
    const { h, icon, settings: s } = ctx;
    const p = ctx.panel({ title: 'Data', icon: 'database', tint: 'violet' });
    const grid = h('div', { class: 'tiles' });
    p.body.classList.add('tiles-host');
    p.body.append(grid);
    const COLORS = ['c-accent', 'c-emerald', 'c-amber', 'c-sky', 'c-violet', 'c-crimson'];
    grid.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
    const feed = ctx.sharedFeed(
      'values',
      () => () =>
        Promise.all(
          s.DATA_WIDGETS.map(async (line) => {
            const [label, urlT, path, unit = '', auth] = ctx.util.pipe(line);
            const url = (urlT || '').replace(/\{lat\}/g, s.LATITUDE).replace(/\{lon\}/g, s.LONGITUDE);
            const opts = auth ? { headers: { Authorization: auth } } : {};
            try {
              let j;
              try {
                j = await ctx.fetchJSON(url, opts);
              } catch (e) {
                if (!ctx.hasProxy || auth) throw e;
                j = await ctx.fetchJSON(ctx.withProxy(url));
              }
              return { label, value: getPath(j, path), unit };
            } catch (e) {
              return { label, error: e.message, unit };
            }
          }),
        ),
      s.DATA_REFRESH_MIN * 60000,
      { visibleOnly: true },
    );

    ctx.subscribe(feed, (items) => {
      if (!items) return;
      if (!items.length) {
        grid.replaceChildren(h('div', { class: 'empty' }, icon('database'), 'Add DATA_WIDGETS in settings'));
        return;
      }
      grid.replaceChildren(
        ...items.map((it, i) => {
          const v = typeof it.value === 'number' ? (Math.abs(it.value) >= 100 ? Math.round(it.value) : Math.round(it.value * 10) / 10) : it.value;
          return h(
            'div',
            { class: `tile ${COLORS[i % COLORS.length]}`, title: it.error || '' },
            h('span', { class: 'tile-icon' }, icon(it.error ? 'alert' : 'database')),
            h(
              'span',
              { class: 'tile-text' },
              h('div', { class: 'tile-label' }, it.label),
              h('div', { class: 'tile-value' }, it.error ? 'Error' : (v ?? '—'), !it.error && it.unit ? h('small', null, it.unit) : null),
            ),
          );
        }),
      );
      p.setMeta(`Every ${s.DATA_REFRESH_MIN} min`);
    });
    p.onReload = () => feed.refresh();
  },
});
