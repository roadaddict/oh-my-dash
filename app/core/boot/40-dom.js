/* ==========================================================================
   DOM HELPERS & FORMATTERS
   ========================================================================== */
function icon(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${REG.icons[name] || ''}</svg>`;
  return t.content.firstElementChild;
}
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((n) => {
    n.querySelector(':scope > svg.i')?.remove();
    n.prepend(icon(n.dataset.icon));
  });
}

/* ==========================================================================
   SMALL HELPERS
   ========================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
function h(tag, attrs, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) if (val != null) p.startsWith('--') ? n.style.setProperty(p, val) : (n.style[p] = val);
    } else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}
const svgEl = (markup) => {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
};
const { hostOf, parseHM, minutesOfDay, addDays, ymd, parseYMD, pipe, shuffle, hexToRgb, uid } = OMD.util;
/**
 * On screen right now? Inactive screens are only visibility:hidden (they keep their
 * layout for smooth transitions), so check the screen explicitly. Night "off"/"clock"
 * counts as not visible so nothing downloads while the display is dark.
 */
const isVisible = (el) => {
  if (!el?.isConnected || document.hidden || document.body.classList.contains('is-dark-night')) return false;
  const screenEl = el.closest('.screen');
  return (!screenEl || screenEl.classList.contains('is-active')) && el.getClientRects().length > 0;
};
/** Things that paused while hidden and want to catch up when shown (feeds, iframes). */
const resumers = new Set();
const resumeVisible = () =>
  resumers.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  });

const fmtTime = new Intl.DateTimeFormat(LOCALE, { hour: cfg.HOUR_12 ? 'numeric' : '2-digit', minute: '2-digit', hour12: cfg.HOUR_12 });
const fmtDateLong = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDateShort = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDayMonth = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long' });
const fmtDayMonthShort = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const fmtMonthYear = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });
const fmtWeekday = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' });
const fmtWeekdayShort = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' });
const timeStr = (d) => fmtTime.format(d);
const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto', style: 'short' });
function timeAgo(date) {
  const s = (date - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(Math.round(s), 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}
function money(v, currency) {
  const digits = v >= 1000 ? 0 : v >= 1 ? 2 : 4;
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: currency.toUpperCase(),
      maximumFractionDigits: digits,
      minimumFractionDigits: Math.min(digits, 2),
    }).format(v);
  } catch {
    return v.toFixed(digits);
  }
}
