/* ==========================================================================
   PANEL CHROME
   ========================================================================== */
const panelApis = new WeakMap();
/**
 * actions: 'retry' (default) = a Reload button that shows only while the widget's data fails to load;
 * widgets refresh themselves, so there's nothing to reload otherwise. Embedded pages call
 * api.reloadable(fn) to keep it visible, since the dashboard can't tell when an iframe is stuck.
 */
function makePanel(
  { type, title, iconName, tint = 'accent', meta = '', actions = ['retry', 'expand'], bare = false, dark = false, compact = false, head = true },
  run = (fn) => fn(),
) {
  const titleEl = h('h2', null, title);
  const metaEl = h('span', { class: 'panel-meta' }, meta);
  const actionsEl = h('div', { class: 'panel-actions' });
  const body = h('div', { class: 'panel-body' });
  const el = h(
    'section',
    {
      class: `panel b-${type} t-${tint}${bare ? ' is-bare' : ''}${dark ? ' is-dark' : ''}${compact ? ' is-compact' : ''}`,
      'aria-label': title,
    },
    head
      ? h('header', { class: 'panel-head' }, h('span', { class: 'panel-icon' }, icon(iconName)), h('div', { class: 'panel-title' }, titleEl, metaEl), actionsEl)
      : null,
    body,
  );
  const api = {
    el,
    body,
    onReload: null,
    onResize: null,
    /** Runs a panel callback (reload, resize) inside the owning widget's error boundary. */
    run: (fn) => run(fn),
    setMeta(...c) {
      metaEl.replaceChildren(...c.flat().filter((x) => x != null && x !== false));
    },
    setTitle(t) {
      titleEl.textContent = t;
    },
    addAction(ic, label, fn) {
      const b = h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, onclick: (e) => run(() => fn(e)) }, icon(ic));
      actionsEl.prepend(b);
      return b;
    },
    /** Uniform recording look for any widget with a mic / record button (see .rec-btn in CSS). */
    setRecording(on, btn) {
      el.classList.toggle('is-recording', !!on);
      if (btn) {
        btn.classList.add('rec-btn');
        btn.classList.toggle('is-recording', !!on);
        btn.setAttribute('aria-pressed', String(!!on));
      }
    },
    reloadable(fn) {
      api.onReload = fn;
      const b = actionsEl.querySelector('[data-action="reload"]');
      if (b) {
        b.classList.remove('is-retry');
        b.title = `Reload ${title}`;
        b.setAttribute('aria-label', `Reload ${title}`);
      }
    },
  };
  if (actions.includes('retry') || actions.includes('reload')) {
    const retry = !actions.includes('reload');
    actionsEl.append(
      h('button', {
        class: `icon-btn${retry ? ' is-retry' : ''}`,
        type: 'button',
        'data-action': 'reload',
        'aria-label': `${retry ? 'Retry' : 'Reload'} ${title}`,
        title: retry ? 'Couldn’t update — retry' : `Reload ${title}`,
        'data-icon': 'refresh',
      }),
    );
  }
  if (actions.includes('expand'))
    actionsEl.append(h('button', { class: 'icon-btn', type: 'button', 'data-action': 'expand', 'aria-label': `Expand ${title}`, 'data-icon': 'expand' }));
  hydrateIcons(actionsEl);
  panelApis.set(el, api);
  return api;
}
const demoMeta = (hint) => [h('span', { class: 'badge' }, 'Demo'), ` ${hint}`];

const scrim = $('#scrim');
function setExpanded(panel, on) {
  document.querySelectorAll('.panel.is-expanded').forEach((p) => {
    if (p === panel && on) return;
    p.classList.remove('is-expanded');
    const b = p.querySelector('[data-action="expand"]');
    if (b) {
      b.dataset.icon = 'expand';
      hydrateIcons(b.parentElement);
    }
    const a = panelApis.get(p);
    a?.run(() => a.onResize?.());
  });
  if (on && panel) {
    panel.classList.add('is-expanded');
    const b = panel.querySelector('[data-action="expand"]');
    if (b) {
      b.dataset.icon = 'shrink';
      hydrateIcons(b.parentElement);
    }
    requestAnimationFrame(() => {
      const a = panelApis.get(panel);
      a?.run(() => a.onResize?.());
    });
  }
  scrim.classList.toggle('is-visible', !!(on && panel) || $('#settings').classList.contains('is-open'));
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const panel = btn.closest('.panel');
  if (btn.dataset.action === 'expand') setExpanded(panel, !panel.classList.contains('is-expanded'));
  if (btn.dataset.action === 'reload') {
    const a = panelApis.get(panel);
    a?.run(() => a.onReload?.());
  }
});

/* ==========================================================================
   IFRAME PANE — skeleton, slow-load hint, seamless double-buffered refresh
   ========================================================================== */
function skeleton(kind = 'generic') {
  const sk = h('div', { class: 'skeleton', 'aria-hidden': 'true' });
  if (kind === 'list') {
    sk.append(h('div', { class: 'sk sk-title' }));
    for (let i = 0; i < 6; i++) {
      sk.append(
        h(
          'div',
          { class: 'sk-row' },
          h('div', { class: 'sk sk-avatar' }),
          h(
            'div',
            { style: { flex: '1', display: 'flex', flexDirection: 'column', gap: '8px' } },
            h('div', { class: 'sk sk-line', style: { width: `${70 - (i % 3) * 12}%` } }),
            h('div', { class: 'sk sk-line', style: { width: `${40 + (i % 2) * 15}%`, opacity: '.6' } }),
          ),
        ),
      );
    }
  } else {
    sk.append(
      h('div', { class: 'sk sk-title' }),
      h('div', { class: 'sk sk-line', style: { width: '80%' } }),
      h('div', { class: 'sk sk-line', style: { width: '60%' } }),
      h('div', { class: 'sk sk-block' }),
    );
  }
  return sk;
}

const frames = [];
function mountFrame(host, { url, title, zoom = 1, refreshMin = 0, allow = '', invert = false, rounded = false, skeletonKind }) {
  const wrap = h('div', { class: `frame${invert ? ' frame--invert' : ''}${rounded ? ' frame--rounded' : ''}` });
  const notice = h(
    'div',
    { class: 'frame-notice', hidden: true, role: 'status' },
    icon('alert'),
    h('span', null, 'Still loading… if this stays blank, the site may block embedding (X-Frame-Options).'),
    h('button', { type: 'button', onclick: () => hardReload() }, 'Retry'),
  );
  wrap.append(skeleton(skeletonKind), notice);
  host.replaceChildren(wrap);

  let current = null,
    slowTimer = 0,
    needsReloadOnReconnect = false;
  function makeIframe() {
    const f = h('iframe', { title, allow: allow || 'fullscreen', referrerpolicy: 'strict-origin-when-cross-origin' });
    if (zoom && zoom !== 1) {
      Object.assign(f.style, { width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})`, transformOrigin: '0 0' });
    }
    return f;
  }
  function hardReload() {
    if (!navigator.onLine) needsReloadOnReconnect = true;
    clearTimeout(slowTimer);
    wrap.classList.remove('is-loaded');
    notice.hidden = true;
    current?.remove();
    current = makeIframe();
    current.classList.add('is-current');
    current.addEventListener(
      'load',
      () => {
        clearTimeout(slowTimer);
        wrap.classList.add('is-loaded');
        notice.hidden = true;
      },
      { once: true },
    );
    slowTimer = setTimeout(() => {
      notice.hidden = false;
    }, 15000);
    current.src = url;
    wrap.prepend(current);
  }
  // Seamless refresh: load a hidden buffer frame, swap only once it has loaded.
  let stale = false;
  function softReload() {
    if (!navigator.onLine) return;
    if (!isVisible(wrap)) {
      stale = true;
      return;
    } // catch up when the screen is shown again
    stale = false;
    if (!wrap.classList.contains('is-loaded')) return hardReload();
    const buffer = makeIframe();
    buffer.classList.add('is-buffer');
    const giveUp = setTimeout(() => buffer.remove(), 45000);
    buffer.addEventListener(
      'load',
      () => {
        clearTimeout(giveUp);
        buffer.classList.remove('is-buffer');
        buffer.classList.add('is-current');
        const old = current;
        current = buffer;
        setTimeout(() => old?.remove(), 700);
      },
      { once: true },
    );
    buffer.src = url;
    wrap.prepend(buffer);
  }
  hardReload();
  const refreshTimer = refreshMin > 0 ? setInterval(softReload, refreshMin * 60000) : 0;
  const resume = () => {
    if (stale) softReload();
  };
  resumers.add(resume);
  const api = {
    reload: hardReload,
    destroy() {
      clearInterval(refreshTimer);
      clearTimeout(slowTimer);
      resumers.delete(resume);
      frames.splice(frames.indexOf(api), 1);
    },
    onOnline() {
      if (needsReloadOnReconnect) {
        needsReloadOnReconnect = false;
        hardReload();
      }
    },
    onOffline() {
      needsReloadOnReconnect = true;
    },
  };
  frames.push(api);
  return api;
}
