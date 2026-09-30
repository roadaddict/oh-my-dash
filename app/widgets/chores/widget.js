/**
 * Chores — a chore chart per person: ticks reset every day, stars count up over the week.
 * Synced like the lists (shared state "chores").
 */
OMD.defineWidget({
  id: 'chores',
  name: 'Chores',
  icon: 'star',
  group: 'Family',
  state: ['chores'],
  settings: [['CHORES', 'Chore chart', 'textarea', { help: 'One person per line: <code>Alex | #34d399 | Make bed, Feed the cat</code>' }]],
  defaults: {
    CHORES: [
      // "Person | #color | chore, chore, chore" — resets daily, stars reset weekly.
      'Alex | #34d399 | Make bed, Feed the cat, Homework, Tidy desk',
      'Sam | #fbbf24 | Brush teeth, Set the table, Walk the dog',
      'Jamie | #8b9cff | Water plants, Empty dishwasher, Read 20 min',
    ],
  },

  mount(ctx) {
    const { h, icon, svg, settings: s } = ctx;
    const { pipe, ymd, addDays, startOfDay, PALETTE } = ctx.util;
    const choreStore = ctx.state('chores', {});
    const weekStartOf = (d) => startOfDay(addDays(d, -((d.getDay() - s.WEEK_START + 7) % 7)));
    const chorePeople = s.CHORES.map((line, i) => {
      const parts = pipe(line);
      const color = parts.find((x) => /^#[0-9a-f]{6}$/i.test(x)) || PALETTE[i % PALETTE.length];
      const rest = parts.filter((x) => !/^#[0-9a-f]{6}$/i.test(x));
      return {
        name: rest[0],
        color,
        chores: (rest[1] || '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      };
    }).filter((x) => x.name);
    function choreState(st = choreStore.get()) {
      st ||= {};
      const today = ymd(new Date()),
        week = ymd(weekStartOf(new Date()));
      if (st.day !== today) {
        st.day = today;
        st.done = {};
      }
      if (st.week !== week) {
        st.week = week;
        st.stars = {};
      }
      st.done ||= {};
      st.stars ||= {};
      return st;
    }

    const p = ctx.panel({ tint: 'amber' });
    const grid = h('div', { class: 'chores' });
    p.body.append(grid);
    function render() {
      const st = choreState();
      let total = 0,
        doneAll = 0;
      grid.replaceChildren(
        ...chorePeople.map((person) => {
          const done = new Set(st.done[person.name] || []);
          const n = person.chores.length,
            k = person.chores.filter((_, i) => done.has(i)).length;
          total += n;
          doneAll += k;
          const C = 2 * Math.PI * 17;
          return h(
            'div',
            { class: 'person', style: { '--c': person.color } },
            h(
              'div',
              { class: 'person-head' },
              h(
                'div',
                { class: 'avatar' },
                svg(
                  `<svg viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" stroke="rgba(255,255,255,.1)"/><circle cx="19" cy="19" r="17" stroke="${person.color}" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${n ? C * (1 - k / n) : C}" style="transition:stroke-dashoffset .6s"/></svg>`,
                ),
                h('span', null, person.name.slice(0, 1).toUpperCase()),
              ),
              h('div', null, h('div', { class: 'person-name' }, person.name), h('div', { class: 'person-stars' }, `★ ${st.stars[person.name] || 0} this week`)),
            ),
            person.chores.map((c, i) =>
              h(
                'button',
                {
                  type: 'button',
                  class: `chore${done.has(i) ? ' is-done' : ''}`,
                  'aria-pressed': String(done.has(i)),
                  onclick: () => {
                    const want = !done.has(i); // idempotent "set", safe to re-apply after a conflict
                    choreStore.update((raw) => {
                      const x = choreState(raw);
                      const arr = new Set(x.done[person.name] || []);
                      if (arr.has(i) === want) return x;
                      if (want) {
                        arr.add(i);
                        x.stars[person.name] = (x.stars[person.name] || 0) + 1;
                      } else {
                        arr.delete(i);
                        x.stars[person.name] = Math.max(0, (x.stars[person.name] || 0) - 1);
                      }
                      x.done[person.name] = [...arr];
                      return x;
                    });
                  },
                },
                h('span', { class: 'check' }, icon('check')),
                h('span', null, c),
              ),
            ),
            n && k === n ? h('div', { class: 'all-done' }, '🎉 All done today!') : null,
          );
        }),
      );
      p.setMeta(chorePeople.length ? `${doneAll} of ${total} done today` : 'Add CHORES in settings');
      if (!chorePeople.length) grid.replaceChildren(h('div', { class: 'empty' }, icon('star'), 'No chores configured'));
    }
    choreStore.onChange(render);
    ctx.onTick((n) => {
      if (n.getHours() === 0 && n.getMinutes() === 0 && n.getSeconds() === 1) render();
    });
    p.onReload = render;
    render();
  },
});
