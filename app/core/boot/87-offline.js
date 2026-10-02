/* ==========================================================================
   OFFLINE — the service worker (app/sw.js) keeps a copy of this page and its
   fonts, so a reload or a power cut during an internet outage still brings the
   dashboard up. Widgets show their last good data meanwhile (see createFeed).
   ?nosw=1 removes the service worker and its copies from this device.
   ========================================================================== */
const OFFLINE_CAPABLE = 'serviceWorker' in navigator && window.isSecureContext && /^https?:$/.test(location.protocol);
function initOffline() {
  if (!OFFLINE_CAPABLE) return;
  if (/[?&]nosw=1/.test(location.search)) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
    caches.keys().then((keys) => keys.filter((k) => k.startsWith('omd-') && !k.startsWith('omd-photos')).forEach((k) => caches.delete(k)));
    return;
  }
  // After the first screen is up, so installing never competes with startup.
  const register = () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Offline copy unavailable:', e.message));
  if (document.readyState === 'complete') setTimeout(register, 2000);
  else window.addEventListener('load', () => setTimeout(register, 2000), { once: true });
}
/** A reload is safe when online, or when the offline copy will answer it. */
const canReload = () => navigator.onLine || !!navigator.serviceWorker?.controller;
