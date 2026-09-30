/**
 * Public transport — any departure board / journey planner web app that allows iframe
 * embedding (seamless, edge to edge). Without one: a demo departure board.
 */
OMD.defineWidget({
  id: 'transport',
  name: 'Public transport',
  icon: 'train',
  group: 'Getting around',
  settings: [
    ['TRANSPORT_URL', 'Transport web app URL', 'url', { placeholder: 'https://…', help: 'Must allow iframe embedding.' }],
    ['TRANSPORT_TITLE', 'Panel title', 'text'],
    [
      ['TRANSPORT_ZOOM', 'Zoom (1 = 100%)', 'number', { step: 0.05, min: 0.25, max: 3 }],
      ['TRANSPORT_REFRESH_MIN', 'Refresh (min, 0 = off)', 'number', { step: 1, min: 0 }],
    ],
  ],
  defaults: {
    TRANSPORT_URL: 'https://oh-my-bussy.vercel.app/',
    TRANSPORT_TITLE: 'Transit',
    TRANSPORT_ZOOM: 1, // 1 = 100 %. 0.8 fits more content, 1.2 enlarges.
    TRANSPORT_REFRESH_MIN: 0, // 0 = let the web app refresh itself (recommended). N = forced seamless reload every N min.
  },

  mount(ctx) {
    const { h, icon, settings: s, util, fmt } = ctx;
    if (s.TRANSPORT_URL) {
      // Seamless: no panel chrome — the transit app fills the slot on the same #050505 black.
      const p = ctx.panel({ title: s.TRANSPORT_TITLE, head: false });
      p.el.classList.add('is-seamless');
      const frame = ctx.ui.frame(p.body, {
        url: s.TRANSPORT_URL,
        title: 'Public transport',
        zoom: s.TRANSPORT_ZOOM,
        refreshMin: s.TRANSPORT_REFRESH_MIN,
        allow: 'geolocation; fullscreen',
        skeletonKind: 'list',
      });
      p.onReload = frame.reload;
      return;
    }
    // Demo departure board — deterministic schedule so it looks alive.
    const p = ctx.panel({ title: s.TRANSPORT_TITLE, icon: 'train', tint: 'emerald' });
    p.setMeta(ctx.ui.demoMeta('Set TRANSPORT_URL'));
    const LINES = [
      { line: 'S1', c: '#34d399', dest: 'Airport Terminal 2', every: 10, off: 3, plat: '3', ic: 'train' },
      { line: 'U4', c: '#60a5fa', dest: 'Harbour Front', every: 6, off: 1, plat: '1', ic: 'train' },
      { line: '42', c: '#fbbf24', dest: 'Old Town via Market Sq.', every: 8, off: 5, plat: 'B', ic: 'bus' },
      { line: 'RE7', c: '#fb7185', dest: 'Northgate', every: 30, off: 12, plat: '5', ic: 'train' },
      { line: 'S3', c: '#c4b5fd', dest: 'University Campus', every: 15, off: 7, plat: '2', ic: 'train' },
      { line: '118', c: '#5eead4', dest: 'Riverside Park', every: 12, off: 9, plat: 'D', ic: 'bus' },
    ];
    const list = h('ul', { class: 'departures', 'aria-live': 'polite' });
    const clock = h('div', { class: 'board-clock' });
    p.body.append(
      h(
        'div',
        { class: 'board' },
        h(
          'div',
          { class: 'board-head' },
          h('div', null, h('div', { class: 'board-station' }, 'Central Station'), h('div', { class: 'board-sub' }, 'Departures · all platforms')),
          clock,
        ),
        list,
        h('button', { class: 'cta', type: 'button', onclick: () => ctx.openSettings('TRANSPORT_URL') }, icon('link'), 'Paste your transport web app URL'),
      ),
    );

    function render() {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
      clock.textContent = fmt.time.format(now);
      const deps = [];
      for (const L of LINES) {
        for (let t = Math.ceil((nowMin - L.off - 1) / L.every) * L.every + L.off; t < nowMin + 75; t += L.every) {
          const r = util.hash(`${L.line}${t}${now.toDateString()}`) % 100;
          const delay = r < 18 ? 1 + (r % 5) : 0;
          const eta = t + delay - nowMin;
          if (eta > -0.5) deps.push({ ...L, t, delay, eta });
        }
      }
      deps.sort((a, b) => a.eta - b.eta);
      list.replaceChildren(
        ...deps.slice(0, 14).map((d) => {
          const when = new Date(util.startOfDay(now).getTime() + d.t * 60000);
          const mins = Math.floor(d.eta);
          return h(
            'li',
            { class: 'dep' },
            h('span', { class: 'line-badge', style: { '--c': d.c } }, icon(d.ic), d.line),
            h(
              'div',
              { style: { minWidth: '0' } },
              h('div', { class: 'dep-dest' }, d.dest),
              h(
                'div',
                { class: 'dep-info' },
                `${fmt.time.format(when)} · Platform ${d.plat} · `,
                d.delay ? h('span', { class: 'late' }, `+${d.delay} min`) : h('span', { class: 'ontime' }, 'On time'),
              ),
            ),
            h('div', { class: `dep-eta${mins < 1 ? ' is-now' : ''}` }, h('b', null, mins < 1 ? 'Now' : mins), mins < 1 ? null : h('small', null, 'min')),
          );
        }),
      );
      // Drop rows that would be clipped so the board never shows half a departure.
      const max = list.clientHeight;
      if (max > 0)
        [...list.children].forEach((li, i) => {
          if (i > 0 && li.offsetTop + li.offsetHeight > max + 1) li.remove();
        });
    }
    render();
    ctx.setInterval(render, 15000);
    let lastH = 0;
    ctx.observeResize(list, () => {
      if (list.clientHeight !== lastH) {
        lastH = list.clientHeight;
        ctx.raf(render);
      }
    });
    p.onReload = render;
  },
});
