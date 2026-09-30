/**
 * Markets — crypto from CoinGecko (no key) and stocks through the backend's Finnhub
 * integration (Worker secret FINNHUB_TOKEN, lib/integrations/finnhub.js).
 */
const sparkPath = (values, w = 64, hgt = 24) => {
  if (!values?.length) return '';
  const min = Math.min(...values),
    max = Math.max(...values),
    span = max - min || 1;
  return values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(hgt - 2 - ((v - min) / span) * (hgt - 4)).toFixed(1)}`).join(' ');
};
const symbols = (list, fn) =>
  list
    .join(',')
    .split(',')
    .map((x) => fn(x.trim()))
    .filter(Boolean);

OMD.defineWidget({
  id: 'markets',
  name: 'Markets',
  icon: 'trending-up',
  group: 'Fitness & markets',
  integrations: ['finnhub'],
  settings: [
    [
      ['CRYPTO', 'Crypto (CoinGecko ids)', 'textarea'],
      ['STOCKS', 'Stocks (tickers)', 'textarea', { help: 'Needs the <code>FINNHUB_TOKEN</code> Worker secret.' }],
    ],
    ['CURRENCY', 'Currency', 'text'],
  ],
  defaults: {
    CRYPTO: ['bitcoin', 'ethereum', 'solana'], // CoinGecko ids — no key needed
    STOCKS: [], // e.g. ["AAPL", "MSFT"] — needs the FINNHUB_TOKEN Worker secret
    CURRENCY: 'usd',
  },

  mount(ctx) {
    const { h, icon, svg, fmt, settings: s } = ctx;
    const p = ctx.panel({ tint: 'emerald', meta: '24h change' });
    const list = h('div', { class: 'rows scroll-y' });
    p.body.append(list);
    const syms = symbols(s.STOCKS, (x) => x.toUpperCase());
    let stocksMissing = false;
    const feed = ctx.sharedFeed(
      'quotes',
      () => async () => {
        const jobs = [];
        const ids = symbols(s.CRYPTO, (x) => x.toLowerCase());
        if (ids.length) {
          jobs.push(
            ctx
              .fetchJSON(
                `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${encodeURIComponent(s.CURRENCY)}&ids=${ids.join(',')}&sparkline=true&price_change_percentage=24h`,
              )
              .then((all) =>
                all
                  .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
                  .map((c) => ({
                    name: c.name,
                    sym: c.symbol,
                    img: c.image,
                    price: c.current_price,
                    change: c.price_change_percentage_24h,
                    spark: (c.sparkline_in_7d?.price || []).filter((_, i) => i % 4 === 0),
                    currency: s.CURRENCY,
                  })),
              ),
          );
        }
        if (syms.length) {
          jobs.push(
            ctx.status('finnhub').then((st) => {
              stocksMissing = !st.configured;
              if (!st.configured) return [];
              return ctx
                .api(`finnhub/quotes?symbols=${encodeURIComponent(syms.join(','))}`)
                .then((j) => j.quotes.map((q) => ({ name: q.sym, sym: q.sym, price: q.price, change: q.change, spark: null, currency: 'usd' })));
            }),
          );
        }
        const res = await Promise.allSettled(jobs);
        const items = res.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
        if (!items.length && res.some((r) => r.status === 'rejected')) throw res.find((r) => r.status === 'rejected').reason;
        return items;
      },
      5 * 60000,
      { visibleOnly: true },
    );

    // Reuse logo <img> nodes across refreshes so they're never re-requested.
    const logos = new Map();
    const logo = (src) => {
      if (!logos.has(src)) logos.set(src, h('img', { src, alt: '', loading: 'lazy' }));
      return logos.get(src);
    };
    ctx.subscribe(feed, (items, err) => {
      if (!items) {
        if (err) list.replaceChildren(h('div', { class: 'empty' }, icon('alert'), 'Market data unavailable'));
        return;
      }
      if (!items.length) {
        list.replaceChildren(h('div', { class: 'empty' }, icon('trending-up'), 'Add CRYPTO or STOCKS (+ the FINNHUB_TOKEN secret)'));
        return;
      }
      list.replaceChildren(
        ...items.map((m) => {
          const up = (m.change || 0) >= 0;
          return h(
            'div',
            { class: 'mk' },
            m.img ? logo(m.img) : h('span', { class: 'mk-sym' }, m.sym.slice(0, 4)),
            h('div', { class: 'mk-name' }, m.name, h('small', null, m.sym)),
            m.spark?.length
              ? svg(
                  `<svg viewBox="0 0 64 24" preserveAspectRatio="none"><polyline points="${sparkPath(m.spark)}" stroke="${up ? 'var(--emerald)' : 'var(--crimson)'}"/></svg>`,
                )
              : h('span'),
            h(
              'div',
              { class: 'mk-price' },
              fmt.money(m.price, m.currency),
              h('small', { class: up ? 'up' : 'down' }, `${up ? '▲' : '▼'} ${Math.abs(m.change || 0).toFixed(2)}%`),
            ),
          );
        }),
      );
      if (stocksMissing) p.setMeta('24h · stocks need the FINNHUB_TOKEN secret');
    });
    p.onReload = () => feed.refresh();
  },
});
