// Counts its own ticks, timers and feed polls, so tests can see them stop when it's removed.
OMD.defineWidget({
  id: 'counter',
  name: 'Counter',
  mount(ctx) {
    const p = ctx.panel({});
    const c = (window.__omdCounter ||= { ticks: 0, intervals: 0, feed: 0, resize: 0, cleanups: 0 });
    ctx.onTick(() => {
      c.ticks++;
    });
    ctx.setInterval(() => {
      c.intervals++;
    }, 200);
    ctx.listen(window, 'resize', () => {
      c.resize++;
    });
    const feed = ctx.feed(async () => {
      c.feed++;
      return c.feed;
    }, 300);
    ctx.subscribe(feed, () => {});
    p.body.append(ctx.h('p', { class: 'counter' }, 'counting'));
    return () => {
      c.cleanups++;
    };
  },
});
