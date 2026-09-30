// Doesn't parse (only built with --no-syntax-check): the rest of the page must still work.
OMD.defineWidget({
  id: 'broken-syntax', name: 'Broken syntax',
  mount(ctx) { ctx.panel({}); },
}  // ← missing ")"
