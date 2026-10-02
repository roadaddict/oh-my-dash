/* ==========================================================================
   SHARED UI — pieces several widgets (or the screens) use: the analog clock,
   the weather component + feed, public holidays, the photo slideshow.
   Each takes a `scope` for its timers and subscriptions: a widget passes its
   ctx, so everything stops when the widget is removed; the dashboard itself
   passes GLOBAL_SCOPE.
   ========================================================================== */
/** Timers and subscriptions that live as long as the page (screens, photo backdrop). */
const GLOBAL_SCOPE = {
  onTick: (fn) => onTick(fn),
  subscribe: (feed, fn, el) => feed.subscribe(fn, el),
  observeResize: (el, fn) => {
    const ro = new ResizeObserver(fn);
    ro.observe(el);
    return () => ro.disconnect();
  },
  setInterval: (fn, ms) => every(ms, fn), // on the shared clock (lives as long as the page)
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

/* ==========================================================================
   ANALOG CLOCK (hero option + world clocks)
   ========================================================================== */
function analogClock({ tz, seconds = true } = {}, scope = GLOBAL_SCOPE) {
  let ticks = '';
  for (let i = 0; i < 60; i += seconds ? 1 : 5) {
    const major = i % 5 === 0;
    const a = (i / 60) * Math.PI * 2;
    const r1 = major ? 40 : 43,
      r2 = 46;
    ticks += `<line class="tick${major ? ' major' : ''}" x1="${50 + r1 * Math.sin(a)}" y1="${50 - r1 * Math.cos(a)}" x2="${50 + r2 * Math.sin(a)}" y2="${50 - r2 * Math.cos(a)}"/>`;
  }
  const el = svgEl(`<svg class="analog" viewBox="0 0 100 100" aria-hidden="true">
    <circle class="face" cx="50" cy="50" r="49"/>${ticks}
    <line class="hand h" x1="50" y1="54" x2="50" y2="27"/>
    <line class="hand m" x1="50" y1="56" x2="50" y2="14"/>
    ${seconds ? '<line class="hand s" x1="50" y1="60" x2="50" y2="10"/>' : ''}
    <circle class="pin" cx="50" cy="50" r="2.4"/></svg>`);
  const [hh, mm, ss] = el.querySelectorAll('.hand');
  const partsFmt = tz ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false }) : null;
  const update = (now) => {
    let H = now.getHours(),
      M = now.getMinutes(),
      S = now.getSeconds();
    if (partsFmt) {
      const p = Object.fromEntries(partsFmt.formatToParts(now).map((x) => [x.type, x.value]));
      H = +p.hour % 24;
      M = +p.minute;
      S = +p.second;
    }
    hh.setAttribute('transform', `rotate(${(H % 12) * 30 + M * 0.5} 50 50)`);
    mm.setAttribute('transform', `rotate(${M * 6 + S * 0.1} 50 50)`);
    if (seconds) ss.setAttribute('transform', `rotate(${S * 6} 50 50)`);
    el.classList.toggle('is-night', H < 6 || H >= 20);
  };
  scope.onTick(update);
  return el;
}

/* ==========================================================================
   SHARED DATA — weather
   ========================================================================== */
const WMO = {
  0: ['Clear sky', 'sun'],
  1: ['Mainly clear', 'sun'],
  2: ['Partly cloudy', 'cloud-sun'],
  3: ['Overcast', 'cloud'],
  45: ['Fog', 'cloud-fog'],
  48: ['Rime fog', 'cloud-fog'],
  51: ['Light drizzle', 'cloud-drizzle'],
  53: ['Drizzle', 'cloud-drizzle'],
  55: ['Heavy drizzle', 'cloud-drizzle'],
  56: ['Freezing drizzle', 'cloud-drizzle'],
  57: ['Freezing drizzle', 'cloud-drizzle'],
  61: ['Light rain', 'cloud-rain'],
  63: ['Rain', 'cloud-rain'],
  65: ['Heavy rain', 'cloud-rain'],
  66: ['Freezing rain', 'cloud-rain'],
  67: ['Freezing rain', 'cloud-rain'],
  71: ['Light snow', 'cloud-snow'],
  73: ['Snow', 'cloud-snow'],
  75: ['Heavy snow', 'cloud-snow'],
  77: ['Snow grains', 'cloud-snow'],
  80: ['Light showers', 'cloud-rain'],
  81: ['Showers', 'cloud-rain'],
  82: ['Violent showers', 'cloud-rain'],
  85: ['Snow showers', 'cloud-snow'],
  86: ['Heavy snow showers', 'cloud-snow'],
  95: ['Thunderstorm', 'cloud-lightning'],
  96: ['Thunderstorm & hail', 'cloud-lightning'],
  99: ['Severe thunderstorm', 'cloud-lightning'],
};
const ICON_TONE = {
  sun: 'var(--amber)',
  moon: '#c7d2fe',
  'cloud-sun': '#fcd34d',
  'cloud-moon': '#c7d2fe',
  cloud: '#cbd5e1',
  'cloud-fog': '#94a3b8',
  'cloud-drizzle': 'var(--sky)',
  'cloud-rain': 'var(--sky)',
  'cloud-snow': '#e0f2fe',
  'cloud-lightning': 'var(--violet)',
};
function wmo(code, isDay = 1) {
  let [label, ic] = WMO[code] || ['—', 'cloud'];
  if (!isDay && ic === 'sun') ic = 'moon';
  if (!isDay && ic === 'cloud-sun') ic = 'cloud-moon';
  return { label, ic, tone: ICON_TONE[ic] || 'var(--text-2)' };
}
const FAHRENHEIT = cfg.TEMP_UNIT === 'fahrenheit';
const WIND_UNIT = FAHRENHEIT ? 'mph' : 'km/h';
const weatherFeed = createFeed(
  async () => {
    const q = new URLSearchParams({
      latitude: cfg.LATITUDE,
      longitude: cfg.LONGITUDE,
      timezone: 'auto',
      forecast_days: 7,
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
      hourly: 'temperature_2m,precipitation_probability,weather_code',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max',
      temperature_unit: FAHRENHEIT ? 'fahrenheit' : 'celsius',
      wind_speed_unit: FAHRENHEIT ? 'mph' : 'kmh',
    });
    return fetchJSON(`https://api.open-meteo.com/v1/forecast?${q}`);
  },
  cfg.WEATHER_REFRESH_MIN * 60000,
  { persist: `weather.${hashKey([cfg.LATITUDE, cfg.LONGITUDE, cfg.TEMP_UNIT].join())}` },
);

/** Moon phase (0 = new, .5 = full) from a known new moon + synodic month. */
function moonPhase(date = new Date()) {
  const synodic = 29.530588853;
  const days = (date - Date.UTC(2000, 0, 6, 18, 14)) / 864e5;
  const phase = (((days / synodic) % 1) + 1) % 1;
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return { phase, name: names[Math.round(phase * 8) % 8], illumination: Math.round((1 - Math.cos(phase * 2 * Math.PI)) * 50) };
}
function moonSVG(phase) {
  const r = 10,
    k = Math.cos(2 * Math.PI * phase),
    waxing = phase < 0.5,
    rx = Math.abs(k) * r;
  const outer = waxing ? 1 : 0;
  const inner = waxing ? (k > 0 ? 0 : 1) : k > 0 ? 1 : 0;
  return svgEl(`<svg class="moon" viewBox="-11 -11 22 22"><circle r="${r}" fill="rgba(255,255,255,.12)"/>
    <path d="M0,${-r} A${r},${r} 0 0 ${outer} 0,${r} A${rx},${r} 0 0 ${inner} 0,${-r}" fill="#e2e8f0"/></svg>`);
}
const localDate = (s) => {
  const [d, t = '00:00'] = s.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mi] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, hh, mi);
};
function wxNowEls(d) {
  const c = d.current,
    w = wmo(c.weather_code, c.is_day);
  return [
    h('div', { class: 'wx-icon', style: { '--tone': w.tone } }, icon(w.ic)),
    h('div', { class: 'wx-temp' }, `${Math.round(c.temperature_2m)}°`),
    h(
      'div',
      { class: 'wx-main' },
      h('div', { class: 'wx-desc' }, `${w.label} · ${cfg.LOCATION_NAME}`),
      h(
        'div',
        { class: 'wx-sub' },
        `H ${Math.round(d.daily.temperature_2m_max[0])}° · L ${Math.round(d.daily.temperature_2m_min[0])}° · Feels ${Math.round(c.apparent_temperature)}°`,
      ),
    ),
  ];
}
/**
 * Forecast days. Same markup everywhere; CSS shows them as Apple-style rows with a
 * temperature-range bar when there's height, or as compact columns when there isn't.
 * With onPick they become buttons (tap → that day's hourly chart).
 */
function forecastEls(d, n = 5, { selected = null, onPick = null } = {}) {
  const lo = d.daily.temperature_2m_min.slice(0, n),
    hi = d.daily.temperature_2m_max.slice(0, n);
  const wMin = Math.min(...lo),
    wSpan = Math.max(1, Math.max(...hi) - wMin);
  return d.daily.time.slice(0, n).map((t, i) => {
    const dw = wmo(d.daily.weather_code[i], 1);
    const rain = d.daily.precipitation_probability_max?.[i];
    return h(
      onPick ? 'button' : 'div',
      {
        class: `fc-day${i === 0 ? ' is-today' : ''}${selected === i ? ' is-selected' : ''}`,
        type: onPick ? 'button' : null,
        'aria-pressed': onPick ? String(selected === i) : null,
        onclick: onPick ? () => onPick(i) : null,
      },
      h('span', { class: 'fc-name' }, i === 0 ? 'Today' : fmtWeekdayShort.format(localDate(t))),
      h('span', { class: 'fc-ic', style: { color: dw.tone } }, icon(dw.ic)),
      h('span', { class: 'fc-rain' }, rain >= 20 ? `${rain}%` : ''),
      h('span', { class: 'fc-lo' }, `${Math.round(lo[i])}°`),
      h('span', { class: 'fc-range' }, h('i', { style: { left: `${((lo[i] - wMin) / wSpan) * 100}%`, right: `${100 - ((hi[i] - wMin) / wSpan) * 100}%` } })),
      h('span', { class: 'fc-hi' }, `${Math.round(hi[i])}°`),
    );
  });
}

/* ---------- Detailed weather: hourly chart, sun, UV, moon ---------- */
const fmtHour = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', hour12: cfg.HOUR_12 });
/** Temperature line + rain-chance bars: the next 24 h, or a whole forecast day (dayIdx). */
function drawHourly(host, d, dayIdx = null) {
  const W = host.clientWidth,
    H = host.clientHeight;
  if (W < 80 || H < 34) {
    host.replaceChildren();
    return;
  }
  const compact = H < 60; // slim strip: line + hours, no temperature labels
  const hr = d.hourly,
    cur = d.current.time.slice(0, 13);
  let i0 = dayIdx == null ? hr.time.findIndex((t) => t.slice(0, 13) >= cur) : hr.time.findIndex((t) => t.startsWith(d.daily.time[dayIdx]));
  if (i0 < 0) i0 = 0;
  const N = Math.min(dayIdx != null || W > 420 ? 24 : 12, hr.time.length - i0);
  if (N < 2) return;
  const temps = hr.temperature_2m.slice(i0, i0 + N),
    rain = (hr.precipitation_probability || []).slice(i0, i0 + N);
  // At least an 8° scale, so a mild day doesn't look like a cliff.
  const lo = Math.min(...temps),
    hi = Math.max(...temps),
    span = Math.max(8, hi - lo),
    min = lo - (span - (hi - lo)) / 2;
  const top = compact ? 2 : 20,
    bottom = compact ? 14 : 18,
    ch = H - top - bottom;
  const x = (i) => 10 + (i / (N - 1)) * (W - 20);
  const y = (t) => top + 4 + (1 - (t - min) / span) * ch * (compact ? 0.8 : 0.62);
  const pts = temps.map((t, i) => `${x(i).toFixed(1)},${y(t).toFixed(1)}`);
  const bars = rain
    .map((r, i) =>
      r > 0
        ? `<rect class="bar" x="${(x(i) - 3).toFixed(1)}" y="${(H - bottom - (r / 100) * ch * 0.32).toFixed(1)}" width="6" height="${((r / 100) * ch * 0.32).toFixed(1)}" rx="2"/>`
        : '',
    )
    .join('');
  const step = N > 12 ? (W < 360 ? 4 : 3) : 2;
  let labels = '';
  for (let i = 0; i < N; i += step) {
    labels += `<text x="${x(i).toFixed(1)}" y="${H - 3}" text-anchor="middle">${i === 0 && dayIdx == null ? 'Now' : fmtHour.format(localDate(hr.time[i0 + i]))}</text>`;
    if (!compact) labels += `<text class="t" x="${x(i).toFixed(1)}" y="${(y(temps[i]) - 7).toFixed(1)}" text-anchor="middle">${Math.round(temps[i])}°</text>`;
  }
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><linearGradient id="wxGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(251,191,36,.16)"/><stop offset="1" stop-color="rgba(251,191,36,0)"/></linearGradient></defs>${bars}<polygon class="fill" points="${x(0)},${H - bottom} ${pts.join(' ')} ${x(N - 1)},${H - bottom}"/><polyline class="line" points="${pts.join(' ')}"/>${labels}</svg>`;
}
/** Quiet one-line facts: now (humidity, wind) or forecast day `i` (rain), plus sun, UV and moon. */
function wxStatsEls(d, i = null) {
  const day = d.daily,
    k = i ?? 0,
    stat = (ic, text) => h('span', { class: 'stat' }, icon(ic), text);
  const noon = localDate(day.time[k]);
  noon.setHours(12);
  const moon = moonPhase(noon);
  return [
    ...(i == null
      ? [stat('droplet', `${Math.round(d.current.relative_humidity_2m)}%`), stat('wind', `${Math.round(d.current.wind_speed_10m)} ${WIND_UNIT}`)]
      : [stat('cloud-rain', `${day.precipitation_probability_max?.[k] ?? 0}% rain`)]),
    stat('sunrise', timeStr(localDate(day.sunrise[k]))),
    stat('sunset', timeStr(localDate(day.sunset[k]))),
    stat('sun', `UV ${Math.round(day.uv_index_max?.[k] ?? 0)}`),
    h('span', { class: 'stat' }, moonSVG(moon.phase), moon.name),
  ];
}

/**
 * The one weather component, used by the Home clock and the Info weather panel alike:
 * current conditions · yellow temperature line with rain-chance bars · sun/UV/moon ·
 * tappable forecast days (tap → that day's hours; back to "next 24 h" after a minute).
 * It adapts to its box via container queries (see .wx in the CSS), not per-tab variants.
 */
function mountWeather(host, scope = GLOBAL_SCOPE) {
  const now = h('div', { class: 'wx-now' }, h('div', { class: 'wx-error' }, icon('cloud'), 'Loading weather…'));
  const cap = h('div', { class: 'chart-cap' });
  const chart = h('div', { class: 'wxd-chart' });
  const stats = h('div', { class: 'wxd-stats' });
  const fc = h('div', { class: 'forecast' });
  host.append(h('div', { class: 'wx' }, now, stats, h('div', { class: 'wx-graph' }, cap, chart), fc));
  let last = null,
    day = null,
    resetTimer = 0;
  // Facts that don't fit are dropped (never shown half-cut).
  const fitStats = () => {
    // One measurement, then removals (not measure → remove → measure… per chip).
    const limit = stats.clientHeight + 1,
      chips = [...stats.children];
    const top = (c) => (c.offsetParent === stats ? c.offsetTop : c.offsetTop - stats.offsetTop);
    const cut = chips.findIndex((c, i) => i > 0 && top(c) + c.offsetHeight > limit);
    if (cut > 0) chips.slice(cut).forEach((c) => c.remove());
  };
  const draw = () => {
    if (!last) return;
    drawHourly(chart, last, day);
    stats.replaceChildren(...wxStatsEls(last, day));
    fitStats();
  };
  function render() {
    if (!last) return;
    cap.replaceChildren(
      h('b', null, day == null ? 'Next 24 hours' : day === 0 ? 'Today' : fmtWeekday.format(localDate(last.daily.time[day]))),
      h('span', null, day == null ? '' : ' · tap again for now'),
    );
    fc.replaceChildren(...forecastEls(last, 5, { selected: day, onPick }));
    draw();
  }
  function onPick(i) {
    day = day === i ? null : i;
    scope.clearTimeout(resetTimer);
    if (day != null)
      resetTimer = scope.setTimeout(() => {
        day = null;
        render();
      }, 60000);
    render();
  }
  scope.subscribe(
    weatherFeed,
    (d, err) => {
      if (d) {
        last = d;
        now.replaceChildren(...wxNowEls(d));
        render();
      } else if (err && !now.querySelector('.wx-temp')) now.replaceChildren(h('div', { class: 'wx-error' }, icon('cloud'), 'Weather unavailable — retrying'));
    },
    host,
  );
  scope.observeResize(chart, () => requestAnimationFrame(draw));
}

/* ---------- Public holidays (Nager.Date, no key): calendar + countdowns ---------- */
const holidayCache = new Map();
async function loadHolidays() {
  const cc = cfg.HOLIDAY_COUNTRY.trim().toUpperCase();
  if (!cc) return [];
  const y = new Date().getFullYear();
  const out = [],
    seen = new Set();
  for (const year of [y, y + 1]) {
    const key = `${cc}${year}`;
    if (!holidayCache.has(key))
      holidayCache.set(
        key,
        fetchJSON(`https://date.nager.at/api/v3/PublicHolidays/${year}/${cc}`).catch((e) => {
          holidayCache.delete(key);
          throw e;
        }),
      );
    for (const hd of await holidayCache.get(key)) {
      const start = parseYMD(hd.date);
      const regions = hd.counties?.length ? ` (${hd.counties.map((c) => c.split('-')[1]).join(', ')})` : '';
      const title = `${hd.name}${regions}`;
      if (!start || seen.has(hd.date + title)) continue;
      seen.add(hd.date + title);
      out.push({ title, start, end: addDays(start, 1), allDay: true, color: '#fb7185', cal: 'Holidays', holiday: true });
    }
  }
  return out;
}

/* ---------- Photos: sources + slideshow (Photos widget, photo screens, background) ---------- */
// Capped at 1920 px wide: sharp on a tablet, ~3× less data than 4K-class originals.
const PHOTO_W = Math.min(1920, Math.round(Math.max(screen.width, screen.height) * Math.min(1.5, window.devicePixelRatio || 1)));
const PHOTO_H = Math.round(PHOTO_W * (Math.min(screen.width, screen.height) / Math.max(screen.width, screen.height) || 0.5625));
const PORTRAIT = window.matchMedia('(orientation: portrait)').matches;

function parsePhotoFeed(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Not an RSS/Atom feed');
  return [...doc.querySelectorAll('item, entry')]
    .map((n) => {
      let src =
        [...n.getElementsByTagNameNS('*', 'content')]
          .find((c) => c.getAttribute('url') && (!c.getAttribute('medium') || c.getAttribute('medium') === 'image'))
          ?.getAttribute('url') ||
        [...n.getElementsByTagName('enclosure')].find((e) => /^image\//.test(e.getAttribute('type') || ''))?.getAttribute('url') ||
        [...n.getElementsByTagNameNS('*', 'thumbnail')][0]?.getAttribute('url');
      if (!src) {
        const html = [...n.children].find((c) => /^(description|content|summary|encoded)$/i.test(c.localName))?.textContent || '';
        src = /<img[^>]+src=["']([^"']+)/i.exec(html)?.[1];
      }
      const caption = [...n.children].find((c) => c.localName === 'title')?.textContent?.trim();
      return src ? { src, caption } : null;
    })
    .filter(Boolean);
}
async function loadGooglePhotos(url) {
  const html = await fetchText(url, { proxyFirst: true });
  const found = new Set();
  for (const m of html.matchAll(/\["(https:\/\/lh3\.googleusercontent\.com\/pw\/[a-zA-Z0-9\-_]+)"/g)) found.add(m[1]);
  return [...found].map((u) => ({ src: `${u}=w${PHOTO_W}-h${PHOTO_H}`, caption: '' }));
}
const photoFeed = createFeed(
  async () => {
    let items = [];
    for (const line of cfg.PHOTO_URLS) {
      const [src, caption] = pipe(line);
      if (src) items.push({ src, caption });
    }
    const feeds = await Promise.allSettled(cfg.PHOTO_FEEDS.map((u) => fetchText(u).then(parsePhotoFeed)));
    feeds.forEach((r) => {
      if (r.status === 'fulfilled') items.push(...r.value);
      else console.warn('Photo feed failed:', r.reason);
    });
    if (cfg.GOOGLE_PHOTOS_ALBUM) {
      try {
        items.push(...(await loadGooglePhotos(cfg.GOOGLE_PHOTOS_ALBUM)));
      } catch (e) {
        console.warn('Google Photos failed:', e);
      }
    }
    let demo = false;
    if (!items.length) {
      demo = true;
      const page = 1 + Math.floor(Math.random() * 20);
      const list = await fetchJSON(`https://picsum.photos/v2/list?page=${page}&limit=40`);
      const [w, hh] = PORTRAIT ? [PHOTO_H, PHOTO_W] : [PHOTO_W, PHOTO_H];
      items = list.map((ph) => ({ src: `https://picsum.photos/id/${ph.id}/${w}/${hh}`, caption: `Photo: ${ph.author} · Unsplash` }));
    }
    return { items: cfg.PHOTO_SHUFFLE ? shuffle(items) : items, demo };
  },
  6 * 3600000,
  { persist: `photos.${hashKey(JSON.stringify([cfg.PHOTO_URLS, cfg.PHOTO_FEEDS, cfg.GOOGLE_PHOTOS_ALBUM, PORTRAIT]))}` },
);

/**
 * Photo bytes: fetched once as a blob, kept in Cache Storage (survives the daily reload)
 * and in memory as object URLs — so a looping slideshow doesn't re-download, and the
 * data meter can count it. Hosts that block CORS fall back to a plain <img> load.
 */
const photoMem = new Map();
async function photoUrl(src) {
  if (photoMem.has(src)) return photoMem.get(src);
  let blob = null;
  try {
    const cache = 'caches' in window ? await caches.open('omd-photos-v1') : null;
    const hit = cache && (await cache.match(src));
    if (hit) blob = await hit.blob();
    else {
      const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.clone().blob();
      if (cache) {
        await cache.put(src, res);
        const keys = await cache.keys();
        keys.slice(0, Math.max(0, keys.length - 80)).forEach((k) => cache.delete(k)); // keep the newest 80
      }
    }
  } catch {
    return src;
  }
  const url = URL.createObjectURL(blob);
  photoMem.set(src, url);
  if (photoMem.size > 30) {
    const [k, v] = photoMem.entries().next().value;
    URL.revokeObjectURL(v);
    photoMem.delete(k);
  }
  return url;
}

const KB_ORIGINS = ['20% 30%', '80% 25%', '50% 80%', '30% 70%', '70% 60%', '50% 40%'];
/** glass: also keep a blurred twin clipped to the panels over it (see 66-glass.js); gridOf() finds them. */
function slideshow(host, { captions = true, glass = null } = {}, scope = GLOBAL_SCOPE) {
  const wrap = h('div', { class: 'slideshow' });
  const mk = () => {
    const img = h('div', { class: 'slide-img' }),
      fill = h('div', { class: 'slide-fill' });
    const el = h('div', { class: `slide fit-${cfg.PHOTO_FIT === 'contain' ? 'contain' : 'cover'}` }, cfg.PHOTO_FIT === 'contain' ? fill : null, img);
    wrap.append(el);
    return { el, img, fill };
  };
  const layers = [mk(), mk()];
  const cap = h('div', { class: 'slide-caption' });
  if (captions) wrap.append(cap);
  host.append(wrap);
  const twin = glass ? glassLayer(host, glass) : null;

  let items = [],
    idx = 0,
    front = 0,
    shown = false,
    fails = 0;
  function next() {
    if (!items.length || (shown && !isVisible(wrap))) return;
    const item = items[idx++ % items.length];
    const im = new Image();
    im.onload = () => {
      fails = 0;
      const back = layers[1 - front];
      const url = `url("${(item.url || item.src).replace(/"/g, '%22')}")`;
      back.img.style.backgroundImage = url;
      back.fill.style.backgroundImage = url;
      back.el.classList.remove('kb');
      void back.el.offsetWidth; // restart the Ken Burns animation
      const kb = cfg.PHOTO_KEN_BURNS ? { dur: `${cfg.PHOTO_INTERVAL_SEC + 4}s`, origin: KB_ORIGINS[idx % KB_ORIGINS.length] } : null;
      if (kb) {
        back.el.style.setProperty('--kb-dur', kb.dur);
        back.el.style.setProperty('--kb-origin', kb.origin);
        back.el.classList.add('kb');
      }
      twin?.show(im, kb); // same frame, same zoom: the blurred twin stays aligned
      back.el.classList.add('is-visible');
      layers[front].el.classList.remove('is-visible');
      front = 1 - front;
      cap.textContent = item.caption || '';
      shown = true;
    };
    im.onerror = () => {
      if (++fails < Math.min(items.length, 5)) scope.setTimeout(next, 300);
    };
    photoUrl(item.src).then((u) => {
      item.url = u;
      im.src = u;
    });
  }
  scope.subscribe(photoFeed, (d) => {
    if (!d) return;
    const first = !items.length;
    items = d.items;
    if (first) next();
  });
  scope.setInterval(next, Math.max(5, cfg.PHOTO_INTERVAL_SEC) * 1000);
  return wrap;
}
