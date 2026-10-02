/* ==========================================================================
   GLASS — the frosted look over photos, without a live blur.
   A live `backdrop-filter` re-blurs everything behind a panel every frame while
   the photo behind it moves (Ken Burns zoom, cross-fades) — the most expensive
   thing an old tablet's graphics chip can be asked to do. Instead, each photo is
   blurred ONCE, into a small copy (a few KB), shown in one layer right above the
   photo with the same zoom animation, and clipped to the panels' shapes. Moving
   a layer is nearly free; blurring is not.
   Over the plain dark background there's nothing to blur (the glass differs by at
   most 8/255 from the live blur there), so panels simply have no blur at all.
   ========================================================================== */
const GLASS_SCALE = 16; // the copy is 1/16 of the screen: scaling it up does most of the blurring
const glassCopies = new Map(); // src + size → data URL (or null: the photo's host forbids reading it)

/** A small, blurred, slightly saturated copy of a loaded image, cropped like the slide shows it. */
function blurredCopy(img, w, h, fit) {
  const key = `${img.src}|${Math.round(w)}x${Math.round(h)}|${fit}`;
  if (glassCopies.has(key)) return glassCopies.get(key);
  let url = null;
  try {
    const c = document.createElement('canvas');
    c.width = Math.max(8, Math.round(w / GLASS_SCALE));
    c.height = Math.max(8, Math.round(h / GLASS_SCALE));
    const x = c.getContext('2d');
    const iw = img.naturalWidth,
      ih = img.naturalHeight;
    const draw = (mode) => {
      const s = mode === 'cover' ? Math.max(c.width / iw, c.height / ih) : Math.min(c.width / iw, c.height / ih);
      x.drawImage(img, (c.width - iw * s) / 2, (c.height - ih * s) / 2, iw * s, ih * s);
    };
    x.filter = 'blur(1px) saturate(1.4)'; // ignored where unsupported: the upscale still blurs
    if (fit === 'contain') {
      x.filter = 'blur(2px) brightness(0.55) saturate(1.2)';
      draw('cover');
      x.filter = 'blur(1px) saturate(1.4)';
      draw('contain');
    } else draw('cover');
    url = c.toDataURL('image/jpeg', 0.85);
  } catch {
    url = null; // tainted canvas: the layer falls back to a CSS blur for this photo
  }
  glassCopies.set(key, url);
  if (glassCopies.size > 24) glassCopies.delete(glassCopies.keys().next().value);
  return url;
}

/** Rounded-rectangle path (clip-path: path()) for one panel box. */
const roundRect = (x, y, w, h, r) => {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const f = (n) => +n.toFixed(1);
  return `M${f(x + r)},${f(y)}h${f(w - 2 * r)}a${r},${r} 0 0 1 ${r},${r}v${f(h - 2 * r)}a${r},${r} 0 0 1 -${r},${r}h-${f(w - 2 * r)}a${r},${r} 0 0 1 -${r},-${r}v-${f(h - 2 * r)}a${r},${r} 0 0 1 ${r},-${r}z`;
};
const glassLayers = new Set();
/**
 * The blurred twin of a slideshow: same two cross-fading layers, same zoom, clipped to
 * the panels of `gridOf()` (the screen's own grid, or the active screen's for the
 * backdrop behind every screen).
 */
function glassLayer(host, gridOf) {
  const el = h('div', { class: 'glass-layer', 'aria-hidden': 'true' });
  const mk = () => {
    const img = h('div', { class: 'slide-img' });
    const s = h('div', { class: 'slide' }, img);
    el.append(s);
    return { el: s, img };
  };
  const layers = [mk(), mk()];
  let front = 0,
    lastPath = '',
    watched = null;
  host.append(el);
  // Panels move when their layout is computed, or (stacked on phones) when one above changes
  // size: watch the grid and its panels, so the clip is only re-cut when something moved.
  const ro = new ResizeObserver(() => layer.clip());
  const mo = new MutationObserver(() => layer.watch());
  const layer = {
    el,
    /** Called by the slideshow with the loaded image, right before it shows it. */
    show(img, kb) {
      // The layer covers the window (photo screens and the backdrop are full-bleed); before it's
      // laid out — the first photo can load that fast — the window's size is its size.
      const box = el.getBoundingClientRect();
      const url = blurredCopy(img, box.width || innerWidth, box.height || innerHeight, cfg.PHOTO_FIT === 'contain' ? 'contain' : 'cover');
      const back = layers[1 - front];
      back.img.style.backgroundImage = `url("${(url || img.src).replace(/"/g, '%22')}")`;
      back.el.classList.toggle('is-raw', !url);
      back.el.classList.remove('kb');
      void back.el.offsetWidth;
      if (kb) {
        back.el.style.setProperty('--kb-dur', kb.dur);
        back.el.style.setProperty('--kb-origin', kb.origin);
        back.el.classList.add('kb');
      }
      back.el.classList.add('is-visible');
      layers[front].el.classList.remove('is-visible');
      front = 1 - front;
    },
    /** Follow the grid's panels (the active screen's, for the backdrop behind every screen). */
    watch() {
      const grid = gridOf();
      if (grid !== watched) {
        mo.disconnect();
        if (grid) mo.observe(grid, { childList: true });
        watched = grid;
      }
      ro.disconnect();
      if (grid) [grid, ...grid.children].forEach((n) => ro.observe(n));
      layer.clip();
    },
    /** Re-cut the clip to where the panels are now. */
    clip() {
      const grid = watched;
      if (!el.isConnected || !grid || el.closest('[hidden]')) return;
      const base = el.getBoundingClientRect(),
        g = grid.getBoundingClientRect();
      const panels = grid.querySelectorAll(':scope > .panel:not(.is-off):not(.is-bare):not(.is-seamless):not(.is-expanded)');
      const r = panels.length ? parseFloat(getComputedStyle(panels[0]).borderTopLeftRadius) || 0 : 0;
      // offsetLeft/Top ignore the panels' entry animation (transforms) — the layout box is what counts.
      const path = [...panels]
        .map((p) => roundRect(g.left - base.left + p.offsetLeft, g.top - base.top + p.offsetTop, p.offsetWidth, p.offsetHeight, r))
        .join('');
      if (path === lastPath) return;
      lastPath = path;
      el.style.clipPath = path ? `path('${path}')` : 'inset(50%)';
      el.style.webkitClipPath = el.style.clipPath;
    },
  };
  glassLayers.add(layer);
  requestAnimationFrame(() => layer.watch());
  return layer;
}
/** Everything moved at once (a new layout, a new screen, the burn-in shift): re-cut after this frame's layout. */
const clipGlass = () =>
  requestAnimationFrame(() =>
    glassLayers.forEach((l) => {
      if (!l.el.isConnected) glassLayers.delete(l);
      else l.watch();
    }),
  );
bus.addEventListener('layout', clipGlass);
bus.addEventListener('shift', clipGlass);
