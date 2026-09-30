// Keeps the main thread busy (a runaway render loop): the watchdog stops it.
OMD.defineWidget({
  id: 'busy',
  name: 'Busy loop',
  mount(ctx) {
    const p = ctx.panel({});
    p.body.append(ctx.h('p', null, 'spinning'));
    if (!window.__omdBusy) return;
    ctx.setInterval(() => {
      const end = performance.now() + 400;
      while (performance.now() < end) {
        /* spin */
      }
    }, 50);
  },
});
