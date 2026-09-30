/* ==========================================================================
   SCREEN MANAGER — tabs, swipe, rotation, time-of-day schedule
   ========================================================================== */
const app = $('#app'),
  screensHost = $('#screens'),
  tabsHost = $('#screenTabs');
const screenDefs = cfg.SCREENS.map((id) => id.trim().toLowerCase())
  .filter((id, i, a) => LAYOUTS[id] && a.indexOf(id) === i)
  .map((id) => ({ id, ...LAYOUTS[id] }));
if (!screenDefs.length) screenDefs.push({ id: 'hub', ...LAYOUTS.hub });
const builtScreens = new Map();
let currentIdx = -1,
  lastInteraction = 0,
  shownAt = Date.now(),
  pinnedBySchedule = null;

/* ---------- Layouts as split trees ----------
   Each screen's LAYOUTS areas are turned into a tree of row/column splits, like a tiling
   window manager: a split only sizes its own children, so resizing a widget never moves
   one in another column. Panels stay where they are in the page (absolutely positioned),
   so swapping never reloads an iframe. Overrides are per device AND per orientation, kept in
   the cloud "layouts" state so they survive a reset of the browser:
     { devices: { [deviceId]: { name, at, screens: { [screenId]: {
         [landscape | narrow | short | portrait]: { tree, widgets: { slot: spec }, heads: { slot: false } } } } } } }
   (Older versions shared one { [screenId]: { trees, widgets, heads } } between all devices — see fromLegacy.)
   node = { dir: 'row' | 'col', kids: [node…] } | { id: position, slot: widget shown there }
   sized within its parent by { fr, min } | { px } | { auto } (content height). */
const layoutStore = sharedState('layouts', {});
const ORIENTS = ['landscape', 'narrow', 'short', 'portrait'];
/** Phones show the portrait (or landscape) layout stacked; everything else edits its own orientation. */
const layoutOrient = (def, o = currentOrient(def)) => (o === 'stacked' ? (def.portrait ? 'portrait' : 'landscape') : o);
/**
 * The shared layout of older versions, as this device's starting point: a device that already
 * showed it keeps showing it until edited or reset; a device new to the dashboard starts clean.
 */
function fromLegacy(st) {
  if (device.cleanLayouts) return {};
  const out = {};
  for (const [id, v] of Object.entries(st || {})) {
    if (id === 'devices' || !v || typeof v !== 'object') continue;
    const per = {};
    for (const o of ORIENTS) {
      if (!v.trees?.[o] && !v.widgets && !v.heads) continue;
      per[o] = structuredClone({ tree: v.trees?.[o], widgets: v.widgets, heads: v.heads });
    }
    if (Object.keys(per).length) out[id] = per;
  }
  return out;
}
/** This device's overrides for one screen in one orientation: { tree?, widgets?, heads? }. */
function layoutEntry(def, o = layoutOrient(def)) {
  const st = layoutStore.get(),
    mine = st.devices?.[device.id];
  return (mine ? mine.screens : fromLegacy(st))?.[def.id]?.[o] || {};
}
const MQ_PORTRAIT = '(orientation: portrait) and (min-width: 600px)';
const MQ_STACKED = '(max-width: 599px), (orientation: landscape) and (max-height: 480px)';
// Short landscape screens, e.g. a 10" tablet rendering at 2× density (1000×600 CSS px).
const MQ_SHORT = '(orientation: landscape) and (min-height: 481px) and (max-height: 680px)';
const MQ_NARROW = '(orientation: landscape) and (max-aspect-ratio: 3/2)';
function currentOrient(def = screenDefs[currentIdx]) {
  if (matchMedia(MQ_STACKED).matches) return 'stacked';
  if (matchMedia(MQ_PORTRAIT).matches && def?.portrait) return 'portrait';
  if (def?.short && matchMedia(MQ_SHORT).matches) return 'short';
  if (def?.narrow && matchMedia(MQ_NARROW).matches) return 'narrow';
  return 'landscape';
}
/** Split a grid-template track list at top-level spaces: "minmax(0,1fr) auto" → 2 tracks. */
function splitTracks(s) {
  const out = [];
  let depth = 0,
    cur = '';
  for (const ch of String(s).trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function baseTemplate(def, orient) {
  if (orient === 'portrait' && def.portrait) return def.portrait;
  if (orient === 'short' && def.short) return { ...def.landscape, ...def.short };
  if (orient === 'narrow' && def.narrow) return { ...def.landscape, ...def.narrow };
  return def.landscape;
}
/** "minmax(250px,1.1fr)" → { fr: 1.1, min: 250 } · "auto" → { auto } · "200px" → { px: 200 } · "30%" → { pct: 30 } */
function parseTrack(t) {
  const m = /^minmax\(\s*([^,]+?)\s*,\s*(.+?)\s*\)$/.exec(t);
  const min = m && /px$/.test(m[1]) ? parseFloat(m[1]) : 0,
    v = m ? m[2] : t;
  if (v === 'auto') return { auto: true, min };
  if (/px$/.test(v)) return { px: parseFloat(v) };
  if (/%$/.test(v)) return { pct: parseFloat(v), min };
  return { fr: parseFloat(v) || 1, min };
}
function parseTracks(s) {
  const t = splitTracks(s).map(parseTrack);
  // Percentages become fr weights relative to the fr tracks ("1fr 30%" → 30 % of the width).
  const pct = t.reduce((a, x) => a + (x.pct || 0), 0),
    fr = t.reduce((a, x) => a + (x.fr || 0), 0) || 1;
  return t.map((x) => (x.pct != null ? { fr: (x.pct / Math.max(1, 100 - pct)) * fr, min: x.min } : x));
}
/** Size of a child spanning several tracks. */
function spanSize(tracks) {
  const min = tracks.reduce((a, t) => a + (t.min || t.px || 0), 0);
  if (tracks.some((t) => t.fr != null)) return { fr: +tracks.reduce((a, t) => a + (t.fr || 0), 0).toFixed(3), ...(min ? { min } : {}) };
  if (tracks.every((t) => t.px != null)) return { px: min };
  return { auto: true };
}
const treeCache = new Map();
/** LAYOUTS areas → split tree: straight cuts, full-width bands first, then columns. */
function baseTree(def, orient) {
  const key = `${def.id}:${orient}`;
  if (treeCache.has(key)) return treeCache.get(key);
  const L = baseTemplate(def, orient);
  const cells = L.areas.map(splitTracks),
    rows = parseTracks(L.rows),
    cols = parseTracks(L.cols);
  const same = (a, b) => a === b && a !== '.';
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  function rect(r0, r1, c0, c1) {
    const names = new Set(range(r0, r1).flatMap((r) => range(c0, c1).map((c) => cells[r][c])));
    if (names.size === 1) {
      const n = [...names][0];
      return n === '.' ? { id: null } : { id: n, slot: n };
    }
    const hc = range(r0 + 1, r1).filter((r) => range(c0, c1).every((c) => !same(cells[r - 1][c], cells[r][c])));
    const vc = range(c0 + 1, c1).filter((c) => range(r0, r1).every((r) => !same(cells[r][c - 1], cells[r][c])));
    if (!hc.length && !vc.length) {
      console.warn(`Layout "${def.id}" (${orient}) can't be cut into straight splits; using one widget for the block`);
      return { id: cells[r0][c0], slot: cells[r0][c0] };
    }
    const byRows = hc.length > 0,
      edges = byRows ? [r0, ...hc, r1] : [c0, ...vc, c1];
    return {
      dir: byRows ? 'col' : 'row',
      kids: edges.slice(0, -1).map((a, i) => ({
        ...(byRows ? rect(a, edges[i + 1], c0, c1) : rect(r0, r1, a, edges[i + 1])),
        ...spanSize((byRows ? rows : cols).slice(a, edges[i + 1])),
      })),
    };
  }
  const tree = rect(0, cells.length, 0, cells[0].length);
  treeCache.set(key, tree);
  return tree;
}
const leaves = (n, out = []) => {
  if (n.kids) n.kids.forEach((k) => leaves(k, out));
  else if (n.id) out.push(n);
  return out;
};
const pathTo = (root, target, p = []) => {
  if (root === target) return p;
  for (let i = 0; i < (root.kids || []).length; i++) {
    const r = pathTo(root.kids[i], target, [...p, i]);
    if (r) return r;
  }
  return null;
};
const nodeAt = (root, path) => path.reduce((n, i) => n.kids[i], root);
/** The widget a slot shows: the one picked in the editor, or the one in LAYOUTS. */
function specFor(def, slot, o) {
  const s = layoutEntry(def, o).widgets?.[slot];
  return s && widgetDef(s.type) ? s : def.blocks?.[slot];
}
/** Every slot of a screen: the LAYOUTS ones plus widgets added in the editor. */
const slotsOf = (def, o) =>
  [...new Set([...Object.keys(def.blocks || {}), ...Object.keys(layoutEntry(def, o).widgets || {})])].filter((s) => specFor(def, s, o));
/** The saved tree for this orientation while every widget in it still exists, else the default. */
function treeFor(def, orient) {
  const base = baseTree(def, orient),
    saved = layoutEntry(def, orient).tree;
  if (!saved) return base;
  const known = new Set(slotsOf(def, orient)),
    ls = leaves(saved);
  const unique = (arr) => new Set(arr).size === arr.length;
  const ok = ls.length > 0 && ls.every((l) => known.has(l.slot)) && unique(ls.map((l) => l.slot)) && unique(ls.map((l) => l.id));
  return ok ? saved : base;
}

const MIN_W = 140,
  MIN_H = 64;
/** Smallest size of a child along an axis. `min` (from minmax()) applies along its parent's axis only. */
function minSize(n, horiz, gap, alongParent = true) {
  const own = alongParent ? n.min || 0 : 0;
  if (!n.kids) return n.id ? Math.max(own, horiz ? MIN_W : MIN_H) : own;
  const along = (n.dir === 'row') === horiz;
  const m = n.kids.map((k) => minSize(k, horiz, gap, along));
  return Math.max(own, along ? m.reduce((a, b) => a + b, 0) + gap * (m.length - 1) : Math.max(...m));
}
/** Content height of an "auto" child at a given width. */
function naturalH(n, w, panels, gap) {
  if (!n.kids) {
    const p = n.id && panels.get(n.slot);
    if (!p) return 0;
    p.style.setProperty('--w', `${w}px`);
    p.style.setProperty('--h', 'auto');
    return Math.max(MIN_H, p.offsetHeight);
  }
  if (n.dir === 'col') return n.kids.reduce((a, k) => a + naturalH(k, w, panels, gap), 0) + gap * (n.kids.length - 1);
  const each = (w - gap * (n.kids.length - 1)) / n.kids.length;
  return Math.max(...n.kids.map((k) => naturalH(k, each, panels, gap)));
}
function place(n, x, y, w, h, gap, panels, rects) {
  rects.set(n, { x, y, w, h });
  if (!n.kids) return;
  const horiz = n.dir === 'row',
    avail = (horiz ? w : h) - gap * (n.kids.length - 1);
  const size = n.kids.map((k) => (k.px != null ? k.px : k.auto && !horiz ? naturalH(k, w, panels, gap) : null));
  const mins = n.kids.map((k) => minSize(k, horiz, gap));
  let free = avail - size.reduce((a, s) => a + (s ?? 0), 0);
  let flex = n.kids.map((_, i) => i).filter((i) => size[i] == null);
  const weight = (i) => n.kids[i].fr || 1;
  // Share what's left by fr weight; a child that would end up below its minimum gets the minimum.
  for (let again = true; again && flex.length;) {
    again = false;
    const tot = flex.reduce((a, i) => a + weight(i), 0);
    const low = flex.find((i) => (free * weight(i)) / tot < mins[i]);
    if (low != null) {
      size[low] = mins[low];
      free -= mins[low];
      flex = flex.filter((j) => j !== low);
      again = true;
    }
  }
  const tot = flex.reduce((a, i) => a + weight(i), 0);
  flex.forEach((i) => {
    size[i] = Math.max(0, (free * weight(i)) / tot);
  });
  // Fixed sizes that don't fit shrink proportionally (e.g. a saved height on a smaller screen).
  const sum = size.reduce((a, b) => a + b, 0);
  if (sum > avail + 0.5)
    size.forEach((s, i) => {
      size[i] = (s * avail) / sum;
    });
  let pos = horiz ? x : y;
  n.kids.forEach((k, i) => {
    place(k, horiz ? pos : x, horiz ? y : pos, horiz ? size[i] : w, horiz ? h : size[i], gap, panels, rects);
    pos += size[i] + gap;
  });
}
/** Position every panel of a screen from its tree (or let CSS stack them on phones). */
function layoutScreen(def, grid) {
  const orient = currentOrient(def),
    lo = layoutOrient(def, orient);
  // Turned the device: this orientation may show other widgets.
  if (grid._orient && grid._orient !== lo && !grid._draft) {
    grid._orient = lo;
    syncWidgets(def, grid);
  }
  grid._orient = lo;
  // Phones stack widgets in the portrait layout's reading order (clock first on Home).
  const tree = grid._draft || treeFor(def, lo);
  parkHidden(def, grid, tree);
  const panels = new Map([...grid.querySelectorAll(':scope > [data-block]')].map((p) => [p.dataset.block, p]));
  const at = new Map(leaves(tree).map((l, i) => [l.slot, { leaf: l, i }]));
  const heads = layoutEntry(def, lo).heads || {};
  panels.forEach((p, slot) => {
    const a = at.get(slot);
    p.classList.toggle('is-off', !a); // widgets a variant leaves out are hidden there
    p.classList.toggle('no-head', heads[slot] === false);
    p.dataset.area = a?.leaf.id || '';
    p.style.order = a ? a.i : '';
  });
  grid.classList.toggle('is-tree', orient !== 'stacked');
  if (orient === 'stacked') {
    grid._layout = null;
    return;
  }
  const gap = parseFloat(getComputedStyle(grid).rowGap) || 0,
    rects = new Map();
  place(tree, 0, 0, grid.clientWidth, grid.clientHeight, gap, panels, rects);
  for (const l of leaves(tree)) {
    const p = panels.get(l.slot),
      r = rects.get(l);
    if (!p || !r) continue;
    p.style.setProperty('--x', `${r.x.toFixed(1)}px`);
    p.style.setProperty('--y', `${r.y.toFixed(1)}px`);
    p.style.setProperty('--w', `${r.w.toFixed(1)}px`);
    p.style.setProperty('--h', `${r.h.toFixed(1)}px`);
  }
  grid._layout = { tree, rects, gap, orient };
  if (editing && !grid._draft && grid === activeGrid()) refreshEditUI();
}
/** A slot the current layout doesn't show (removed, or left out in this orientation): nothing runs there. */
const parkedNode = (slot) => h('div', { class: 'panel is-off is-parked', 'data-block': slot, 'aria-hidden': 'true' });
/** Mount the widgets this layout shows; park the others, which stops their timers and feeds. */
function parkHidden(def, grid, tree) {
  const shown = new Set(leaves(tree).map((l) => l.slot));
  grid.querySelectorAll(':scope > [data-block]').forEach((p) => {
    const slot = p.dataset.block,
      parked = p.classList.contains('is-parked');
    if (!shown.has(slot) && !parked) {
      unmountNode(p);
      p.replaceWith(parkedNode(slot));
    } else if (shown.has(slot) && parked) mountWidget(def, grid, slot);
  });
}
function mountWidget(def, grid, slot) {
  const spec = specFor(def, slot);
  const old = grid.querySelector(`:scope > [data-block="${CSS.escape(slot)}"]`);
  unmountNode(old); // its timers, listeners and subscriptions stop here
  const node = mountSpec(spec);
  node.dataset.block = slot;
  node.dataset.spec = JSON.stringify(spec);
  if (old) old.replaceWith(node);
  else grid.append(node);
  hydrateIcons(node);
}

function buildScreen(def) {
  const el = h('section', { class: 'screen', 'data-screen': def.id, 'aria-label': `${def.name} screen` });
  if (def.photo) {
    const ph = h('div', { class: 'screen-photo' });
    slideshow(ph);
    el.append(ph);
  }
  const grid = h('div', { class: 'grid' });
  slotsOf(def).forEach((slot) => grid.append(parkedNode(slot))); // layoutScreen mounts the ones on screen
  el.append(grid);
  screensHost.append(el);
  hydrateIcons(el);
  layoutScreen(def, grid);
  new ResizeObserver(() => layoutScreen(def, grid)).observe(grid);
  grid._def = def;
  // Content-sized ("auto") slots settle once fonts and first data have arrived.
  [1500, 6000].forEach((ms) => setTimeout(() => layoutScreen(def, grid), ms));
  return el;
}

function showScreen(i, { direction = 1 } = {}) {
  const n = screenDefs.length;
  i = ((i % n) + n) % n;
  if (i === currentIdx) return;
  setExpanded(null, false);
  const def = screenDefs[i];
  let el = builtScreens.get(def.id);
  if (!el) {
    el = buildScreen(def);
    builtScreens.set(def.id, el);
    void el.offsetWidth;
  }
  builtScreens.forEach((s, id) => {
    if (id === def.id) {
      s.style.setProperty('--enter', `${direction * 24}px`);
      s.classList.add('is-active');
    } else if (s.classList.contains('is-active')) {
      s.style.setProperty('--enter', `${-direction * 24}px`);
      s.classList.remove('is-active');
    }
  });
  currentIdx = i;
  shownAt = Date.now();
  layoutScreen(def, el.querySelector(':scope > .grid'));
  app.classList.toggle('statusbar-auto', def.statusbar === false);
  app.classList.toggle('has-photo-screen', !!def.photo);
  app.classList.remove('show-bar');
  tabsHost.querySelectorAll('.screen-tab').forEach((t, j) => {
    t.classList.toggle('is-active', j === i);
    t.setAttribute('aria-selected', String(j === i));
  });
  try {
    history.replaceState(null, '', `${location.pathname}${location.search}#${def.id}`);
  } catch {
    /* file:// in some browsers */
  }
  requestAnimationFrame(resumeVisible); // paused feeds / iframes on this screen catch up
  if (editing) requestAnimationFrame(refreshEditUI);
}
// A widget that failed (or was retried) was swapped in place: re-measure its screen.
bus.addEventListener('widget-swapped', (e) => {
  const grid = e.detail?.parentElement;
  if (grid?._def) layoutScreen(grid._def, grid);
});
const noteInteraction = () => {
  lastInteraction = Date.now();
};

function initScreens() {
  tabsHost.hidden = screenDefs.length < 2;
  screenDefs.forEach((d, j) =>
    tabsHost.append(
      h(
        'button',
        {
          type: 'button',
          class: 'screen-tab',
          role: 'tab',
          'aria-selected': 'false',
          title: d.name,
          onclick: () => {
            noteInteraction();
            showScreen(j, { direction: j > currentIdx ? 1 : -1 });
          },
        },
        icon(d.icon || 'layout'),
        h('span', { class: 'tab-label' }, d.name),
      ),
    ),
  );

  const byId = (id) => screenDefs.findIndex((d) => d.id === id);
  const fromHash = byId(location.hash.slice(1).toLowerCase());
  const startIdx = Math.max(0, byId(cfg.START_SCREEN.toLowerCase()));
  showScreen(fromHash >= 0 ? fromHash : startIdx);

  window.addEventListener('hashchange', () => {
    const j = byId(location.hash.slice(1).toLowerCase());
    if (j >= 0) showScreen(j);
  });
  $('#btnEdit').addEventListener('click', () => setEditing(!editing));

  // Swipe between screens (iframes keep their own touch handling).
  let sx = 0,
    sy = 0,
    st = 0,
    tracking = false;
  screensHost.style.touchAction = 'pan-y';
  screensHost.addEventListener(
    'pointerdown',
    (e) => {
      noteInteraction();
      tracking = !editing && !e.target.closest('input, textarea, .panel.is-expanded') && (e.pointerType !== 'mouse' || e.button === 0);
      sx = e.clientX;
      sy = e.clientY;
      st = Date.now();
      if (app.classList.contains('statusbar-auto')) {
        app.classList.add('show-bar');
        clearTimeout(screensHost._barTimer);
        screensHost._barTimer = setTimeout(() => app.classList.remove('show-bar'), 6000);
      }
    },
    { passive: true },
  );
  screensHost.addEventListener(
    'pointerup',
    (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - sx,
        dy = e.clientY - sy;
      if (Math.abs(dx) > 90 && Math.abs(dy) < 70 && Date.now() - st < 800) showScreen(currentIdx + (dx < 0 ? 1 : -1), { direction: dx < 0 ? 1 : -1 });
    },
    { passive: true },
  );
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'ArrowRight') {
      noteInteraction();
      showScreen(currentIdx + 1);
    }
    if (e.key === 'ArrowLeft') {
      noteInteraction();
      showScreen(currentIdx - 1, { direction: -1 });
    }
  });

  // Time-of-day schedule: "screen | HH:MM-HH:MM | Mon-Fri"
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const parseDays = (spec) => {
    if (!spec) return null;
    const set = new Set();
    for (const part of spec.toLowerCase().split(',')) {
      const [a, b] = part.split('-').map((s) => DAYS.indexOf(s.trim().slice(0, 3)));
      if (a < 0) continue;
      for (let d = a; ; d = (d + 1) % 7) {
        set.add(d);
        if (d === (b >= 0 ? b : a)) break;
      }
    }
    return set;
  };
  const schedule = cfg.SCREEN_SCHEDULE.map(pipe)
    .map(([id, range, days]) => {
      const [s, e] = (range || '').split('-').map(parseHM);
      return { idx: byId((id || '').toLowerCase()), s, e, days: parseDays(days) };
    })
    .filter((r) => r.idx >= 0 && r.s != null && r.e != null);
  function applySchedule() {
    const now = new Date(),
      m = minutesOfDay(now);
    const hit = schedule.find((r) => {
      const overnight = r.s > r.e;
      if (!(overnight ? m >= r.s || m < r.e : m >= r.s && m < r.e)) return false;
      const day = overnight && m < r.e ? (now.getDay() + 6) % 7 : now.getDay(); // overnight windows belong to their start day
      return !r.days || r.days.has(day);
    });
    const pin = hit ? hit.idx : null;
    if (pin !== pinnedBySchedule) {
      pinnedBySchedule = pin;
      showScreen(pin ?? startIdx);
    }
  }
  if (schedule.length) {
    applySchedule();
    setInterval(applySchedule, 30000);
  }

  // Auto-rotation (paused for 2 minutes after any touch, while a panel is expanded, or settings are open)
  onTick(() => {
    const rot = cfg.SCREEN_ROTATE_SEC;
    if (!(rot > 0) || screenDefs.length < 2 || pinnedBySchedule != null) return;
    if (editing || Date.now() - lastInteraction < 120000 || document.querySelector('.panel.is-expanded') || $('#settings').classList.contains('is-open')) {
      shownAt = Date.now();
      return;
    }
    if (Date.now() - shownAt >= rot * 1000) showScreen(currentIdx + 1);
  });
}
