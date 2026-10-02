/* ==========================================================================
   KIOSK FEATURES — wake lock, fullscreen, idle cursor, burn-in, night mode…
   ========================================================================== */
function initKiosk() {
  initPowerMode();
  applyWidgetBg(cfg.WIDGET_BG);
  const rgb = hexToRgb(cfg.THEME_ACCENT);
  if (rgb) {
    document.documentElement.style.setProperty('--accent', cfg.THEME_ACCENT);
    document.documentElement.style.setProperty('--accent-rgb', rgb);
  }
  if (cfg.CUSTOM_CSS) document.head.append(h('style', { id: 'custom-css' }, cfg.CUSTOM_CSS));
  applyPhotoBg(cfg.PHOTO_BACKGROUND);
  onTick((n) => {
    if (n.getSeconds() === 0 || !$('#brandDate').textContent) $('#brandDate').textContent = `· ${fmtDateShort.format(n)}`;
  });

  // Screen Wake Lock
  let wakeLock = null;
  const requestWake = async () => {
    if (!cfg.KEEP_SCREEN_AWAKE || !('wakeLock' in navigator) || document.hidden) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      /* not allowed / insecure context */
    }
  };
  requestWake();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (!wakeLock || wakeLock.released) requestWake();
    resumeVisible();
  });

  // Fullscreen toggle
  const fsBtn = $('#btnFullscreen');
  if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) fsBtn.hidden = true;
  fsBtn.addEventListener('click', () => {
    const el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {});
  });
  const syncFs = () => {
    fsBtn.dataset.icon = document.fullscreenElement || document.webkitFullscreenElement ? 'minimize' : 'maximize';
    hydrateIcons(fsBtn.parentElement);
  };
  document.addEventListener('fullscreenchange', syncFs);
  document.addEventListener('webkitfullscreenchange', syncFs);

  // Hide cursor when idle
  let idleTimer = 0;
  const wake = () => {
    document.body.classList.remove('is-idle');
    clearTimeout(idleTimer);
    if (cfg.HIDE_CURSOR_SEC > 0) idleTimer = setTimeout(() => document.body.classList.add('is-idle'), cfg.HIDE_CURSOR_SEC * 1000);
  };
  ['pointermove', 'pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));
  wake();

  // Burn-in protection: shift the whole layout a few pixels every 3 minutes.
  if (cfg.BURN_IN_SHIFT) {
    const offsets = [
      [0, 0],
      [2, 1],
      [-1, 2],
      [-2, -1],
      [1, -2],
      [2, -2],
      [-2, 1],
    ];
    let i = 0;
    every(180000, () => {
      i = (i + 1) % offsets.length;
      document.documentElement.style.setProperty('--shift-x', `${offsets[i][0]}px`);
      document.documentElement.style.setProperty('--shift-y', `${offsets[i][1]}px`);
      bus.dispatchEvent(new Event('shift'));
    });
  }

  // Night mode: dim / minimal clock / off (tap to wake for 60 s)
  const start = parseHM(cfg.NIGHT_MODE_START),
    end = parseHM(cfg.NIGHT_MODE_END);
  const nightClock = $('#nightClock'),
    nightTime = $('#nightTime'),
    nightDate = $('#nightDate');
  let tapWakeUntil = 0;
  const isNight = () => {
    if (start == null || end == null || start === end) return false;
    const m = minutesOfDay();
    return start < end ? m >= start && m < end : m >= start || m < end;
  };
  const applyNight = () => {
    const night = isNight() && Date.now() > tapWakeUntil;
    const style = cfg.NIGHT_MODE_STYLE;
    const veil = !night ? 0 : style === 'dim' ? 1 - Math.min(1, Math.max(0.05, cfg.NIGHT_BRIGHTNESS)) : 1;
    document.documentElement.style.setProperty('--night-veil', String(veil));
    nightClock.classList.toggle('is-on', night && style === 'clock');
    // Display dark ("off" / "clock"): pause photos, feeds and iframe refreshes.
    const dark = night && style !== 'dim';
    if (dark !== document.body.classList.contains('is-dark-night')) {
      document.body.classList.toggle('is-dark-night', dark);
      if (!dark) resumeVisible();
    }
  };
  onTick((n) => {
    if (nightClock.classList.contains('is-on')) {
      nightTime.textContent = timeStr(n);
      nightDate.textContent = fmtDateLong.format(n);
    }
  });
  window.addEventListener(
    'pointerdown',
    () => {
      if (isNight()) {
        tapWakeUntil = Date.now() + 60000;
        applyNight();
      }
    },
    { passive: true, capture: true },
  );
  applyNight();
  every(15000, applyNight);

  // Daily full reload (clears memory leaks from long-running embeds)
  const reloadAt = parseHM(cfg.DAILY_RELOAD_AT);
  const bootedAt = Date.now();
  if (reloadAt != null) {
    every(30000, () => {
      if (minutesOfDay() === reloadAt && Date.now() - bootedAt > 3600000 && canReload()) location.reload();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (editing) setEditing(false);
      setExpanded(null, false);
      closeSettings();
    }
    if (e.key === ',' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      openSettings();
    }
  });
}

/* ---------- Low-power mode: on, off, or automatic ----------
   Automatic: on right away for clearly weak hardware (2 cores or less, 1 GB or less);
   otherwise the first minute's frames are watched once the screen has settled, and a
   tablet that can't keep ~30 fps switches over. The verdict is remembered for a week. */
const POWER_KEY = 'omd.lowpower.auto';
function initPowerMode() {
  const v = String(cfg.LOW_POWER).trim().toLowerCase();
  const setting = ['true', '1', 'on', 'yes'].includes(v) ? true : ['false', '0', 'off', 'no'].includes(v) ? false : null;
  const on = (why) => {
    document.body.classList.add('low-power');
    document.body.dataset.power = why;
  };
  if (setting === true) return on('setting');
  if (setting === false) return;
  const weak = (navigator.hardwareConcurrency || 4) <= 2 || (navigator.deviceMemory != null && navigator.deviceMemory <= 1);
  if (weak) return on('auto');
  let saved = null;
  try {
    saved = JSON.parse(store.get(POWER_KEY) || 'null');
  } catch {
    /* ignore */
  }
  if (saved && Date.now() - saved.at < 7 * 864e5) {
    if (saved.low) on('auto');
    return;
  }
  // Watch 5 s of frames, 20 s after startup (the first screen has settled by then).
  setTimeout(() => {
    if (document.hidden) return;
    const gaps = [];
    let first = 0,
      last = 0;
    const frame = (t) => {
      if (last) gaps.push(t - last);
      else first = t;
      last = t;
      if (t - first < 5000) requestAnimationFrame(frame);
      else decide();
    };
    const decide = () => {
      if (gaps.length < 20 || document.hidden) return;
      const sorted = [...gaps].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)],
        janky = gaps.filter((g) => g > 50).length / gaps.length;
      const low = median > 34 || janky > 0.25;
      store.set(POWER_KEY, JSON.stringify({ at: Date.now(), low, median: Math.round(median), janky: +janky.toFixed(2) }));
      if (low) on('auto');
    };
    requestAnimationFrame(frame);
  }, 20000);
}
