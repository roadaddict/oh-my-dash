/**
 * World clocks — analog faces for other time zones, with the day and the offset.
 */
OMD.defineWidget({
  id: 'worldclock',
  name: 'World clocks',
  icon: 'globe',
  group: 'Time & weather',
  settings: [['WORLD_CLOCKS', 'World clocks', 'textarea', { help: '<code>Tokyo | Asia/Tokyo</code> (IANA time zone names)' }]],
  defaults: {
    WORLD_CLOCKS: ['New York | America/New_York', 'Tokyo | Asia/Tokyo', 'Sydney | Australia/Sydney'],
  },

  mount(ctx) {
    const { h, icon, settings: s } = ctx;
    const { pipe, startOfDay } = ctx.util;
    const p = ctx.panel({ tint: 'sky', actions: ['expand'] });
    const grid = h('div', { class: 'clocks' });
    p.body.append(grid);
    const zones = s.WORLD_CLOCKS.map(pipe)
      .map(([label, tz]) => {
        try {
          new Intl.DateTimeFormat(undefined, { timeZone: tz });
          return { label, tz };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const rows = zones.map(({ label, tz }) => {
      const time = h('div', { class: 'wc-time' }),
        off = h('div', { class: 'wc-off' });
      const f = new Intl.DateTimeFormat(ctx.locale, { timeZone: tz, hour: s.HOUR_12 ? 'numeric' : '2-digit', minute: '2-digit', hour12: s.HOUR_12 });
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      });
      grid.append(
        h(
          'div',
          { class: 'wc' },
          ctx.ui.analogClock({ tz, seconds: false }),
          h('div', { style: { minWidth: '0' } }, h('div', { class: 'wc-city' }, label), time, off),
        ),
      );
      return (now) => {
        time.textContent = f.format(now);
        const p2 = Object.fromEntries(parts.formatToParts(now).map((x) => [x.type, x.value]));
        const there = new Date(+p2.year, +p2.month - 1, +p2.day, +p2.hour % 24, +p2.minute);
        const diffH = Math.round(((there - new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes())) / 36e5) * 2) / 2;
        const dayDiff = Math.round((startOfDay(there) - startOfDay(now)) / 864e5);
        off.textContent = `${dayDiff === 0 ? 'Today' : dayDiff > 0 ? 'Tomorrow' : 'Yesterday'} · ${diffH === 0 ? 'same time' : `${diffH > 0 ? '+' : ''}${diffH}h`}`;
      };
    });
    if (!zones.length) grid.replaceChildren(h('div', { class: 'empty' }, icon('globe'), 'Add WORLD_CLOCKS in settings'));
    ctx.onTick((now) => rows.forEach((fn) => fn(now)));
  },
});
