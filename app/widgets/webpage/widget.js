/**
 * Web page — any page that allows embedding (YouTube, Grafana, …). The URL comes from
 * the layout block ({ type: 'webpage', url, title, zoom, refreshMin }) or WEBPAGE_URL.
 */
OMD.defineWidget({
  id: 'webpage',
  name: 'Web page',
  icon: 'link',
  group: 'Home & web',
  settings: [['WEBPAGE_URL', 'Web page block URL', 'url']],
  defaults: {
    WEBPAGE_URL: '', // Used by "webpage" blocks without their own url
  },

  mount(ctx) {
    const { h, icon, spec: o } = ctx;
    const url = o.url || ctx.settings.WEBPAGE_URL;
    const host = ctx.util.hostOf(url);
    const p = ctx.panel({ title: o.title || host || 'Web page', icon: 'globe', tint: 'sky', meta: host });
    if (!url) {
      p.body.append(h('div', { class: 'empty' }, icon('globe'), 'Set WEBPAGE_URL or the block’s url option'));
      return;
    }
    const frame = ctx.ui.frame(p.body, {
      url,
      title: o.title || 'Web page',
      zoom: o.zoom || 1,
      refreshMin: o.refreshMin || 0,
      allow: 'autoplay; fullscreen; encrypted-media',
    });
    p.reloadable(frame.reload);
  },
});
