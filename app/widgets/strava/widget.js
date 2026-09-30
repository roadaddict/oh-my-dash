/**
 * Strava — family activity: one card per person with this week's km (per day), the trend
 * against last week, 4 weeks, the year and the latest activity. The backend integration
 * (lib/integrations/strava.js) does the OAuth and keeps the tokens.
 */
const SPORT_ICON = { Run: 'footprints', Walk: 'footprints', Ride: 'bike', Swim: 'droplet', Other: 'activity' };
const SPORT_NAME = { Run: 'Run', Walk: 'Walk', Ride: 'Ride', Swim: 'Swim', Other: 'Other' };
const { pad2, ymd, parseYMD, addDays } = OMD.util;

OMD.defineWidget({
  id: 'strava',
  name: 'Strava',
  icon: 'activity',
  group: 'Fitness & markets',
  integrations: ['strava'],
  settings: [
    [
      'STRAVA_SPORTS',
      'Strava: sports to count',
      'text',
      { placeholder: 'All · or e.g. Run, Ride', help: 'Run · Ride · Walk · Swim · Other. Connect accounts under <b>Accounts</b>.' },
    ],
  ],
  defaults: {
    STRAVA_SPORTS: '', // "" = all sports, or e.g. "Run, Ride" (Run · Ride · Walk · Swim · Other)
  },

  mount(ctx) {
    const { h, icon, fmt, settings: s } = ctx;
    const stravaFeed = ctx.sharedFeed(
      'stats',
      () => () =>
        ctx.api(`strava/stats?today=${ymd(new Date())}&weekStart=${s.WEEK_START}&sports=${encodeURIComponent(String(s.STRAVA_SPORTS || ''))}`, {
          timeout: 20000,
        }),
      15 * 60000,
      { visibleOnly: true },
    );
    const DIST_UNIT = ctx.imperial ? 'mi' : 'km';
    const dist = (km) => {
      const v = ctx.imperial ? km * 0.621371 : km;
      return v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '');
    };
    const fmtDur = (s) => {
      const m = Math.round(s / 60);
      return m >= 60 ? `${Math.floor(m / 60)} h ${pad2(m % 60)}` : `${m} min`;
    };
    /** "▲ 4.1 km vs last week" — compared with last week up to the same weekday. */
    function stravaDelta(a) {
      if (!a.lastWeek) return null;
      const d = a.week.km - a.lastWeek.toDate;
      if (Math.abs(d) < 0.05) return h('span', { class: 'st-delta' }, `= last week`);
      return h(
        'span',
        {
          class: `st-delta ${d > 0 ? 'is-up' : 'is-down'}`,
          title: `Last week by this day: ${dist(a.lastWeek.toDate)} ${DIST_UNIT} (whole week ${dist(a.lastWeek.km)})`,
        },
        `${d > 0 ? '▲' : '▼'} ${dist(Math.abs(d))}`,
        h('span', { class: 'st-vs' }, ' vs last week'),
      );
    }
    function stravaCard(a) {
      const initial = h('span', { class: 'st-avatar' }, (a.name || '?')[0]);
      const avatar = a.avatar ? h('img', { class: 'st-avatar', src: a.avatar, alt: '', onerror: (e) => e.target.replaceWith(initial) }) : initial;
      if (a.error || !a.week)
        return h(
          'div',
          { class: 'st-card' },
          h('div', { class: 'st-head' }, avatar, h('b', null, a.name)),
          h('div', { class: 'empty' }, icon('alert'), a.error || 'No data'),
        );
      const today = Math.round((parseYMD(ymd(new Date())) - parseYMD(a.week.start)) / 864e5);
      const max = Math.max(1, ...a.week.days);
      const w0 = parseYMD(a.week.start);
      return h(
        'div',
        { class: 'st-card' },
        h(
          'div',
          { class: 'st-head' },
          avatar,
          h(
            'div',
            { class: 'st-who' },
            h('b', null, a.name),
            h(
              'span',
              null,
              a.week.count ? `${a.week.count} ${a.week.count === 1 ? 'activity' : 'activities'} · ${fmtDur(a.week.time)}` : 'No activity yet this week',
            ),
          ),
        ),
        h('div', { class: 'st-big' }, h('b', null, dist(a.week.km)), h('small', null, DIST_UNIT, h('span', { class: 'st-wk' }, ' this week')), stravaDelta(a)),
        h(
          'div',
          { class: 'st-bars', 'aria-hidden': 'true' },
          a.week.days.map((km, i) =>
            h(
              'div',
              { class: `st-bar${i === today ? ' is-today' : ''}${i > today ? ' is-future' : ''}`, title: `${dist(km)} ${DIST_UNIT}` },
              h('i', { style: { height: km ? `${Math.max(8, (km / max) * 100)}%` : '3px' } }),
              h('span', null, fmt.weekdayShort.format(addDays(w0, i)).slice(0, 2)),
            ),
          ),
        ),
        h(
          'div',
          { class: 'st-sports' },
          Object.entries(a.week.bySport)
            .filter(([, km]) => km > 0)
            .slice(0, 3)
            .map(([g, km]) => h('span', { title: SPORT_NAME[g] || g }, icon(SPORT_ICON[g] || 'activity'), `${dist(km)}`)),
        ),
        h(
          'div',
          { class: 'st-foot' },
          h('span', null, h('small', null, '4 weeks '), `${dist(a.fourWeeks.km)} ${DIST_UNIT}`),
          h('span', null, h('small', null, `${a.year.year} `), `${dist(a.year.km)} ${DIST_UNIT}`),
        ),
        a.last
          ? h(
              'div',
              { class: 'st-last' },
              icon(SPORT_ICON[a.last.sport] || 'activity'),
              h(
                'span',
                null,
                `${a.last.name} · ${a.last.km ? `${dist(a.last.km)} ${DIST_UNIT}` : fmtDur(a.last.time)} · ${fmt.timeAgo(new Date(String(a.last.date).replace(/Z$/, '')))}`,
              ),
            )
          : null,
      );
    }

    const p = ctx.panel({ tint: 'strava', meta: 'This week' });
    const box = h('div', { class: 'strava' });
    p.body.classList.add('strava-host');
    p.body.append(box);
    let subscribed = false,
      recheck = 0;
    const say = (text, extra) => box.replaceChildren(h('div', { class: 'empty' }, icon('activity'), text, extra || null));
    async function check(fresh = false) {
      const st = await ctx.status('strava', fresh);
      ctx.clearTimeout(recheck);
      if (!st.athletes?.length) {
        p.setMeta('Strava');
        if (st.local) say('Strava works when the dashboard runs on its Cloudflare Worker.');
        else if (st.error) say('Can’t reach the dashboard API', h('small', null, `${st.error}. Is this device signed in?`));
        else if (!st.configured)
          say('Strava app keys are missing', h('small', null, 'Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET on the Worker, then tap ↻ — README → Strava.'));
        else say('Nobody connected yet', h('a', { class: 'cta', href: ctx.apiUrl('strava/login?app=1') }, icon('link'), 'Connect Strava'));
        // Someone may connect from another device: look again every 5 minutes.
        if (!st.local) recheck = ctx.setTimeout(() => check(true), 5 * 60000);
        return;
      }
      if (subscribed) {
        stravaFeed.refresh();
        return;
      }
      subscribed = true;
      say('Loading…');
      ctx.subscribe(stravaFeed, (d, err) => {
        if (d) {
          box.replaceChildren(...d.athletes.map(stravaCard));
          // Content-sized slots (e.g. Now Playing's) still get room for one line per person.
          p.body.style.minHeight = `${d.athletes.length * 58 + (d.athletes.length - 1) * 8}px`;
        } else if (err && !box.querySelector('.st-card')) say('Strava didn’t answer', h('small', null, err.message));
        const lead = d?.athletes?.filter((a) => a.week).sort((x, y) => y.week.km - x.week.km);
        p.setMeta(err && !d ? 'offline' : lead?.length > 1 && lead[0].week.km > 0 ? `This week · ${lead[0].name} leads` : 'This week');
      });
    }
    ctx.guard(check)();
    p.onReload = () => check(true);
  },
});
