/* ==========================================================================
   MODULE 5 — NETWORK: navigator.onLine + latency ping
   ========================================================================== */
function initNetwork() {
  const pingChip = $('#netChip'),
    dot = $('#netDot'),
    pingValue = $('#pingValue'),
    spark = $('#pingSpark'),
    lossEl = $('#pingLoss');
  let statusText = '',
    latencyText = '';
  const samples = []; // ms | null (loss)
  const WINDOW = 30;
  let consecutiveFails = 0;
  const toneFor = (ms) => (ms == null ? 'tone-bad' : ms < cfg.PING_GOOD_MS ? 'tone-good' : ms <= cfg.PING_WARN_MS ? 'tone-warn' : 'tone-bad');
  const setTone = (el, tone) => {
    el.classList.remove('tone-good', 'tone-warn', 'tone-bad');
    if (tone) el.classList.add(tone);
  };

  /** The dot: connected and synced (green), cloud unreachable / not signed in (amber), offline (red). */
  function renderStatus() {
    if (!navigator.onLine) {
      setTone(dot, 'tone-bad');
      statusText = 'Offline';
    } else if (consecutiveFails >= 3) {
      setTone(dot, 'tone-warn');
      statusText = 'Cloud unreachable';
    } else if (sync.mode === 'denied') {
      setTone(dot, 'tone-warn');
      statusText = 'Online · not signed in, saving on this device only';
    } else if (sync.mode === 'offline') {
      setTone(dot, 'tone-warn');
      statusText = 'Online · sync unreachable, retrying';
    } else {
      setTone(dot, 'tone-good');
      statusText = sync.mode === 'cloud' ? 'Connected · synced with Cloudflare' : 'Connected';
    }
    pingChip.setAttribute('aria-label', statusText);
    updateNetTitle();
  }
  function renderPing() {
    const last = samples[samples.length - 1];
    if (!navigator.onLine) {
      setTone(pingChip, 'tone-bad');
      pingValue.textContent = 'Offline';
    } else if (last === undefined) {
      setTone(pingChip, null);
      pingValue.textContent = '… ms';
    } else if (last === null) {
      setTone(pingChip, 'tone-bad');
      pingValue.textContent = 'timeout';
    } else {
      setTone(pingChip, toneFor(last));
      pingValue.textContent = `${last} ms`;
    }

    const lost = samples.filter((s) => s == null).length;
    const ok = samples.filter((s) => s != null);
    lossEl.textContent = samples.length ? `${Math.round((lost / samples.length) * 100)}% loss` : '';
    if (ok.length) {
      const avg = Math.round(ok.reduce((a, b) => a + b, 0) / ok.length);
      const jitter = ok.length > 1 ? Math.round(ok.slice(1).reduce((a, v, i) => a + Math.abs(v - ok[i]), 0) / (ok.length - 1)) : 0;
      latencyText = `Latency to ${hostOf(PING_TARGET)} · avg ${avg} ms · min ${Math.min(...ok)} · max ${Math.max(...ok)} · jitter ${jitter} ms · loss ${lost}/${samples.length}`;
    }
    updateNetTitle();
    const W = 64,
      H = 18,
      n = WINDOW;
    const max = Math.max(cfg.PING_WARN_MS, ...ok);
    const pts = [],
      dots = [];
    samples.forEach((s, i) => {
      const x = (W * (i + n - samples.length)) / (n - 1);
      if (s == null) dots.push(`<circle cx="${x.toFixed(1)}" cy="${H - 1.5}" r="1.6"/>`);
      else pts.push(`${x.toFixed(1)},${(H - 1 - (Math.min(s, max) / max) * (H - 3)).toFixed(1)}`);
    });
    const area =
      pts.length > 1 ? `<polygon class="area" points="${pts[0].split(',')[0]},${H} ${pts.join(' ')} ${pts[pts.length - 1].split(',')[0]},${H}"/>` : '';
    spark.innerHTML = `${area}<polyline points="${pts.join(' ')}"/>${dots.join('')}`;
  }
  // Default target: this dashboard's own Worker (/api/ping) — answered at the nearest
  // Cloudflare edge, always reachable when the dashboard is, ~0.4 KB per probe.
  const PING_TARGET = cfg.PING_URL || (location.protocol === 'file:' ? 'https://www.gstatic.com/generate_204' : new URL(`${API}/ping`, location.href).href);
  const sameOriginPing = (() => {
    try {
      return new URL(PING_TARGET).origin === location.origin;
    } catch {
      return false;
    }
  })();
  async function measure() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.PING_TIMEOUT_MS);
    const url = `${PING_TARGET}${PING_TARGET.includes('?') ? '&' : '?'}_=${Date.now()}`;
    const t0 = performance.now();
    try {
      // Same origin: readable response + full Resource Timing. Elsewhere: opaque no-cors, wall time only.
      const res = await fetch(
        url,
        sameOriginPing ? { cache: 'no-store', signal: ctrl.signal } : { mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: ctrl.signal },
      );
      if (sameOriginPing && !res.ok) return null;
      const wall = performance.now() - t0;
      // Network round trip only (request sent → first byte), excluding JS and queueing.
      const e = performance.getEntriesByName(url).pop();
      const rtt = e && e.responseStart > 0 && e.requestStart > 0 ? e.responseStart - e.requestStart : wall;
      return Math.max(1, Math.round(rtt));
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  async function ping() {
    if (!navigator.onLine) {
      renderStatus();
      renderPing();
      return;
    }
    const ms = await measure();
    samples.push(ms);
    if (samples.length > WINDOW) samples.shift();
    consecutiveFails = ms == null ? consecutiveFails + 1 : 0;
    renderStatus();
    renderPing();
  }
  function updateNetTitle() {
    pingChip.title = [statusText, latencyText].filter(Boolean).join('\n');
  }
  setInterval(renderStatus, 15000); // sync state changes (signed out, sync unreachable) show up on the dot
  window.addEventListener('online', () => {
    renderStatus();
    frames.forEach((f) => f.onOnline());
    ping();
  });
  window.addEventListener('offline', () => {
    renderStatus();
    renderPing();
    frames.forEach((f) => f.onOffline());
  });
  renderStatus();
  renderPing();
  // Warm-up request (DNS + TLS handshake) is discarded so the first reading is honest.
  measure().finally(() => {
    ping();
    setInterval(ping, Math.max(2, cfg.PING_INTERVAL_SEC) * 1000);
  });
}
