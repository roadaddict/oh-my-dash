/*
 * Instant start: put back the picture of the screen saved on the last visit (see
 * boot/89-snapshot.js), before any of the dashboard's code has run. It is inert — no
 * handlers, no timers — and is swapped for the live screen in the same frame the live
 * one is ready. Runs inline, right after the screens container, so the browser can paint
 * it while it's still reading the rest of the page. Kept only for the same build, screen
 * and window size; anything unexpected and the dashboard simply starts without it.
 */
(function () {
  try {
    var q = location.search;
    if (/[?&](view|nosnap)=/.test(q)) return;
    var raw = localStorage.getItem('omd.snapshot.v1');
    if (!raw) return;
    var s = JSON.parse(raw);
    var build = document.querySelector('meta[name="omd-build"]');
    var hash = location.hash.slice(1).toLowerCase();
    if (!s || !build || s.build !== build.content || s.w !== innerWidth || s.h !== innerHeight) return;
    if ((hash && hash !== s.screen) || !(Date.now() - s.at < 12 * 3600e3)) return;
    var screens = document.getElementById('screens');
    var tabs = document.getElementById('screenTabs');
    screens.insertAdjacentHTML('afterbegin', s.html);
    if (tabs && s.tabs) {
      tabs.innerHTML = s.tabs;
      tabs.hidden = false;
    }
    document.documentElement.classList.add('from-snapshot');
  } catch (e) {
    /* no storage, bad data: start the normal way */
  }
})();
