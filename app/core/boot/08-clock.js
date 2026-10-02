/* ==========================================================================
   CLOCK — one heartbeat for the whole dashboard.
   Everything that happens "every N seconds" runs on it: clocks (onTick) and all
   polling and housekeeping (every). Jobs are aligned to the wall clock (a 5-minute
   job runs at :00, :05, :10 …), so the device wakes up once a second at most —
   never once per widget — and everything due in that second updates the page
   together, in one task: one style and layout pass, one repaint.
   ========================================================================== */
const tickers = new Set();
/** fn(now) every second (and right away). Returns an unsubscribe. */
const onTick = (fn) => {
  tickers.add(fn);
  fn(new Date());
  return () => tickers.delete(fn);
};
const jobs = new Set();
/**
 * fn() every `ms` (rounded to whole seconds), on the heartbeat, at wall-clock multiples
 * of `ms`. Returns a cancel function. For anything shorter than a second use a timer.
 */
function every(ms, fn) {
  const step = Math.max(1000, Math.round(ms / 1000) * 1000);
  const job = { ms: step, fn, slot: Math.floor(Date.now() / step) };
  jobs.add(job);
  return () => jobs.delete(job);
}
(function beat() {
  const now = new Date(),
    t = now.getTime();
  for (const job of jobs) {
    const slot = Math.floor(t / job.ms);
    if (slot === job.slot) continue;
    job.slot = slot;
    try {
      job.fn();
    } catch (e) {
      console.error(e);
    }
  }
  tickers.forEach((fn) => {
    try {
      fn(now);
    } catch (e) {
      console.error(e);
    }
  });
  setTimeout(beat, 1000 - (Date.now() % 1000) + 10);
})();
