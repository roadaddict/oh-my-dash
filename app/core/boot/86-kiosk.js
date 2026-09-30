/* ==========================================================================
   KIOSK FEATURES — wake lock, fullscreen, idle cursor, burn-in, night mode…
   ========================================================================== */
function initKiosk() {
  if (cfg.LOW_POWER) document.body.classList.add('low-power');
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
    setInterval(() => {
      i = (i + 1) % offsets.length;
      document.documentElement.style.setProperty('--shift-x', `${offsets[i][0]}px`);
      document.documentElement.style.setProperty('--shift-y', `${offsets[i][1]}px`);
    }, 180000);
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
  setInterval(applyNight, 15000);

  // Daily full reload (clears memory leaks from long-running embeds)
  const reloadAt = parseHM(cfg.DAILY_RELOAD_AT);
  const bootedAt = Date.now();
  if (reloadAt != null) {
    setInterval(() => {
      if (minutesOfDay() === reloadAt && Date.now() - bootedAt > 3600000 && navigator.onLine) location.reload();
    }, 30000);
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
