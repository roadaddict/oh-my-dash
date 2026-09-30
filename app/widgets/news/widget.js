/**
 * News (RSS / Atom) — Headlines, and the news ticker along the bottom of a screen.
 * Two widgets, one feed: both come from this folder and share it (ctx.sharedFeed).
 * Feeds without CORS headers go through the proxy, or rss2json.com as a fallback.
 */
const firstImg = (html) => /<img[^>]+src=["']([^"']+)/i.exec(html || '')?.[1];
function parseNews(text, source) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Not an RSS/Atom feed');
  return [...doc.querySelectorAll('item, entry')]
    .map((n) => {
      const child = (name) => [...n.children].find((c) => c.localName === name);
      const title = child('title')?.textContent?.trim();
      const dateText = (child('pubDate') || child('published') || child('updated') || child('date'))?.textContent;
      const media =
        [...n.getElementsByTagNameNS('*', 'thumbnail'), ...n.getElementsByTagNameNS('*', 'content')].find((c) => c.getAttribute('url'))?.getAttribute('url') ||
        [...n.getElementsByTagName('enclosure')].find((e) => /^image\//.test(e.getAttribute('type') || ''))?.getAttribute('url') ||
        firstImg((child('description') || child('content') || child('summary') || child('encoded'))?.textContent);
      return title ? { title, source, date: dateText ? new Date(dateText) : null, image: media } : null;
    })
    .filter(Boolean);
}
function demoNews() {
  const now = Date.now();
  return [
    'City council approves new riverside cycle path',
    'Local bakery wins national sourdough award',
    'Weekend forecast: sunshine returns after a week of showers',
    'Library extends opening hours for exam season',
    'New tram line to the airport opens next month',
    'Community garden celebrates tenth harvest festival',
    'Researchers unveil quieter, cheaper heat pump design',
  ].map((title, i) => ({ title, source: 'Demo', date: new Date(now - (i + 1) * 47 * 60000), image: null }));
}
const newsSources = (s) =>
  s.NEWS_FEEDS.map((line) => {
    const x = OMD.util.pipe(line);
    return x.length > 1 ? { name: x[0], url: x[1] } : { name: OMD.util.hostOf(x[0]), url: x[0] };
  }).filter((src) => /^(https?:|data:)/i.test(src.url));

/** The one news feed of the page (Headlines + ticker). */
function newsFeed(ctx) {
  const s = ctx.settings;
  return ctx.sharedFeed(
    'news',
    () => {
      async function loadNewsSource(src) {
        try {
          return parseNews(await ctx.fetchText(src.url), src.name);
        } catch (err) {
          if (!s.NEWS_RSS2JSON) throw err;
          const d = await ctx.fetchJSON(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(src.url)}`);
          if (d.status !== 'ok') throw new Error(d.message || 'rss2json error');
          return d.items.map((it) => ({
            title: it.title,
            source: src.name,
            date: it.pubDate ? new Date(`${it.pubDate.replace(' ', 'T')}Z`) : null,
            image: it.thumbnail || it.enclosure?.link || firstImg(it.description),
          }));
        }
      }
      return async () => {
        const results = await Promise.allSettled(newsSources(s).map(loadNewsSource));
        let items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
        if (!items.length) return { items: demoNews(), demo: true, errors: results.filter((r) => r.status === 'rejected').length };
        const seen = new Set();
        items = items.filter((it) => {
          const k = it.title.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        items.sort((a, b) => (b.date || 0) - (a.date || 0));
        return { items: items.slice(0, 60), demo: false };
      };
    },
    s.NEWS_REFRESH_MIN * 60000,
    { visibleOnly: true },
  );
}

const NEWS_SETTINGS = ['NEWS_FEEDS', 'NEWS_RSS2JSON', 'NEWS_REFRESH_MIN'];

OMD.defineWidget({
  id: 'news',
  name: 'News',
  icon: 'newspaper',
  group: 'Photos, music & news',
  settings: [
    ['NEWS_FEEDS', 'RSS / Atom feeds', 'textarea', { help: 'One per line: <code>Name | https://…/rss.xml</code>' }],
    ['NEWS_RSS2JSON', 'Use rss2json.com when a feed blocks CORS', 'checkbox'],
  ],
  defaults: {
    NEWS_FEEDS: ['BBC | https://feeds.bbci.co.uk/news/world/rss.xml', 'The Verge | https://www.theverge.com/rss/index.xml'],
    NEWS_RSS2JSON: true,
    NEWS_REFRESH_MIN: 30,
  },

  mount(ctx) {
    const { h, fmt } = ctx;
    const p = ctx.panel({ title: 'Headlines', tint: 'crimson' });
    const feed = newsFeed(ctx);
    const list = h('div', { class: 'news scroll-y' });
    p.body.append(h('div', { class: 'frame', style: { background: 'transparent', boxShadow: 'none' } }, ctx.ui.skeleton('list')));
    let data = null,
      lead = 0;
    const bg = (url) => `url("${url.replace(/"/g, '%22')}")`;
    function render() {
      if (!data) return;
      const withImg = data.items.slice(0, 8).filter((it) => it.image);
      const leadItem = withImg.length ? withImg[lead % withImg.length] : null;
      const rest = data.items.filter((it) => it !== leadItem).slice(0, 30);
      list.replaceChildren(
        leadItem
          ? h(
              'div',
              { class: 'news-lead', style: { backgroundImage: bg(leadItem.image) } },
              h(
                'div',
                null,
                h('div', { class: 'news-src' }, h('b', null, leadItem.source), leadItem.date ? ` · ${fmt.timeAgo(leadItem.date)}` : ''),
                h('h3', null, leadItem.title),
              ),
            )
          : null,
        ...rest.map((it) =>
          h(
            'div',
            { class: 'news-item' },
            h(
              'div',
              { style: { minWidth: '0' } },
              h('h3', null, it.title),
              h('div', { class: 'news-src' }, h('b', null, it.source), it.date ? ` · ${fmt.timeAgo(it.date)}` : ''),
            ),
            it.image ? h('div', { class: 'news-thumb', style: { backgroundImage: bg(it.image) } }) : null,
          ),
        ),
      );
      if (list.parentNode !== p.body) p.body.replaceChildren(list);
      p.setMeta(
        data.demo
          ? ctx.ui.demoMeta(newsSources(ctx.settings).length ? 'Feeds unreachable' : 'Add NEWS_FEEDS')
          : [...new Set(data.items.map((i) => i.source))].slice(0, 3).join(' · '),
      );
    }
    ctx.subscribe(feed, (d) => {
      if (d) {
        data = d;
        render();
      }
    });
    ctx.setInterval(() => {
      lead++;
      render();
    }, 20000);
    p.onReload = () => feed.refresh();
  },
});

OMD.defineWidget({
  id: 'ticker',
  name: 'News ticker',
  icon: 'newspaper',
  group: 'Photos, music & news',
  reads: NEWS_SETTINGS, // same feeds as News: set them there

  mount(ctx) {
    const { h } = ctx;
    const p = ctx.panel({ head: false });
    const track = h('div', { class: 'ticker-track' });
    p.body.append(h('div', { class: 'ticker', 'aria-live': 'off' }, track));
    ctx.subscribe(newsFeed(ctx), (d) => {
      if (!d) return;
      // Headline photo in a circle when the feed has one: shown once loaded, a broken one just drops out.
      const pic = (src) =>
        h('img', {
          class: 'ticker-img',
          src,
          alt: '',
          decoding: 'async',
          referrerpolicy: 'no-referrer',
          onload: (e) => e.target.classList.add('is-loaded'),
          onerror: (e) => e.target.remove(),
        });
      track.replaceChildren(
        ...d.items
          .slice(0, 15)
          .map((it) =>
            h(
              'span',
              { class: 'ticker-item' },
              /^https?:/i.test(it.image || '') ? pic(it.image) : null,
              h('b', null, it.source),
              h('span', { class: 'ticker-title' }, it.title),
              h('i'),
            ),
          ),
      );
      ctx.raf(() => track.style.setProperty('--dur', `${Math.max(30, Math.round(track.scrollWidth / 70))}s`));
    });
  },
});
