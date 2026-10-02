/* ==========================================================================
   PERF OVERLAY — open the dashboard with ?perf=1 to see, on the tablet itself:
     fps     frames drawn per second (the overlay counts frames only while shown)
     jank    frames that took longer than 50 ms, in the last 10 s
     lag     how late a 500 ms timer fired (the main thread was busy) — worst in 10 s
     boot    ms from navigation until the first screen was mounted
     nodes   elements on the page · heap: JS memory (Chrome only)
     req     network requests in the last minute
   Works in every browser (Safari has no long-task API, so lag is measured with a timer).
   ========================================================================== */
function initPerfOverlay() {
  if (!/[?&]perf=1/.test(location.search)) return;
  const hud = h('div', { class: 'perf-hud', 'aria-hidden': 'true' });
  document.body.append(hud);
  const frames = [],
    lags = [],
    reqs = [];
  let last = performance.now();
  const frame = (t) => {
    frames.push([t, t - last]);
    last = t;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  let expected = performance.now() + 500;
  setInterval(() => {
    const now = performance.now();
    lags.push([now, Math.max(0, now - expected)]);
    expected = now + 500;
  }, 500);
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => reqs.push(e.startTime))).observe({ type: 'resource', buffered: true });
  } catch {
    /* old browser */
  }
  const boot = Math.round(performance.getEntriesByName('omd:ready')[0]?.startTime ?? 0);
  const row = (k, v, bad) => h('div', { class: bad ? 'bad' : null }, h('b', null, k), ` ${v}`);
  setInterval(() => {
    const now = performance.now();
    const trim = (a, ms) => {
      while (a.length && (a[0][0] ?? a[0]) < now - ms) a.shift();
    };
    trim(frames, 10000);
    trim(lags, 10000);
    trim(reqs, 60000);
    const fps = frames.filter(([t]) => t > now - 1000).length;
    const jank = frames.filter(([, d]) => d > 50).length;
    const lag = Math.round(Math.max(0, ...lags.map(([, l]) => l)));
    const heap = performance.memory ? `${(performance.memory.usedJSHeapSize / 1e6).toFixed(1)} MB` : '—';
    hud.replaceChildren(
      row('fps', fps, fps < 30),
      row('jank', jank, jank > 3),
      row('lag', `${lag} ms`, lag > 100),
      row('boot', `${boot} ms`, boot > 1500),
      row('nodes', document.getElementsByTagName('*').length),
      row('heap', heap),
      row('req', `${reqs.length}/min`),
      row(
        'mode',
        [
          document.body.classList.contains('low-power') ? `low-power${document.body.dataset.power === 'auto' ? ' (auto)' : ''}` : 'full',
          navigator.onLine ? 'online' : 'offline',
        ].join(' · '),
      ),
    );
  }, 1000);
}
