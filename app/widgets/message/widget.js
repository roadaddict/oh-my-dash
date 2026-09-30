/**
 * Family note — one short message for everyone; tap to edit (synced, shared state "message").
 */
OMD.defineWidget({
  id: 'message',
  name: 'Family note',
  icon: 'message',
  group: 'Family',
  state: ['message'],
  settings: [['MESSAGE', 'Default note', 'text']],
  defaults: {
    MESSAGE: 'Welcome home! Tap here to leave a note for everyone.',
  },

  mount(ctx) {
    const { h, icon, fmt } = ctx;
    const msgStore = ctx.state('message', null);
    const p = ctx.panel({ title: 'Note', head: false, compact: true, tint: 'violet' });
    const box = h('div', { class: 'message', role: 'button', tabindex: '0', 'aria-label': 'Family note — tap to edit' });
    p.body.append(box);
    let editing = false;
    function render() {
      const m = msgStore.get();
      if (editing) return;
      box.replaceChildren(
        h('div', { class: 'message-icon' }, icon('message')),
        h(
          'div',
          { style: { minWidth: '0' } },
          h('p', null, m?.text || ctx.settings.MESSAGE || 'Tap to leave a note'),
          h('small', null, m?.at ? `Updated ${fmt.timeAgo(new Date(m.at))} · tap to edit` : 'Tap to edit'),
        ),
      );
    }
    ctx.listen(box, 'click', () => {
      if (editing) return;
      editing = true;
      const ta = h('textarea', { 'aria-label': 'Note text', maxlength: '280' });
      ta.value = msgStore.get()?.text || '';
      const commit = () => {
        editing = false;
        const text = ta.value.trim();
        const at = Date.now();
        msgStore.update(() => (text ? { text, at } : null));
        render();
      };
      ta.onblur = ctx.guard(commit);
      ta.onkeydown = ctx.guard((e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          ta.blur();
        }
      });
      box.replaceChildren(ta);
      ta.focus();
    });
    msgStore.onChange(render);
    ctx.setInterval(render, 60000);
    render();
  },
});
