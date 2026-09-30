/**
 * Sports — live scores and fixtures from ESPN's public scoreboards (no key).
 */
OMD.defineWidget({
  id: 'sports',
  name: 'Sports',
  icon: 'trophy',
  group: 'Fitness & markets',
  settings: [
    [
      'SPORTS',
      'Sports leagues (ESPN scores widget)',
      'textarea',
      { help: 'e.g. <code>soccer/ger.1</code>, <code>soccer/eng.1</code>, <code>football/nfl</code>, <code>basketball/nba</code>' },
    ],
    ['SPORTS_TEAMS', 'Only these teams (abbreviations, optional)', 'textarea'],
  ],
  defaults: {
    SPORTS: ['soccer/eng.1', 'basketball/nba'], // ESPN leagues: soccer/esp.1, football/nfl, hockey/nhl, baseball/mlb…
    SPORTS_TEAMS: [], // Optional filter by team abbreviation, e.g. ["ARS", "LAL"]
  },

  mount(ctx) {
    const { h, icon, fmt, settings: s } = ctx;
    const p = ctx.panel({ title: 'Scores', tint: 'sky' });
    const list = h('div', { class: 'scroll-y' });
    p.body.append(list);
    const feed = ctx.sharedFeed(
      'scores',
      () => async () => {
        const teams = new Set(
          s.SPORTS_TEAMS.join(',')
            .split(',')
            .map((x) => x.trim().toUpperCase())
            .filter(Boolean),
        );
        const res = await Promise.allSettled(s.SPORTS.map((lg) => ctx.fetchJSON(`https://site.api.espn.com/apis/site/v2/sports/${lg.trim()}/scoreboard`)));
        return res
          .filter((r) => r.status === 'fulfilled')
          .map((r) => {
            const d = r.value;
            const games = (d.events || [])
              .map((e) => {
                const c = e.competitions?.[0] || {};
                const side = (x) => {
                  const t = c.competitors?.find((y) => y.homeAway === x) || {};
                  return { abbr: t.team?.abbreviation || '?', name: t.team?.shortDisplayName || t.team?.displayName || '', logo: t.team?.logo, score: t.score };
                };
                return {
                  home: side('home'),
                  away: side('away'),
                  state: e.status?.type?.state,
                  detail: e.status?.type?.shortDetail || '',
                  date: new Date(e.date),
                };
              })
              .filter((g) => !teams.size || teams.has(g.home.abbr) || teams.has(g.away.abbr));
            const rank = { in: 0, pre: 1, post: 2 };
            games.sort((a, b) => (rank[a.state] ?? 3) - (rank[b.state] ?? 3) || (a.state === 'post' ? b.date - a.date : a.date - b.date));
            return { league: d.leagues?.[0]?.abbreviation || d.leagues?.[0]?.name || '', games };
          });
      },
      2 * 60000,
      { visibleOnly: true },
    );

    ctx.subscribe(feed, (leagues, err) => {
      if (!leagues) {
        if (err) list.replaceChildren(h('div', { class: 'empty' }, icon('alert'), 'Scores unavailable'));
        return;
      }
      const blocks = leagues
        .filter((l) => l.games.length)
        .map((l) =>
          h(
            'div',
            null,
            h('div', { class: 'league' }, l.league),
            l.games.slice(0, 6).map((g) => {
              const team = (t, cls) =>
                h('div', { class: `team ${cls}` }, t.logo ? h('img', { src: t.logo, alt: '', loading: 'lazy' }) : null, h('span', null, t.abbr));
              const sameDay = ctx.util.ymd(g.date) === ctx.util.ymd(new Date());
              const mid =
                g.state === 'pre'
                  ? h('div', { class: 'score' }, fmt.time.format(g.date), h('small', null, sameDay ? 'Today' : fmt.dateShort.format(g.date)))
                  : h(
                      'div',
                      { class: `score${g.state === 'in' ? ' is-live' : ''}` },
                      `${g.home.score ?? 0} – ${g.away.score ?? 0}`,
                      h('small', null, g.detail),
                    );
              return h('div', { class: 'game', title: `${g.home.name} v ${g.away.name}` }, team(g.home, 'home'), mid, team(g.away, 'away'));
            }),
          ),
        );
      list.replaceChildren(...(blocks.length ? blocks : [h('div', { class: 'empty' }, icon('trophy'), 'No games scheduled')]));
      p.setMeta(
        leagues
          .map((l) => l.league)
          .filter(Boolean)
          .join(' · '),
      );
    });
    p.onReload = () => feed.refresh();
  },
});
