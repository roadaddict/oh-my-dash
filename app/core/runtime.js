/**
 * The first script on the page. It defines window.OMD, the one global widgets talk to:
 *
 *   OMD.defineWidget({ id, name, icon, group, settings, defaults, mount(ctx) { … } })
 *   OMD.icons({ name: '<path d="…"/>' })              extra Lucide-style icons (24×24, stroke)
 *   OMD.configure({ defaults: {…}, layouts: {…} })     your own defaults / screens (app/config.js)
 *
 * Nothing here touches the page: widgets only *register* while the page loads. The dashboard
 * (app/core/boot) starts afterwards and mounts them — see CONTRIBUTING.md for the ctx API.
 */
(() => {
  'use strict';
  const widgets = new Map(); // id → frozen definition
  const loadErrors = new Map(); // folder → Error thrown while its script ran
  const loaded = new Set(); // folders whose script ran at all
  const icons = {};
  const user = { defaults: {}, layouts: {} };
  const early = []; // uncaught errors before the dashboard starts listening
  let folder = null;
  let manifest = { widgets: {} };
  const internal = {
    widgets,
    loadErrors,
    loaded,
    icons,
    user,
    early,
    onError: null,
    get manifest() {
      return manifest;
    },
  };

  // Uncaught errors (including a widget script that doesn't parse) are kept until the dashboard
  // can attribute them to a widget by line number (see _manifest).
  const keep = (info) => {
    if (internal.onError) internal.onError(info);
    else early.push(info);
  };
  window.addEventListener('error', (e) => keep({ error: e.error, message: e.message, line: e.lineno, file: e.filename }));
  window.addEventListener('unhandledrejection', (e) => keep({ error: e.reason, message: String(e.reason?.message || e.reason), line: 0, file: '' }));

  const fail = (msg) => {
    throw new TypeError(`defineWidget: ${msg}`);
  };
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  /** Setting keys of a `settings` list (rows are nested arrays). */
  const keysOf = (settings) => settings.flatMap((f) => (Array.isArray(f[0]) ? f.map((x) => x[0]) : [f[0]]));

  function defineWidget(def) {
    if (!isObj(def)) fail('pass one object: { id, name, mount(ctx) { … } }');
    const { id } = def;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) fail(`id must be lower-case letters, digits and "-" (got ${JSON.stringify(id)})`);
    if (widgets.has(id)) fail(`a widget called "${id}" already exists`);
    if (typeof def.name !== 'string' || !def.name) fail(`"${id}" needs a name`);
    if (typeof def.mount !== 'function') fail(`"${id}" needs a mount(ctx) function`);
    const settings = def.settings ?? [];
    const defaults = def.defaults ?? {};
    if (!Array.isArray(settings)) fail(`"${id}".settings must be a list`);
    if (!isObj(defaults)) fail(`"${id}".defaults must be an object`);
    // A setting is the widget's own (it has a default here) or a core one it shows in its section;
    // the dashboard checks the latter when it starts, once all defaults are known.
    for (const key of keysOf(settings)) if (!/^[A-Z][A-Z0-9_]*$/.test(key)) fail(`"${id}": setting names are UPPER_CASE (got "${key}")`);
    for (const key of Object.keys(defaults)) if (!/^[A-Z][A-Z0-9_]*$/.test(key)) fail(`"${id}": default names are UPPER_CASE (got "${key}")`);
    for (const k of ['state', 'reads', 'integrations']) if (def[k] != null && !Array.isArray(def[k])) fail(`"${id}".${k} must be a list`);
    widgets.set(
      id,
      Object.freeze({
        icon: 'layout',
        group: 'Other',
        hidden: false,
        variants: {},
        fields: {},
        state: [],
        reads: [],
        integrations: [],
        ...def,
        settings,
        defaults,
        folder,
      }),
    );
  }

  /** Pure helpers, usable anywhere in a widget file (also as ctx.util). */
  const pad2 = (n) => String(n).padStart(2, '0');
  const util = Object.freeze({
    pad2,
    hostOf: (url) => {
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    },
    /** "07:30" → 450 (minutes after midnight), else null. */
    parseHM: (s) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim());
      return m ? +m[1] * 60 + +m[2] : null;
    },
    minutesOfDay: (d = new Date()) => d.getHours() * 60 + d.getMinutes(),
    startOfDay: (d) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x;
    },
    addDays: (d, n) => {
      const x = new Date(d);
      x.setDate(x.getDate() + n);
      return x;
    },
    /** Local date → "2026-03-18". */
    ymd: (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    /** "2026-03-18…" → local midnight of that day, else null. */
    parseYMD: (s) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
      return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    },
    /** Stable 32-bit hash of a string (FNV-1a). */
    hash: (s) => {
      let x = 2166136261;
      for (let i = 0; i < s.length; i++) {
        x ^= s.charCodeAt(i);
        x = Math.imul(x, 16777619);
      }
      return x >>> 0;
    },
    /** "Name | #color | url" → ['Name', '#color', 'url'] */
    pipe: (line) =>
      String(line)
        .split('|')
        .map((s) => s.trim()),
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    /** "#fbbf24" → "251, 191, 36" (for rgba(var(--x-rgb), .5)), else null. */
    hexToRgb: (hex) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}`;
    },
    uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    /** Colours for calendars, people, series… when none is given. */
    PALETTE: Object.freeze(['#8b9cff', '#5eead4', '#fbbf24', '#fb7185', '#c4b5fd', '#34d399', '#7dd3fc', '#f9a8d4']),
  });

  window.OMD = Object.freeze({
    util,
    defineWidget,
    icons(map) {
      if (isObj(map)) Object.assign(icons, map);
    },
    configure({ defaults, layouts } = {}) {
      if (isObj(defaults)) Object.assign(user.defaults, defaults);
      if (isObj(layouts)) Object.assign(user.layouts, layouts);
    },
    /** Build wrapper around each widget folder's script. */
    _load(name, fn) {
      folder = name;
      loaded.add(name);
      try {
        fn();
      } catch (e) {
        loadErrors.set(name, e);
        console.error(`Widget "${name}" failed to load:`, e);
      } finally {
        folder = null;
      }
    },
    /** Written by the build after the widget scripts: which lines of the page belong to which widget. */
    _manifest(m) {
      manifest = m || manifest;
    },
    _internal: internal,
  });
})();
