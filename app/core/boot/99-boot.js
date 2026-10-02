/* ==========================================================================
   BOOT
   ========================================================================== */
/** ?view=lists — the lists alone, for phones (Add to Home screen). Nothing else loads. */
function initPhoneLists() {
  app.classList.add('view-phone');
  document.title = `Lists · ${dashName()}`;
  screensHost.replaceChildren(h('section', { class: 'screen is-active', 'data-screen': 'lists' }, h('div', { class: 'grid' }, mountSpec({ type: 'lists' }))));
  hydrateIcons(screensHost);
}
const VIEW = new URLSearchParams(location.search).get('view');
hydrateIcons();
// Back from an account sign-in (?spotify=connected / ?aqara=…): drop the marker from the address.
{
  const q = new URLSearchParams(location.search);
  const back = ['spotify', 'aqara', 'strava'].filter((k) => q.has(k));
  if (back.length) {
    back.forEach((k) => {
      if (q.get(k) !== 'connected') console.warn(`${k} sign-in: ${q.get(k)}`);
      q.delete(k);
    });
    history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}${location.hash}`);
  }
}
applyName();
if (VIEW === 'lists') initPhoneLists();
else {
  initKiosk();
  initNetwork();
  initScreens();
  dropSnapshot();
  initSnapshots();
}
performance.mark('omd:ready');
initOffline();
initPerfOverlay();
