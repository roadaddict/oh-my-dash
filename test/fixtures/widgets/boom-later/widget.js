// Healthy at first; fails from a timer, a click handler, or a listener added without ctx.
OMD.defineWidget({
  id: 'boom-later',
  name: 'Boom (later)',
  mount(ctx) {
    const { h } = ctx;
    const p = ctx.panel({});
    const mode = window.__omdBoomMode || 'none';
    p.body.append(
      h('p', { class: 'alive' }, 'alive'),
      h(
        'button',
        {
          class: 'boom-click',
          type: 'button',
          onclick: () => {
            throw new Error('boom in a click handler');
          },
        },
        'click to fail',
      ),
      h('button', { class: 'boom-raw', type: 'button' }, 'raw listener'),
    );
    // Deliberately without ctx.listen: the dashboard must trace this one by line number.
    p.body.querySelector('.boom-raw').addEventListener('click', () => {
      throw new Error('boom in a raw listener');
    });
    if (mode === 'timer')
      ctx.setTimeout(() => {
        throw new Error('boom in a timer');
      }, 500);
    if (mode === 'promise')
      ctx.setTimeout(() => {
        Promise.reject(new Error('boom in a stray promise'));
      }, 500);
  },
});
