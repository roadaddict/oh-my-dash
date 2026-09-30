/**
 * Lists — shopping and to-do lists the whole family edits (synced; also on phones via
 * ?view=lists and phone shortcuts, lib/lists.js). Tap to tick, hold to delete (with Undo),
 * quick-add chips for what you add often, voice input. A Todoist project shows as an
 * extra tab when the Worker has TODOIST_TOKEN (lib/integrations/todoist.js).
 */
const { uid } = OMD.util;
// Keys starting with "_" hold list metadata (e.g. _recent), not lists.
const normItem = (t) => String(t).trim().replace(/\s+/g, ' ');
/** "milk, eggs; bread" → 3 items. Spoken input also splits on "and"/"und". */
const splitItems = (text, spoken = false) =>
  String(text)
    .split(spoken ? /\s*(?:,|;|\n|\band\b|\bund\b|&)\s*/i : /\s*[,;\n]\s*/)
    .map(normItem)
    .filter(Boolean);
/** Quick-add suggestions: things you add often (or that match what you're typing), not already open. */
function listSuggestions(data, list, query = '') {
  const open = new Set((data[list] || []).filter((i) => !i.done).map((i) => i.text.toLowerCase()));
  const q = query.trim().toLowerCase();
  return Object.entries(data._recent?.[list] || {})
    .filter(([k]) => !open.has(k) && (!q || k.startsWith(q) || k.includes(` ${q}`)) && k !== q)
    .sort((a, b) => b[1].n - a[1].n || b[1].at - a[1].at)
    .slice(0, 8)
    .map(([, r]) => r.text);
}
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

OMD.defineWidget({
  id: 'lists',
  name: 'Lists',
  icon: 'list-checks',
  group: 'Family',
  state: ['lists'],
  integrations: ['todoist'],
  settings: [
    ['LISTS', 'Lists (one name per line)', 'textarea'],
    [
      'TODOIST_PROJECT',
      'Todoist project',
      'text',
      { placeholder: 'Inbox', help: 'Shown as a tab once the Worker has the <code>TODOIST_TOKEN</code> secret (README → Secrets).' },
    ],
  ],
  defaults: {
    LISTS: ['Groceries', 'To-do'],
    TODOIST_PROJECT: '', // Project name ("" = Inbox)
  },

  mount(ctx) {
    const { h, icon, settings: s } = ctx;
    const listStore = ctx.state('lists', () => {
      const seed = (arr) => arr.map((text, i) => ({ id: `seed${i}${text.length}`, text, done: false, at: 1 - i }));
      return {
        Groceries: seed(['Milk', 'Eggs', 'Sourdough bread', 'Bananas', 'Coffee beans', 'Olive oil', 'Tomatoes']),
        'To-do': seed(['Book dentist appointment', 'Renew car insurance', 'Return library books', 'Call the plumber']),
      };
    });
    function loadLists() {
      const data = listStore.get();
      for (const name of s.LISTS) if (!data[name]) data[name] = [];
      return data;
    }
    /** Add items; an item already on the list isn't duplicated (a ticked one is reopened). Remembers what was added. */
    function addListItems(list, texts) {
      const at = Date.now();
      listStore.update((d) => {
        const items = (d[list] ||= []),
          rec = ((d._recent ||= {})[list] ||= {});
        texts.forEach((text, k) => {
          const key = text.toLowerCase(),
            hit = items.find((i) => i.text.toLowerCase() === key);
          if (!hit) items.push({ id: uid(), text, done: false, at: at + k });
          else if (hit.done) {
            hit.done = false;
            hit.at = at + k;
          }
          const r = (rec[key] ||= { text: hit ? hit.text : text, n: 0 }); // keeps the item's own spelling
          r.n++;
          r.at = at;
        });
        const keys = Object.keys(rec);
        if (keys.length > 150)
          keys
            .sort((a, b) => rec[a].at - rec[b].at)
            .slice(0, keys.length - 150)
            .forEach((k) => delete rec[k]);
        return d;
      });
    }
    /** Set once this browser proved it can't do speech recognition: the mic then opens the keyboard. */
    const voiceUnavailable = ctx.local('voice-unavailable', false, { legacyKey: 'omd.voice-unavailable.v1' });
    /** Link for phones: the lists alone, big touch targets, no other widgets loading. */
    function showPhoneLink() {
      const url = new URL(`${location.pathname}?view=lists`, location.href).href;
      ctx.ui.dialog({
        title: 'Lists on your phone',
        sub: 'Scan, sign in once, then “Add to Home screen”',
        className: 'phone-card',
        content: [
          h('img', {
            class: 'qr',
            alt: 'QR code for the phone lists page',
            width: 220,
            height: 220,
            src: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(url)}`,
          }),
          h('code', { class: 'phone-url' }, url),
          h(
            'small',
            { class: 'muted' },
            'Everyone on the family sign-in list can use it. Changes show up on the tablet within ~15 s. Voice and share-sheet shortcuts: README → Lists.',
          ),
        ],
      });
    }
    const todoist = {
      list: async () => (await ctx.api(`todoist/tasks?project=${encodeURIComponent(s.TODOIST_PROJECT)}`)).tasks,
      setDone: (id, done) => ctx.api(`todoist/${done ? 'close' : 'reopen'}`, { method: 'POST', body: JSON.stringify({ id }) }),
      add: (text) => ctx.api('todoist/add', { method: 'POST', body: JSON.stringify({ text, project: s.TODOIST_PROJECT }) }),
    };

    const p = ctx.panel({ tint: 'emerald' });
    let data = loadLists();
    const tabs = [...s.LISTS];
    if (!tabs.length) tabs.push('To-do');
    let active = tabs[0];
    const td = { items: [], error: null, loaded: false };
    const seg = h('div', { class: 'seg', role: 'tablist' });
    const list = h('div', { class: 'items scroll-y' });
    const quick = h('div', { class: 'quick', 'aria-label': 'Add again' });
    const undoBar = h('div', { class: 'undo-bar', role: 'status', hidden: true });
    const input = h('input', { type: 'text', placeholder: 'Add an item…', enterkeyhint: 'done', 'aria-label': 'New item', autocomplete: 'off' });
    const mic = SpeechRec
      ? h('button', { class: 'icon-btn mic rec-btn', type: 'button', 'aria-label': 'Add by voice', title: 'Add by voice' }, icon('mic'))
      : null;
    const form = h('form', { class: 'add-row' }, input, mic, h('button', { class: 'icon-btn', type: 'submit', 'aria-label': 'Add item' }, icon('plus')));
    p.body.classList.add('lists-host');
    p.body.append(tabs.length > 1 ? seg : null, list, undoBar, quick, form);

    const current = () => (active === 'Todoist' ? td.items : data[active] || (data[active] = []));
    async function syncTodoist() {
      try {
        td.items = await todoist.list();
        td.error = null;
      } catch (e) {
        td.error = e.message;
      }
      td.loaded = true;
      render();
    }
    function renderQuick() {
      const sugg = active === 'Todoist' ? [] : listSuggestions(data, active, input.value);
      quick.replaceChildren(
        ...sugg.map((t) =>
          h(
            'button',
            {
              type: 'button',
              class: 'quick-add',
              onclick: () => {
                add([t]);
                input.value = '';
                renderQuick();
              },
            },
            icon('plus'),
            t,
          ),
        ),
      );
      quick.hidden = !sugg.length;
    }
    let pressTimer = 0,
      longPressed = false;
    function itemEl(it) {
      // Hold to delete (with Undo) — a tap still ticks.
      const cancel = () => ctx.clearTimeout(pressTimer);
      return h(
        'button',
        {
          type: 'button',
          class: `item${it.done ? ' is-done' : ''}`,
          'aria-pressed': String(it.done),
          title: 'Tap to tick · hold to delete',
          onclick: () => {
            if (longPressed) {
              longPressed = false;
              return;
            }
            toggle(it);
          },
          onpointerdown: () => {
            longPressed = false;
            cancel();
            pressTimer = ctx.setTimeout(() => {
              longPressed = true;
              remove(it);
            }, 600);
          },
          onpointerup: cancel,
          onpointerleave: cancel,
          onpointercancel: cancel,
          oncontextmenu: (e) => e.preventDefault(),
        },
        h('span', { class: 'check' }, icon('check')),
        h('span', { class: 'item-text' }, it.text),
      );
    }
    // Everything ticked off: a check that draws itself in the top half, the crossed-out items below.
    // It animates only when the list becomes done, not on every sync.
    // The same element is kept across re-renders (a tick syncs a moment later), so the animation plays through.
    let allDoneShown = false,
      allDoneNode = null;
    function allDoneEl(n, animate) {
      if (!animate && allDoneNode) {
        allDoneNode.lastChild.textContent = `${n} ticked off · 🗑 clears them`;
        return allDoneNode;
      }
      const mark = h('span', { class: 'all-done-mark', 'aria-hidden': 'true' });
      mark.innerHTML = '<svg viewBox="0 0 52 52"><circle class="ring" cx="26" cy="26" r="23"/><path class="tick" d="M15.5 27l7 7 14-15"/></svg>';
      return (allDoneNode = h(
        'div',
        { class: `all-done${animate ? ' pop' : ''}`, role: 'status' },
        mark,
        h('b', null, 'All done!'),
        h('small', null, `${n} ticked off · 🗑 clears them`),
      ));
    }
    function render() {
      seg.replaceChildren(
        ...tabs.map((t) => {
          const open = (t === 'Todoist' ? td.items : data[t] || []).filter((i) => !i.done).length;
          return h(
            'button',
            {
              type: 'button',
              role: 'tab',
              class: t === active ? 'is-active' : '',
              'aria-selected': String(t === active),
              onclick: () => {
                active = t;
                if (t === 'Todoist') syncTodoist();
                render();
              },
            },
            t,
            open ? h('span', null, open) : null,
          );
        }),
      );
      const items = current()
        .slice()
        .sort((a, b) => a.done - b.done || b.at - a.at);
      const firstDone = items.findIndex((i) => i.done);
      const allDone = items.length > 0 && firstDone === 0;
      if (active === 'Todoist' && !td.loaded) list.replaceChildren(h('div', { class: 'empty' }, 'Loading Todoist…'));
      else if (active === 'Todoist' && td.error) list.replaceChildren(h('div', { class: 'empty' }, icon('alert'), `Todoist: ${td.error}`));
      else if (!items.length) list.replaceChildren(h('div', { class: 'empty' }, icon('list-checks'), 'Nothing here — add something below'));
      else
        list.replaceChildren(
          ...[
            allDone ? allDoneEl(items.length, !allDoneShown) : null,
            ...items.flatMap((it, i) => [
              i === firstDone && firstDone > 0 ? h('div', { class: 'items-sep' }, `Done · ${items.length - firstDone}`) : null,
              itemEl(it),
            ]),
          ].filter(Boolean),
        );
      list.classList.toggle('is-all-done', allDone);
      allDoneShown = allDone;
      const open = current().filter((i) => !i.done).length;
      p.setMeta(`${active} · ${open} open`);
      renderQuick();
    }
    async function toggle(it) {
      const done = !it.done,
        at = Date.now(),
        name = active;
      if (name === 'Todoist') {
        it.done = done;
        render();
        try {
          await todoist.setDone(it.id, done);
        } catch (e) {
          td.error = e.message;
        }
        return syncTodoist();
      }
      // Idempotent: "set done = X" survives being re-applied on top of someone else's edit.
      listStore.update((d) => {
        const x = (d[name] || []).find((i) => i.id === it.id);
        if (x) {
          x.done = done;
          x.at = at;
        }
        return d;
      });
    }
    let undoTimer = 0;
    function remove(it) {
      if (active === 'Todoist') return;
      const name = active;
      listStore.update((d) => {
        d[name] = (d[name] || []).filter((i) => i.id !== it.id);
        return d;
      });
      undoBar.replaceChildren(
        h('span', null, `Removed “${it.text}”`),
        h(
          'button',
          {
            type: 'button',
            onclick: () => {
              listStore.update((d) => {
                const arr = (d[name] ||= []);
                if (!arr.some((i) => i.id === it.id)) arr.push(it);
                return d;
              });
              undoBar.hidden = true;
            },
          },
          icon('undo'),
          'Undo',
        ),
      );
      undoBar.hidden = false;
      ctx.clearTimeout(undoTimer);
      undoTimer = ctx.setTimeout(() => {
        undoBar.hidden = true;
      }, 6000);
    }
    async function add(texts) {
      if (!texts.length) return;
      if (active === 'Todoist') {
        try {
          for (const t of texts) await todoist.add(t);
        } catch (err) {
          td.error = err.message;
        }
        return syncTodoist();
      }
      addListItems(active, texts);
    }
    ctx.listen(form, 'submit', (e) => {
      e.preventDefault();
      const texts = splitItems(input.value);
      input.value = '';
      add(texts);
    });
    ctx.listen(input, 'input', renderQuick);
    if (mic) {
      // Web Speech: Chrome on Android/desktop uses Google's recogniser. Some kiosk WebViews expose the
      // API without a working backend — then the mic falls back to the keyboard's own 🎤 (Gboard).
      let rec = null,
        watchdog = 0;
      const hint = input.placeholder;
      const done = () => {
        ctx.clearTimeout(watchdog);
        rec = null;
        p.setRecording(false, mic);
        input.placeholder = hint;
      };
      const useKeyboard = (why) => {
        voiceUnavailable.set(true);
        input.focus();
        ctx.toast(`${why} — tap the keyboard's 🎤 to dictate`);
      };
      ctx.listen(mic, 'click', () => {
        if (rec) {
          try {
            rec.stop();
          } catch {
            done();
          }
          return;
        } // second tap: stop listening
        if (voiceUnavailable.get()) {
          input.focus();
          ctx.toast('Tap the keyboard’s 🎤 to dictate');
          return;
        }
        const r = new SpeechRec();
        rec = r;
        r.lang = s.LOCALE || navigator.language || 'en-GB';
        r.continuous = false;
        r.interimResults = false;
        r.maxAlternatives = 1;
        let heard = false;
        r.onresult = ctx.guard((e) => {
          const res = e.results[e.results.length - 1];
          if (heard || !res || res.isFinal === false) return; // one final result per session (Android may repeat it)
          heard = true;
          add(splitItems(res[0].transcript, true));
        });
        r.onerror = ctx.guard((e) => {
          if (e.error === 'service-not-allowed' || e.error === 'language-not-supported') useKeyboard('Voice input isn’t available in this browser');
          else if (e.error === 'not-allowed')
            ctx.toast('Microphone blocked — allow it for the dashboard (Fully Kiosk: Web Content Settings → microphone), or use the keyboard’s 🎤');
          else if (e.error === 'audio-capture') ctx.toast('No microphone found');
          else if (e.error === 'network') ctx.toast('Voice input needs an internet connection');
          else if (e.error === 'no-speech') ctx.toast('Didn’t catch that — tap 🎤 and try again');
          else if (e.error !== 'aborted') ctx.toast(`Voice input failed (${e.error})`);
          done();
        });
        r.onend = ctx.guard(() => {
          if (rec === r) done();
        });
        // Some Android builds never fire onend after an error: never leave the mic stuck red.
        watchdog = ctx.setTimeout(() => {
          try {
            r.abort();
          } catch {
            /* already over */
          }
          if (rec === r) done();
        }, 15000);
        try {
          r.start();
          p.setRecording(true, mic);
          input.placeholder = 'Listening…';
        } catch {
          done();
          useKeyboard('Voice input isn’t available here');
        }
      });
    }
    p.addAction('trash', 'Clear completed', () => {
      if (active === 'Todoist') return;
      const name = active;
      listStore.update((d) => {
        d[name] = (d[name] || []).filter((i) => !i.done);
        return d;
      });
    });
    if (ctx.cloud && !ctx.phoneView) p.addAction('smartphone', 'Open on your phone', showPhoneLink);
    // Quick-add chips only on a tall widget, or on a big screen with room for ~6 rows beside them.
    // Measured without the chips, so it never flips back and forth.
    const QUICK_H = 44,
      MIN_ROWS = 6,
      TALL = 520;
    const fit = () => {
      const row = (list.querySelector('.item')?.offsetHeight || 44) + 6;
      const fixed = (seg.isConnected ? seg.offsetHeight + 8 : 0) + form.offsetHeight + 8 + QUICK_H;
      const roomy = p.body.clientHeight - fixed >= row * MIN_ROWS;
      const bigScreen = innerWidth >= 1280 && innerHeight >= 800;
      p.body.classList.toggle('is-short', !(p.body.clientHeight >= TALL || (bigScreen && roomy)));
    };
    ctx.observeResize(p.body, fit);
    ctx.listen(window, 'resize', fit);
    listStore.onChange(() => {
      data = loadLists();
      render();
    });
    // Todoist: a tab when the Worker has TODOIST_TOKEN (lib/integrations/todoist.js).
    let hasTodoist = false;
    ctx.status('todoist').then(
      ctx.guard((st) => {
        if (!st.configured) return;
        hasTodoist = true;
        tabs.push('Todoist');
        if (tabs.length === 2 && !seg.isConnected) list.before(seg);
        syncTodoist();
        ctx.setInterval(syncTodoist, 5 * 60000);
      }),
    );
    p.onReload = () => {
      data = loadLists();
      if (hasTodoist) syncTodoist();
      render();
    };
    render();
    ctx.raf(fit);
  },
});
