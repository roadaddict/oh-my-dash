/**
 * Countdowns — days until the dates you list; with none, the weekend, the next public
 * holiday and New Year.
 */
OMD.defineWidget({
  id: 'countdown',
  name: 'Countdowns',
  icon: 'hourglass',
  group: 'Time & weather',
  settings: [['COUNTDOWNS', 'Countdowns', 'textarea', { help: '<code>Summer holiday | 2027-07-24</code>. Empty = weekend, next holiday & New Year.' }]],
  defaults: {
    COUNTDOWNS: [], // "Summer holiday | 2027-07-24". Empty → next holiday, weekend & New Year.
  },

  mount(ctx) {
    const { h, fmt, settings: s } = ctx;
    const { pipe, parseYMD, addDays, startOfDay } = ctx.util;
    const compact = !!ctx.spec.compact;
    const p = ctx.panel({ title: 'Countdown', tint: 'cyan', head: !compact, compact });
    const list = h('div', { class: `countdowns${compact ? ' is-row' : ' scroll-y'}` });
    p.body.append(list);
    let holidays = [];
    function items() {
      const today = startOfDay(new Date());
      const out = s.COUNTDOWNS.map(pipe)
        .map(([label, date]) => ({ label, date: parseYMD(date) }))
        .filter((x) => x.label && x.date);
      if (!out.length) {
        const dow = today.getDay();
        if (dow >= 1 && dow <= 5) out.push({ label: 'The weekend', date: addDays(today, 6 - dow) });
        const hol = holidays.filter((e) => e.start >= today).sort((a, b) => a.start - b.start)[0];
        if (hol) out.push({ label: hol.title, date: hol.start });
        out.push({ label: 'New Year', date: new Date(today.getFullYear() + 1, 0, 1) });
      }
      return out.filter((x) => x.date >= today).sort((a, b) => a.date - b.date);
    }
    function render() {
      const today = startOfDay(new Date());
      list.replaceChildren(
        ...items()
          .slice(0, compact ? 2 : 8)
          .map((x) => {
            const days = Math.round((x.date - today) / 864e5);
            return h(
              'div',
              { class: 'cd' },
              h('div', { class: 'cd-num' }, days === 0 ? '🎉' : days, h('small', null, days === 0 ? 'today' : days === 1 ? 'day' : 'days')),
              h('div', { class: 'cd-label' }, h('b', null, x.label), h('span', null, fmt.dateShort.format(x.date))),
            );
          }),
      );
    }
    if (!s.COUNTDOWNS.length)
      ctx.holidays().then(
        ctx.guard((list2) => {
          holidays = list2;
          render();
        }),
        () => {
          /* holidays are optional */
        },
      );
    ctx.onTick((n) => {
      if (n.getHours() === 0 && n.getMinutes() === 0 && n.getSeconds() === 2) render();
    });
    render();
  },
});
