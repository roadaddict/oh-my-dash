/* ---------- Layout editor: drag handles to resize · tap two widgets to swap · Change to pick another ---------- */
let editing = false,
  selected = null;
const editBar = h(
  'div',
  { class: 'edit-bar', hidden: true, role: 'toolbar', 'aria-label': 'Layout editor' },
  h(
    'span',
    null,
    icon('dashboard'),
    h('b', null, 'Edit layout'),
    h('span', { class: 'edit-hint' }, ' · drag the yellow handles · tap two widgets to swap · change, add or remove widgets'),
  ),
  h('span', { class: 'edit-screen-rows' }),
  h('button', { class: 'btn', type: 'button', onclick: () => resetLayout() }, 'Reset screen'),
  h('button', { class: 'btn btn-primary', type: 'button', onclick: () => setEditing(false) }, icon('check'), 'Done'),
);
document.body.append(editBar);

function setEditing(on) {
  if (on && currentOrient() === 'stacked') {
    toast('Use landscape or a larger screen to edit the layout');
    return;
  }
  editing = on;
  selected = null;
  setExpanded(null, false);
  closeSettings();
  app.classList.toggle('is-editing', on);
  editBar.hidden = !on;
  brandName.title = on ? 'Tap to rename the dashboard' : '';
  refreshEditUI();
}
const activeGrid = () => builtScreens.get(screenDefs[currentIdx]?.id)?.querySelector(':scope > .grid');
/** Change this device's layout of one screen in the current orientation; fn gets { tree, widgets, heads }. */
function saveLayout(def, fn, o = layoutOrient(def)) {
  layoutStore.update((l) => {
    l ||= {};
    const devs = (l.devices ||= {});
    // First edit on this device: start from what it was showing.
    const me = (devs[device.id] ||= { screens: fromLegacy(l) });
    me.name = device.name;
    me.at = Date.now();
    const screen = (me.screens[def.id] ||= {});
    fn((screen[o] ||= {}));
    for (const k of ['widgets', 'heads']) if (screen[o][k] && !Object.keys(screen[o][k]).length) delete screen[o][k];
    if (!Object.keys(screen[o]).length) delete screen[o];
    if (!Object.keys(screen).length) delete me.screens[def.id];
    // Devices not seen for half a year (wiped browsers, old phones) are forgotten.
    for (const [id, d] of Object.entries(devs)) if (id !== device.id && Date.now() - (d.at || 0) > 180 * 864e5) delete devs[id];
    return l;
  });
}
/** Edit layer on top of everything (iframes included): a tile per widget + a handle per split. */
function refreshEditUI() {
  document.querySelectorAll('.edit-layer').forEach((n) => n.remove());
  const grid = activeGrid();
  if (!editing || !grid?._layout) return;
  const { tree, rects, gap } = grid._layout;
  const layer = h('div', { class: 'edit-layer' });
  const box = (r) => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  for (const l of leaves(tree)) {
    const p = grid.querySelector(`:scope > [data-block="${CSS.escape(l.slot)}"]`);
    const hasHead = !!p?.querySelector(':scope > .panel-head'),
      headOn = !p?.classList.contains('no-head');
    layer.append(
      h(
        'div',
        {
          class: `edit-tile${selected === l.slot ? ' is-selected' : ''}`,
          style: box(rects.get(l)),
          role: 'button',
          tabindex: 0,
          'data-slot': l.slot,
          'aria-pressed': String(selected === l.slot),
          onclick: () => pick(l.slot),
          onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              pick(l.slot);
            }
          },
        },
        hasHead
          ? h(
              'button',
              {
                class: 'edit-switch',
                type: 'button',
                role: 'switch',
                'aria-checked': String(headOn),
                title: headOn ? 'Hide the header' : 'Show the header',
                onclick: (e) => {
                  e.stopPropagation();
                  setHead(l.slot, !headOn);
                },
              },
              h('i'),
              h('span', null, 'Header'),
            )
          : null,
        h('span', { class: 'edit-name' }, p?.getAttribute('aria-label') || l.slot),
        h(
          'div',
          { class: 'edit-actions' },
          editAction('change', 'layout', 'Change', () => openPicker(l.slot)),
          editAction('add-right', 'columns', 'Add right', () => startAdd(l.slot, 'row')),
          editAction('add-below', 'rows', 'Add below', () => startAdd(l.slot, 'col')),
          editAction('remove', 'trash', 'Remove', () => removeWidget(l.slot)),
        ),
      ),
    );
  }
  // Rows per column: every child of a side-by-side split is a column (plus the screen itself
  // when it's made of full-width bands).
  const stepper = (col, screen) => {
    const r = rects.get(col),
      n = rowCount(col),
      last = col.kids ? col.kids[col.kids.length - 1] : col;
    const canAdd = n < MAX_ROWS && (screen || r.h >= (n + 1) * MIN_H + n * gap);
    const canDrop = n > 1 && !last.kids;
    return h(
      'div',
      { class: 'edit-rows', role: 'group', 'aria-label': screen ? 'Full-width rows on this screen' : 'Rows in this column' },
      h(
        'button',
        {
          type: 'button',
          'aria-label': 'One row less',
          disabled: !(screen ? canDrop : n > 0 && !last.kids && leaves(tree).length > 1),
          onclick: (e) => {
            e.stopPropagation();
            if (last.kids) return;
            if (last.id) removeWidget(last.slot);
            else removeNode(col, last);
          },
        },
        '−',
      ),
      h('span', null, `${screen ? 'Screen: ' : ''}${n} ${n === 1 ? 'row' : 'rows'}`),
      h(
        'button',
        {
          type: 'button',
          'aria-label': 'One row more',
          disabled: !canAdd,
          onclick: (e) => {
            e.stopPropagation();
            openPicker(null, 'col', col);
          },
        },
        '+',
      ),
    );
  };
  // Each main column: a faint outline around it and its control just inside its bottom edge
  // (where + adds the new row). Full-width rows of the whole screen: control in the edit bar.
  for (const col of columnsOf(tree)) {
    if (col === tree) continue;
    const r = rects.get(col);
    layer.append(h('div', { class: 'edit-col', style: { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` } }));
    const st = stepper(col, false);
    Object.assign(st.style, { left: `${r.x + r.w / 2}px`, top: `${r.y + r.h - 42}px` });
    layer.append(st);
  }
  editBar.querySelector('.edit-screen-rows').replaceChildren(stepper(tree, true));
  (function handles(n) {
    if (!n.kids) return;
    const R = rects.get(n),
      horiz = n.dir === 'row';
    for (let i = 0; i < n.kids.length - 1; i++) {
      const a = rects.get(n.kids[i]),
        at = (horiz ? a.x + a.w : a.y + a.h) + gap / 2;
      const style = horiz ? { left: `${at - 11}px`, top: `${R.y}px`, height: `${R.h}px` } : { top: `${at - 11}px`, left: `${R.x}px`, width: `${R.w}px` };
      const g = h('div', { class: `gutter gutter-${horiz ? 'col' : 'row'}`, role: 'separator', 'aria-label': 'Drag to resize', style });
      g.addEventListener('pointerdown', (e) => dragGutter(e, n, i, g));
      layer.append(g);
    }
    n.kids.forEach(handles);
  })(tree);
  grid.append(layer);
}
const editAction = (act, ic, label, fn) =>
  h(
    'button',
    {
      class: 'edit-change',
      type: 'button',
      'data-act': act,
      title: label,
      'aria-label': label,
      onclick: (e) => {
        e.stopPropagation();
        fn();
      },
    },
    icon(ic),
    h('span', null, label),
  );
/** Widget edges land on this grid (px from the screen's top-left) while resizing. */
const SNAP = 10;
/** Drag the boundary between children i and i+1 of one split. Nothing outside that split moves. */
function dragGutter(e, node, i, handle) {
  e.preventDefault();
  e.stopPropagation();
  handle.setPointerCapture(e.pointerId);
  const grid = activeGrid(),
    def = screenDefs[currentIdx],
    { tree, rects, gap, orient } = grid._layout;
  const horiz = node.dir === 'row',
    path = pathTo(tree, node);
  const base = node.kids.map((k) => (horiz ? rects.get(k).w : rects.get(k).h));
  const mins = node.kids.map((k) => minSize(k, horiz, gap));
  const start = horiz ? e.clientX : e.clientY,
    startPos = parseFloat(handle.style[horiz ? 'left' : 'top']);
  const r0 = rects.get(node.kids[i]),
    edge = horiz ? r0.x + r0.w : r0.y + r0.h; // the edge being dragged
  const draft = structuredClone(tree),
    dnode = nodeAt(draft, path);
  let sizes = base.slice();
  handle.parentElement.classList.add('is-dragging');
  const move = (ev) => {
    const raw = (horiz ? ev.clientX : ev.clientY) - start;
    const req = Math.round((edge + raw) / SNAP) * SNAP - edge,
      dir = Math.sign(req);
    const next = base.slice();
    let need = Math.abs(req);
    // Pushes through: once the neighbour hits its minimum, the next one in this split gives way.
    for (let j = dir > 0 ? i + 1 : i; dir && j >= 0 && j < next.length && need > 0; j += dir) {
      const take = Math.min(need, Math.max(0, next[j] - mins[j]));
      next[j] -= take;
      need -= take;
    }
    const moved = Math.abs(req) - need;
    if (dir > 0) next[i] += moved;
    else if (dir < 0) next[i + 1] += moved;
    sizes = next;
    dnode.kids.forEach((k, j) => {
      delete k.fr;
      delete k.auto;
      k.px = sizes[j];
    });
    grid._draft = draft;
    layoutScreen(def, grid);
    handle.style[horiz ? 'left' : 'top'] = `${startPos + dir * moved}px`;
  };
  const up = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    grid._draft = null;
    if (sizes.every((s, j) => Math.abs(s - base[j]) < 1)) {
      layoutScreen(def, grid);
      return;
    }
    const t = structuredClone(tree),
      n = nodeAt(t, path);
    n.kids.forEach((k, j) => {
      if (k.fr != null) k.fr = +sizes[j].toFixed(1); // flexible: keeps proportions on any screen
      else if (Math.abs(sizes[j] - base[j]) >= 1) {
        delete k.auto;
        k.px = Math.round(sizes[j]);
      }
    });
    saveLayout(
      def,
      (s) => {
        s.tree = t;
      },
      orient,
    );
    layoutScreen(def, grid);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}
/** Tap one widget, then another: they trade places (in this orientation). */
function pick(slot) {
  if (!selected || selected === slot) {
    selected = selected === slot ? null : slot;
    refreshEditUI();
    return;
  }
  const grid = activeGrid(),
    def = screenDefs[currentIdx],
    { tree, orient } = grid._layout;
  const t = structuredClone(tree),
    ls = leaves(t);
  const a = ls.find((l) => l.slot === selected),
    b = ls.find((l) => l.slot === slot);
  selected = null;
  if (!a || !b) {
    refreshEditUI();
    return;
  }
  [a.slot, b.slot] = [b.slot, a.slot];
  saveLayout(
    def,
    (s) => {
      s.tree = t;
    },
    orient,
  );
}

/** Header on/off per widget, on this device in this orientation. Only "off" is stored. */
function setHead(slot, on) {
  saveLayout(screenDefs[currentIdx], (s) => {
    s.heads ||= {};
    if (on) delete s.heads[slot];
    else s.heads[slot] = false;
  });
}

/* ---------- Add / remove widgets: any widget can go on any screen ---------- */
const parentOf = (root, node) => ((root.kids || []).includes(node) ? root : (root.kids || []).map((k) => parentOf(k, node)).find(Boolean) || null);
const SIZE_KEYS = ['fr', 'px', 'auto', 'min'];
const sizeOf = (n) => Object.fromEntries(SIZE_KEYS.filter((k) => n[k] != null).map((k) => [k, n[k]]));
const withoutSize = (n) => Object.fromEntries(Object.entries(n).filter(([k]) => !SIZE_KEYS.includes(k)));
const MAX_ROWS = 4;
/**
 * The screen's main columns: the side-by-side columns of the screen (or of its full-width
 * bands), plus the screen itself when it's made of bands. Sub-columns nested inside a
 * column are edited with Add / Remove on their widgets instead.
 */
function columnsOf(tree) {
  if (tree.dir === 'row') return tree.kids;
  if (tree.dir === 'col') return [tree, ...tree.kids.filter((k) => k.dir === 'row').flatMap((r) => r.kids)];
  return [tree];
}
const rowCount = (n) => (n.dir === 'col' ? n.kids.length : 1);
/** Add a widget as a new bottom row of a column. */
function appendRow(col, spec) {
  const grid = activeGrid(),
    def = screenDefs[currentIdx],
    { tree, orient } = grid._layout;
  const t = structuredClone(tree),
    n = nodeAt(t, pathTo(tree, col));
  const id = `w${uid()}`,
    fresh = { id, slot: id };
  if (n.dir === 'col') {
    const frs = n.kids.map((k) => k.fr).filter((f) => f != null);
    fresh.fr = +(frs.length ? frs.reduce((a, b) => a + b, 0) / frs.length : 1).toFixed(3);
    n.kids.push(fresh);
  } else {
    const size = sizeOf(n),
      inner = {
        dir: 'col',
        kids: [
          { ...withoutSize(n), fr: 1 },
          { ...fresh, fr: 1 },
        ],
      };
    Object.keys(n).forEach((k) => delete n[k]);
    Object.assign(n, inner, size);
  }
  saveLayout(
    def,
    (s) => {
      s.tree = t;
      (s.widgets ||= {})[id] = spec;
    },
    orient,
  );
}
/** Remove an empty spacer row (e.g. the photo gap on Frame). */
function removeNode(col, node) {
  const grid = activeGrid(),
    def = screenDefs[currentIdx],
    { tree, orient } = grid._layout;
  const t = structuredClone(tree),
    c = nodeAt(t, pathTo(tree, col)),
    i = col.kids.indexOf(node);
  const prev = c.kids[i - 1];
  if (prev && prev.fr != null && c.kids[i].fr != null) prev.fr = +(prev.fr + c.kids[i].fr).toFixed(3);
  c.kids.splice(i, 1);
  if (c.kids.length === 1) {
    const only = c.kids[0],
      size = sizeOf(c);
    Object.keys(c).forEach((k) => delete c[k]);
    Object.assign(c, withoutSize(only), size);
  }
  saveLayout(
    def,
    (s) => {
      s.tree = t;
    },
    orient,
  );
}
function startAdd(slot, dir) {
  const grid = activeGrid(),
    { tree, rects, gap } = grid._layout;
  const r = rects.get(leaves(tree).find((l) => l.slot === slot));
  const room = dir === 'row' ? r.w >= 2 * MIN_W + gap : r.h >= 2 * MIN_H + gap;
  if (!room) {
    toast('Not enough room here — make this widget bigger first');
    return;
  }
  openPicker(slot, dir);
}
/** Split a widget's space in two and put the new widget right of / below it. */
function addWidget(slot, dir, spec) {
  const grid = activeGrid(),
    def = screenDefs[currentIdx],
    { tree, orient } = grid._layout;
  const t = structuredClone(tree),
    leaf = leaves(t).find((l) => l.slot === slot),
    parent = parentOf(t, leaf);
  const id = `w${uid()}`,
    fresh = { id, slot: id };
  if (parent && parent.dir === dir) {
    // Same direction as its split: share the widget's size with the newcomer.
    const i = parent.kids.indexOf(leaf);
    if (leaf.px != null) {
      leaf.px = Math.round(leaf.px / 2);
      fresh.px = leaf.px;
    } else if (leaf.auto) fresh.auto = true;
    else {
      leaf.fr = +((leaf.fr || 1) / 2).toFixed(3);
      fresh.fr = leaf.fr;
    }
    parent.kids.splice(i + 1, 0, fresh);
  } else {
    // Otherwise the widget becomes a two-way split of its own space.
    const size = sizeOf(leaf),
      inner = {
        dir,
        kids: [
          { ...withoutSize(leaf), fr: 1 },
          { ...fresh, fr: 1 },
        ],
      };
    Object.keys(leaf).forEach((k) => delete leaf[k]);
    Object.assign(leaf, inner, size);
  }
  saveLayout(
    def,
    (s) => {
      s.tree = t;
      (s.widgets ||= {})[id] = spec;
    },
    orient,
  );
}
function removeWidget(slot) {
  const grid = activeGrid(),
    def = screenDefs[currentIdx],
    { tree, orient } = grid._layout;
  if (leaves(tree).length < 2) {
    toast('A screen needs at least one widget');
    return;
  }
  const t = structuredClone(tree),
    leaf = leaves(t).find((l) => l.slot === slot),
    parent = parentOf(t, leaf);
  // Its space goes back to the widget before it (the one it was added next to), else the next one.
  const i = parent.kids.indexOf(leaf),
    next = parent.kids[i - 1] || parent.kids[i + 1];
  if (leaf.fr != null && next.fr != null) next.fr = +(next.fr + leaf.fr).toFixed(3);
  else if (leaf.px != null && next.px != null) next.px += leaf.px + (grid._layout.gap || 0);
  parent.kids.splice(i, 1);
  if (parent.kids.length === 1) {
    // A split with one child left collapses into that child (keeping the split's size).
    const only = parent.kids[0],
      size = sizeOf(parent);
    Object.keys(parent).forEach((k) => delete parent[k]);
    Object.assign(parent, withoutSize(only), size);
  }
  selected = null;
  saveLayout(
    def,
    (s) => {
      s.tree = t;
      // An added widget is forgotten once it's off this layout.
      if (!def.blocks?.[slot]) {
        delete s.widgets?.[slot];
        delete s.heads?.[slot];
      }
    },
    orient,
  );
}

/* ---------- Change widget: any widget from any screen ---------- */
/** Every widget used on any screen (with its settings), plus the ones no screen uses yet. */
function widgetCatalog() {
  const out = [],
    seen = new Set();
  for (const L of Object.values(LAYOUTS)) {
    for (const spec of Object.values(L.blocks || {})) {
      const k = JSON.stringify(spec);
      if (widgetDef(spec.type) && !seen.has(k)) {
        seen.add(k);
        out.push({ spec, where: L.name });
      }
    }
  }
  for (const d of REG.widgets.values()) if ((DEV || !d.hidden) && !out.some((o) => o.spec.type === d.id)) out.push({ spec: { type: d.id }, where: '' });
  return out;
}
/** The catalog by group (see WIDGET_GROUPS), then by widget name. */
function pickerGroups() {
  const all = widgetCatalog(),
    groups = new Map();
  for (const d of widgetList()) {
    const items = all.filter((o) => o.spec.type === d.id);
    if (items.length) groups.set(d.group, [...(groups.get(d.group) || []), ...items]);
  }
  return [...groups];
}
/** Pick a widget: to replace `slot`'s widget, or (with addDir) to add one next to it. */
function openPicker(slot, addDir = null, col = null) {
  const def = screenDefs[currentIdx],
    orig = slot && def.blocks?.[slot],
    cur = addDir ? '' : JSON.stringify(specFor(def, slot));
  const close = () => sheet.remove();
  const choose = (spec) => {
    close();
    if (col) {
      appendRow(col, spec);
      return;
    }
    if (addDir) {
      addWidget(slot, addDir, spec);
      return;
    }
    saveLayout(def, (s) => {
      s.widgets ||= {};
      if (orig && JSON.stringify(spec) === JSON.stringify(orig)) delete s.widgets[slot];
      else s.widgets[slot] = spec;
    });
  };
  const sheet = h(
    'div',
    { class: 'edit-picker', role: 'dialog', 'aria-label': 'Change widget' },
    h(
      'div',
      { class: 'edit-picker-card' },
      h(
        'div',
        { class: 'edit-picker-head' },
        h(
          'div',
          null,
          h('b', null, col ? 'Add a row' : addDir ? `Add a widget ${addDir === 'row' ? 'to the right' : 'below'}` : 'Change widget'),
          h(
            'small',
            null,
            col ? 'As a new row at the bottom of this column' : addDir ? `Next to ${specLabel(specFor(def, slot))}` : `Now: ${specLabel(JSON.parse(cur))}`,
          ),
        ),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x')),
      ),
      h(
        'div',
        { class: 'edit-picker-list' },
        pickerGroups().map(([name, items]) => [
          h('div', { class: 'edit-pick-group' }, name),
          items.map(({ spec, where }) =>
            h(
              'button',
              {
                type: 'button',
                class: `edit-pick${JSON.stringify(spec) === cur ? ' is-current' : ''}`,
                onclick: () => choose(spec),
              },
              icon(widgetDef(spec.type)?.icon || 'layout'),
              h('span', null, h('b', null, specLabel(spec)), h('small', null, where ? `as on ${where}` : 'not on any screen yet')),
            ),
          ),
        ]),
      ),
      !addDir && orig && JSON.stringify(orig) !== cur
        ? h('button', { class: 'btn', type: 'button', onclick: () => choose(orig) }, `Restore ${specLabel(orig)}`)
        : null,
    ),
  );
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  document.body.append(sheet);
}
/** Back to the default for this screen, on this device, in this orientation. */
function resetLayout() {
  const def = screenDefs[currentIdx],
    o = layoutOrient(def);
  saveLayout(
    def,
    (s) => {
      Object.keys(s).forEach((k) => delete s[k]);
    },
    o,
  );
  toast(`${def.name} reset (${o}, this device)`);
}
/** Mount widgets whose spec changed, add new slots, drop slots this layout no longer has. */
function syncWidgets(def, grid) {
  const slots = slotsOf(def);
  for (const slot of slots) {
    const p = grid.querySelector(`:scope > [data-block="${CSS.escape(slot)}"]`);
    if (!p) grid.append(parkedNode(slot)); // new slot: layoutScreen mounts it if it's on screen
    else if (!p.classList.contains('is-parked') && p.dataset.spec !== JSON.stringify(specFor(def, slot))) mountWidget(def, grid, slot);
  }
  grid.querySelectorAll(':scope > [data-block]').forEach((p) => {
    if (!slots.includes(p.dataset.block)) {
      unmountNode(p);
      p.remove();
    }
  });
}
bus.addEventListener('layouts', () => {
  builtScreens.forEach((el, id) => {
    const def = screenDefs.find((d) => d.id === id),
      grid = el.querySelector(':scope > .grid');
    syncWidgets(def, grid);
    layoutScreen(def, grid);
  });
  if (editing) requestAnimationFrame(refreshEditUI);
});
window.addEventListener('resize', () => {
  if (editing && currentOrient() === 'stacked') setEditing(false);
});
