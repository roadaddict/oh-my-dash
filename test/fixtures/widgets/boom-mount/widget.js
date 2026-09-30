// Throws while mounting: an error card with Retry instead of the widget.
OMD.defineWidget({
  id: 'boom-mount',
  name: 'Boom (mount)',
  mount(ctx) {
    ctx.panel({});
    if (!window.__omdHealBoom) throw new Error('boom while mounting');
  },
});
