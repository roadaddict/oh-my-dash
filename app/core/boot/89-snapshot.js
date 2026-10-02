/* ==========================================================================
   SNAPSHOT — a picture of the screen, for an instant start next time.
   Every few minutes (and when the page is hidden or closed) the active screen is
   saved as plain HTML; app/core/snapshot.js puts it back on the next load, before
   any code runs, so an old tablet shows the dashboard at once instead of after a
   second or two of starting up. The live screen replaces it as soon as it's ready.
   Not saved: embedded pages (iframes), photos held in memory, ids and anything
   interactive — it's a picture, nothing more. ?nosnap=1 turns it off.
   ========================================================================== */
const SNAP_KEY = 'omd.snapshot.v1',
  SNAP_MAX_BYTES = 1.5e6;
const BUILD_ID = $('meta[name="omd-build"]')?.content || '';
function snapshotHtml(screenEl) {
  const copy = screenEl.cloneNode(true);
  copy.classList.add('is-snapshot');
  copy.setAttribute('aria-hidden', 'true');
  copy.removeAttribute('style');
  copy.querySelectorAll('iframe, video, audio, script, .perf-hud').forEach((n) => n.remove());
  copy.querySelectorAll('img').forEach((img) => {
    if (!/^(https?:|data:)/.test(img.getAttribute('src') || '')) img.remove();
  });
  copy.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  copy.querySelectorAll('[style*="blob:"]').forEach((n) => n.style.removeProperty('background-image'));
  return copy.outerHTML;
}
function saveSnapshot() {
  const def = screenDefs[currentIdx],
    el = def && builtScreens.get(def.id);
  if (!el || !BUILD_ID || VIEW || editing || app.classList.contains('view-phone')) return;
  if (document.querySelector('.panel.is-expanded') || document.body.classList.contains('is-dark-night')) return;
  const html = snapshotHtml(el);
  if (html.length > SNAP_MAX_BYTES) return store.remove(SNAP_KEY);
  const tabs = tabsHost.hidden ? '' : tabsHost.innerHTML;
  if (!store.set(SNAP_KEY, JSON.stringify({ build: BUILD_ID, screen: def.id, w: innerWidth, h: innerHeight, at: Date.now(), html, tabs })))
    store.remove(SNAP_KEY);
}
/** Swap the picture for the live screen (called once the first screen is mounted). */
function dropSnapshot() {
  const snaps = document.querySelectorAll('.screen.is-snapshot');
  if (!snaps.length) return;
  snaps.forEach((n) => n.remove());
  // The live screen appeared in place of an identical picture: no fade-in this once.
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('from-snapshot')));
}
function initSnapshots() {
  if (/[?&]nosnap=1/.test(location.search)) return store.remove(SNAP_KEY);
  const later = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(fn, 200));
  // First once the data has had time to arrive, then every 10 minutes.
  setTimeout(() => later(saveSnapshot), 20000);
  every(10 * 60000, () => later(saveSnapshot));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveSnapshot();
  });
  window.addEventListener('pagehide', saveSnapshot);
}
