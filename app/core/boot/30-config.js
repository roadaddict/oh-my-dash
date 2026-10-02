/* ==========================================================================
   CONFIG RESOLUTION
   Local mode:  defaults ← device settings (localStorage) ← URL params
   Cloud mode:  defaults ← shared settings (Cloudflare D1)  ← URL params
   ========================================================================== */
let saved = {};
if (sync.cloud) saved = sync.items.config?.value || {};
else {
  try {
    saved = JSON.parse(store.get(STORE_KEY) || '{}') || {};
  } catch {
    saved = {};
  }
}
const cfg = { ...CONFIG };
for (const [k, v] of Object.entries(saved)) if (k in CONFIG) cfg[k] = coerce(v, CONFIG[k]);
for (const [k, v] of new URLSearchParams(location.search)) {
  const key = k.toUpperCase();
  if (key in CONFIG) cfg[key] = coerce(v, CONFIG[key]);
}
// With the backend available, feeds go through our own same-origin proxy.
// Kept separate from cfg so the automatic proxy is never written into saved settings.
const PROXY = cfg.CORS_PROXY || (sync.cloud ? new URL(`${API}/proxy?url=`, location.href).href : '');

// Keep polling: new shared data re-renders; a settings change reloads every screen.
async function pollState() {
  try {
    const changed = await pullState();
    sync.pending.forEach((_, key) => pushState(key));
    for (const key of changed) {
      if (key === 'config') {
        if (!window.__omdSavingConfig) location.reload();
      } else emit(key);
    }
  } catch {
    if (sync.mode === 'cloud') sync.mode = 'offline';
  }
}
if (sync.mode !== 'local') {
  every(15000, pollState);
  // Back in the foreground (phone app switched to, tablet woken): catch up right away.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pollState();
  });
}
const LOCALE = cfg.LOCALE || undefined;
