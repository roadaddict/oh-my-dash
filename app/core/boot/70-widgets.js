/* ==========================================================================
   WIDGET HOST — mounts widget definitions and keeps each one in its own box.

   Every widget instance gets a ctx (see makeCtx). Everything it schedules through
   ctx — timers, the clock tick, event listeners, resize observers, feed
   subscriptions, frames — is:
     • guarded: an exception inside the callback fails *this* widget, which is
       replaced by an error card with a Retry button; the rest of the page runs on;
     • owned: removed automatically when the widget is unmounted (removed or
       changed in the layout editor, or after it failed);
     • metered: a widget that keeps the main thread busy (> 2.5 s of every 5 s,
       or thousands of callbacks a second) is stopped the same way.
   Errors that escape all that (a listener added without ctx, a stray promise)
   are traced back to the widget by the line numbers of its <script> (the build
   records them) and fail every instance of that widget.
   ========================================================================== */
const instances = new WeakMap(); // panel element → WidgetInstance
const liveInstances = new Set();
const BUSY_WINDOW_MS = 5000,
  BUSY_LIMIT_MS = 2500,
  CALL_LIMIT = 5000;

class WidgetInstance {
  constructor(def, spec) {
    Object.assign(this, { def, spec, panel: null, el: null, dead: false, disposers: new Set(), depth: 0, win: 0, busy: 0, calls: 0 });
  }
  /** Register a clean-up; returns a function that runs it early (e.g. an unsubscribe). */
  own(dispose) {
    if (typeof dispose !== 'function') return () => {};
    if (this.dead) {
      try {
        dispose();
      } catch {
        /* already gone */
      }
      return () => {};
    }
    this.disposers.add(dispose);
    return () => {
      if (this.disposers.delete(dispose)) dispose();
    };
  }
  /** fn wrapped in this widget's error boundary (and CPU meter). */
  guard(fn) {
    if (typeof fn !== 'function' || fn.__omdGuarded) return fn;
    const inst = this;
    const guarded = function (...args) {
      if (inst.dead) return undefined;
      const outer = inst.depth++ === 0,
        t0 = outer ? performance.now() : 0;
      try {
        const r = fn.apply(this, args);
        if (r && typeof r.then === 'function') r.then(null, (e) => inst.fail(e));
        return r;
      } catch (e) {
        inst.fail(e);
        return undefined;
      } finally {
        inst.depth--;
        if (outer) inst.meter(performance.now() - t0);
      }
    };
    guarded.__omdGuarded = true;
    return guarded;
  }
  run(fn) {
    return this.guard(fn)();
  }
  meter(ms) {
    const now = performance.now();
    if (now - this.win > BUSY_WINDOW_MS) {
      this.win = now;
      this.busy = 0;
      this.calls = 0;
    }
    this.busy += ms;
    this.calls++;
    if (this.busy > BUSY_LIMIT_MS) this.fail(new Error(`Stopped: it kept the page busy (${Math.round(this.busy)} ms in ${BUSY_WINDOW_MS / 1000} s)`));
    else if (this.calls > CALL_LIMIT) this.fail(new Error(`Stopped: ${this.calls} callbacks in ${BUSY_WINDOW_MS / 1000} s — a runaway loop?`));
  }
  dispose() {
    if (this.dead) return;
    this.dead = true;
    liveInstances.delete(this);
    for (const d of [...this.disposers].reverse()) {
      try {
        d();
      } catch (e) {
        console.error(e);
      }
    }
    this.disposers.clear();
  }
  /** Replace this widget with an error card (in the same place of the layout). */
  fail(err) {
    if (this.dead) return;
    console.error(`Widget "${this.def.id}" failed:`, err);
    const old = this.el;
    this.dispose();
    if (!old) {
      this.startError = err;
      return;
    } // still mounting: start() shows the card
    if (old.isConnected) swapNode(old, errorCard(this.spec, err, true));
  }
  /** Mount: returns the widget's panel element, or an error card. */
  start() {
    liveInstances.add(this);
    let cleanup;
    try {
      cleanup = this.run(() => this.def.mount(makeCtx(this)));
      if (this.startError) throw this.startError;
      if (!this.panel) throw new Error('mount(ctx) must create its panel with ctx.panel({ … }) before it returns');
    } catch (e) {
      this.dispose();
      console.error(`Widget "${this.def.id}" failed to mount:`, e);
      return errorCard(this.spec, e, true);
    }
    if (typeof cleanup === 'function') this.own(cleanup);
    this.el = this.panel.el;
    instances.set(this.el, this);
    return this.el;
  }
}

/** A mounted widget's element (or an error card) for a layout spec such as { type: 'calendar', view: 'month' }. */
function mountSpec(spec) {
  const type = spec?.type;
  const def = widgetDef(type);
  if (!def) return errorCard(spec, loadFailures.get(type) || new Error(`There is no widget called "${type}"`), false);
  if (widgetProblems.has(type)) return errorCard(spec, new Error(widgetProblems.get(type)), false);
  return new WidgetInstance(def, spec).start();
}
/** Stop a widget element's timers, listeners and subscriptions (before it's removed or replaced). */
function unmountNode(el) {
  if (!el) return;
  instances.get(el)?.dispose();
  instances.delete(el);
}
/** Put `fresh` where `old` is, keeping its place in the layout. */
function swapNode(old, fresh) {
  unmountNode(old);
  for (const [k, v] of Object.entries(old.dataset)) if (!(k in fresh.dataset)) fresh.dataset[k] = v;
  for (const prop of ['--x', '--y', '--w', '--h', 'order']) {
    const v = old.style.getPropertyValue(prop);
    if (v) fresh.style.setProperty(prop, v);
  }
  for (const c of ['is-off', 'no-head']) fresh.classList.toggle(c, old.classList.contains(c));
  old.replaceWith(fresh);
  hydrateIcons(fresh);
  bus.dispatchEvent(new CustomEvent('widget-swapped', { detail: fresh }));
}
function errorCard(spec, err, canRetry) {
  const type = spec?.type || 'unknown',
    def = widgetDef(type);
  const p = makePanel({ type: /^[a-z][a-z0-9-]*$/.test(type) ? type : 'unknown', title: def?.name || type, iconName: 'alert', tint: 'crimson', actions: [] });
  p.el.classList.add('is-failed');
  const retry = () => swapNode(p.el, mountSpec(spec));
  p.body.append(
    h(
      'div',
      { class: 'empty', role: 'alert' },
      icon('alert'),
      h('div', null, canRetry ? 'This widget failed' : 'This widget can’t load'),
      h('small', null, String(err?.message || err || 'Unknown error')),
      canRetry ? h('button', { class: 'cta', type: 'button', onclick: retry }, icon('refresh'), 'Retry') : null,
    ),
  );
  return p.el;
}

/* ---------- Errors that escaped every guard: whose code threw? ---------- */
const pageUrl = location.href.split('#')[0];
function stackLines(error) {
  const out = [];
  for (const m of String(error?.stack || '').matchAll(/(?:\(|at |@)(\S+?):(\d+):\d+\)?\s*$/gm)) if (m[1].split('#')[0] === pageUrl) out.push(Number(m[2]));
  return out;
}
function widgetsAtLine(line) {
  for (const info of Object.values(REG.manifest.widgets || {})) if (line >= info.from && line <= info.to) return info.ids;
  return null;
}
REG.onError = ({ error, message, line, file }) => {
  const lines = [...stackLines(error), ...(file && file.split('#')[0] === pageUrl ? [line] : [])];
  for (const n of lines) {
    const ids = widgetsAtLine(n);
    if (!ids) continue;
    for (const inst of [...liveInstances]) if (ids.includes(inst.def.id)) inst.fail(error || new Error(message));
    return;
  }
};
REG.early.splice(0).forEach(REG.onError);

/* ---------- ctx: everything a widget may use ---------- */
const sharedFeeds = new Map();
const stateStores = new Map();
const storeFor = (key, fallback) => {
  if (!stateStores.has(key)) stateStores.set(key, sharedState(key, fallback));
  return stateStores.get(key);
};
const fmtTemp = (c) => `${(FAHRENHEIT ? (c * 9) / 5 + 32 : c).toFixed(1)}°`;
const toast = (msg) => {
  const t = h('div', { class: 'edit-toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
};
/** Helpers without a lifetime: formatting and small utilities (also on ctx). */
const KIT = Object.freeze({
  icon,
  svg: svgEl,
  fmt: Object.freeze({
    time: fmtTime,
    dateLong: fmtDateLong,
    dateShort: fmtDateShort,
    dayMonth: fmtDayMonth,
    dayMonthShort: fmtDayMonthShort,
    monthYear: fmtMonthYear,
    weekday: fmtWeekday,
    weekdayShort: fmtWeekdayShort,
    timeAgo,
    money,
    temp: fmtTemp,
  }),
  util: OMD.util,
  fetchText,
  fetchJSON,
  withProxy,
});

function makeCtx(inst) {
  const { def, spec } = inst;
  const g = (fn) => inst.guard(fn);
  const own = (d) => inst.own(d);
  const panelEl = () => inst.panel?.el || null;
  const visibleKeys = new Set([...Object.keys(def.defaults), ...settingKeys(def.settings), ...def.reads, ...SHARED_KEYS]);
  const settings = Object.freeze(Object.fromEntries([...visibleKeys].filter((k) => k in cfg).map((k) => [k, cfg[k]])));
  const settingsSig = JSON.stringify(settings); // saved feed data belongs to these settings
  let feedCount = 0;
  const timeouts = new Set(),
    intervals = new Set(),
    frames = new Set(),
    clockJobs = new Map();
  let clockIds = 0;
  own(() => {
    timeouts.forEach(clearTimeout);
    intervals.forEach(clearInterval);
    frames.forEach(cancelAnimationFrame);
    clockJobs.forEach((cancel) => cancel());
  });
  const allowed = (path) => {
    const name = String(path).replace(/^\//, '').split(/[/?]/)[0];
    if (!def.integrations.includes(name)) throw new Error(`"${def.id}" uses the "${name}" integration without declaring it (integrations: ['${name}'])`);
    return `/${String(path).replace(/^\//, '')}`;
  };
  const guardAttrs = (attrs) =>
    attrs ? Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, k.startsWith('on') && typeof v === 'function' ? g(v) : v])) : attrs;

  const ctx = {
    ...KIT,
    id: def.id,
    /** The layout options of this slot, e.g. { type: 'calendar', view: 'month', dark: true }. */
    spec: Object.freeze({ ...spec }),
    /** Read-only: this widget's settings, the ones it `reads`, and location / units / time. */
    settings,
    get cloud() {
      return sync.cloud;
    },
    get phoneView() {
      return app.classList.contains('view-phone');
    },
    imperial: FAHRENHEIT,
    locale: LOCALE,
    hasProxy: !!PROXY,

    /** The widget's glass panel: { el, body, setMeta, setTitle, addAction, reloadable, setRecording, onReload, onResize }. */
    panel(opts = {}) {
      if (inst.panel) throw new Error('ctx.panel() can only be called once');
      const { icon: iconName = def.icon, title = def.name, ...rest } = opts;
      inst.panel = makePanel({ ...rest, type: def.id, title, iconName }, (fn) => inst.run(fn));
      return inst.panel;
    },
    /** document.createElement with attributes and children; on* handlers run inside the error boundary. */
    h: (tag, attrs, ...children) => h(tag, guardAttrs(attrs), ...children),

    /* Timers & events — all removed when the widget goes away. */
    setTimeout(fn, ms) {
      const id = setTimeout(() => {
        timeouts.delete(id);
        g(fn)();
      }, ms);
      timeouts.add(id);
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
      clearTimeout(id);
    },
    /** Whole seconds run on the shared clock (one wake-up for everything due); shorter ones on a timer. */
    setInterval(fn, ms) {
      if (ms >= 1000 && ms % 1000 === 0) {
        const id = `c${++clockIds}`;
        clockJobs.set(id, every(ms, g(fn)));
        return id;
      }
      const id = setInterval(g(fn), ms);
      intervals.add(id);
      return id;
    },
    clearInterval(id) {
      if (clockJobs.has(id)) {
        clockJobs.get(id)();
        clockJobs.delete(id);
        return;
      }
      intervals.delete(id);
      clearInterval(id);
    },
    raf(fn) {
      const id = requestAnimationFrame((t) => {
        frames.delete(id);
        g(fn)(t);
      });
      frames.add(id);
      return id;
    },
    /** fn(now) every second, on the shared clock tick (also right away). Returns an unsubscribe. */
    onTick: (fn) => own(onTick(g(fn))),
    listen(target, type, fn, opts) {
      const f = g(fn);
      target.addEventListener(type, f, opts);
      return own(() => target.removeEventListener(type, f, opts));
    },
    observeResize(el, fn) {
      const ro = new ResizeObserver(g(fn));
      ro.observe(el);
      return own(() => ro.disconnect());
    },
    onCleanup: (fn) => own(fn),
    guard: g,
    fail: (err) => inst.fail(err),

    /* Data — feeds keep their last good data on the device unless opts.persist === false. */
    /** A polling feed for this widget: createFeed semantics; subscribe with ctx.subscribe. */
    feed(loader, intervalMs, opts = {}) {
      const persist = opts.persist !== false && `${def.id}.${hashKey(`${JSON.stringify(spec)}|${settingsSig}|${feedCount++}`)}`;
      return createFeed(loader, intervalMs, { ...opts, persist });
    },
    /** One feed shared by every widget asking for `key` (e.g. News and the ticker). */
    sharedFeed(key, makeLoader, intervalMs, opts = {}) {
      const k = `${def.folder || def.id}:${key}`;
      const persist = opts.persist !== false && `${def.folder || def.id}.${hashKey(`${key}|${settingsSig}`)}`;
      if (!sharedFeeds.has(k)) sharedFeeds.set(k, createFeed(makeLoader(), intervalMs, { ...opts, persist }));
      return sharedFeeds.get(k);
    },
    /** fn(data, error) now (if there is data) and on every update; the panel shows Retry while it fails. */
    subscribe: (feed, fn, el = panelEl()) => own(feed.subscribe(g(fn), el)),
    /** Synced family data (D1 in cloud mode, localStorage otherwise). Change it with update(fn). */
    state(name, fallback) {
      const legacy = def.state.includes(name);
      if (!legacy && !/^[a-z0-9-]{1,40}$/.test(name)) throw new Error(`ctx.state: name must be lower-case letters, digits and "-" (got "${name}")`);
      const key = legacy ? name : `w-${def.id}-${name}`;
      const store = storeFor(key, fallback);
      return { key, get: () => store.get(), update: (fn) => store.update(fn), onChange: (fn) => ctx.listen(bus, key, fn) };
    },
    /** Per-device storage (localStorage), namespaced to this widget. */
    local(name, fallback, { legacyKey } = {}) {
      const mine = persisted(`omd.w.${def.id}.${name}`, fallback);
      return {
        get() {
          const v = store.get(`omd.w.${def.id}.${name}`);
          return v == null && legacyKey && store.get(legacyKey) != null ? persisted(legacyKey, fallback).get() : mine.get();
        },
        set: (v) => mine.set(v),
      };
    },
    /** JSON from this widget's backend integration: ctx.api('strava/stats?…'). Throws with .status on errors. */
    api: (path, opts) => apiJSON(allowed(path), opts),
    apiUrl: (path) => `${API}${allowed(path)}`,
    /** { configured, connected, … } of a backend integration, cached per page load. */
    status: (name, fresh) => serviceStatus(allowed(name).slice(1), fresh),

    /* Shared components */
    ui: Object.freeze({
      frame(host, opts) {
        const f = mountFrame(host, opts);
        own(() => f.destroy());
        return f;
      },
      skeleton,
      demoMeta,
      analogClock: (opts) => analogClock(opts, ctx),
      slideshow: (host, opts) => slideshow(host, opts, ctx),
      weather: (host) => mountWeather(host, ctx),
      /** A sheet over the page (like the widget picker); closes on unmount. Returns close(). */
      dialog({ title, sub = '', label = title, content = [], className = '' }) {
        const close = () => {
          sheet.remove();
          undo();
        };
        const sheet = h(
          'div',
          { class: `edit-picker b-${def.id}`, role: 'dialog', 'aria-label': label },
          h(
            'div',
            { class: `edit-picker-card ${className}` },
            h(
              'div',
              { class: 'edit-picker-head' },
              h('div', null, h('b', null, title), sub ? h('small', null, sub) : null),
              h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x')),
            ),
            content,
          ),
        );
        sheet.addEventListener('click', (e) => {
          if (e.target === sheet) close();
        });
        document.body.append(sheet);
        const undo = own(() => sheet.remove());
        return close;
      },
    }),
    weather: Object.freeze({ feed: weatherFeed, wmo, forecastEls, localDate }),
    holidays: () => loadHolidays(),
    isVisible: (el = panelEl()) => isVisible(el),
    openSettings: (key) => openSettings(key),
    toast,
  };
  return Object.freeze(ctx);
}

/* ---------- The catalog: names, icons and groups for the picker and the settings ---------- */
const groupRank = (g) => {
  const i = WIDGET_GROUPS.indexOf(g);
  return i < 0 ? WIDGET_GROUPS.length : i;
};
/** Every registered widget, in picker order (group, then name). */
const widgetList = () =>
  [...REG.widgets.values()].sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
const specLabel = (s) => {
  const d = widgetDef(s.type);
  return [d?.name || s.type, d?.variants?.[s.variant] || s.variant || s.view, s.compact ? 'compact' : ''].filter(Boolean).join(' · ');
};
