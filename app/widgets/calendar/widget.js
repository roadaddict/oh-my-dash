/**
 * Calendar — agenda, week, month or "up next" from iCal feeds (native, dark), or the
 * official Google / Outlook embed. Public holidays are added (core: ctx.holidays).
 * Tap the layout button to switch views.
 */
const { startOfDay, addDays } = OMD.util;

/* Minimal RFC 5545 parser: VEVENT, all-day, UTC/local, DURATION, basic RRULE, EXDATE */
function parseICSDate(value, isDateOnlyHint) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  if (!hh || isDateOnlyHint) return { date: new Date(+y, +mo - 1, +d), allDay: true };
  const args = [+y, +mo - 1, +d, +hh, +mi, +(ss || 0)];
  // TZID-qualified times are treated as device-local (correct when tablet & calendar share a zone).
  return { date: z ? new Date(Date.UTC(...args)) : new Date(...args), allDay: false };
}
const icsText = (s) =>
  s
    .replace(/\\n/gi, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .trim();

function parseICS(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let ev = null,
    depth = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      ev = { exdates: [] };
      depth = 0;
      continue;
    }
    if (line === 'END:VEVENT') {
      if (ev?.start) events.push(ev);
      ev = null;
      continue;
    }
    if (!ev) continue;
    if (line.startsWith('BEGIN:')) {
      depth++;
      continue;
    } // skip nested VALARM etc.
    if (line.startsWith('END:')) {
      depth--;
      continue;
    }
    if (depth > 0) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const [key, ...params] = line.slice(0, idx).split(';');
    const value = line.slice(idx + 1);
    const dateOnly = params.includes('VALUE=DATE');
    switch (key) {
      case 'SUMMARY':
        ev.title = icsText(value);
        break;
      case 'LOCATION':
        ev.location = icsText(value);
        break;
      case 'DTSTART': {
        const p = parseICSDate(value, dateOnly);
        if (p) {
          ev.start = p.date;
          ev.allDay = p.allDay;
        }
        break;
      }
      case 'DTEND': {
        const p = parseICSDate(value, dateOnly);
        if (p) ev.end = p.date;
        break;
      }
      case 'DURATION': {
        const m = /P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(value);
        if (m) ev.durationMs = (((+m[1] || 0) * 7 + (+m[2] || 0)) * 24 * 60 + (+m[3] || 0) * 60 + (+m[4] || 0)) * 60000;
        break;
      }
      case 'RRULE':
        ev.rrule = value;
        break;
      case 'EXDATE':
        value.split(',').forEach((v) => {
          const p = parseICSDate(v, dateOnly);
          if (p) ev.exdates.push(p.date.getTime());
        });
        break;
      case 'STATUS':
        ev.cancelled = value === 'CANCELLED';
        break;
    }
  }
  return events.filter((e) => !e.cancelled);
}

function expandEvents(events, from, to) {
  const out = [];
  const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  for (const ev of events) {
    const dur = ev.end ? ev.end - ev.start : (ev.durationMs ?? (ev.allDay ? 864e5 : 36e5));
    const push = (d) => {
      if (d < to && d.getTime() + dur > from) out.push({ ...ev, start: d, end: new Date(d.getTime() + dur) });
    };
    if (!ev.rrule) {
      push(ev.start);
      continue;
    }

    const r = Object.fromEntries(ev.rrule.split(';').map((p) => p.split('=')));
    const interval = Math.max(1, +r.INTERVAL || 1);
    const count = r.COUNT ? +r.COUNT : Infinity;
    let until = null;
    if (r.UNTIL) {
      const p = parseICSDate(r.UNTIL);
      if (p) until = p.allDay ? new Date(p.date.getTime() + 864e5 - 1) : p.date;
    }
    const exd = new Set(ev.exdates);
    let n = 0;
    const emit = (d) => {
      if (++n > count || (until && d > until) || d >= to) return false;
      if (!exd.has(d.getTime())) push(d);
      return true;
    };
    const atStartTime = (d) => {
      d.setHours(ev.start.getHours(), ev.start.getMinutes(), ev.start.getSeconds(), 0);
      return d;
    };
    const unbounded = count === Infinity;

    if (r.FREQ === 'WEEKLY' && r.BYDAY) {
      const days = r.BYDAY.split(',')
        .map((x) => DOW.indexOf(x.slice(-2)))
        .filter((x) => x >= 0)
        .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      const weekStart = startOfDay(ev.start);
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      let w = 0;
      if (unbounded) {
        const weeks = Math.floor((from - weekStart) / (7 * 864e5)) - 1;
        if (weeks > 0) w = Math.floor(weeks / interval) * interval;
      }
      outer: for (let guard = 0; guard < 600; guard++, w += interval) {
        for (const dow of days) {
          const d = atStartTime(addDays(weekStart, w * 7 + ((dow + 6) % 7)));
          if (d < ev.start) continue;
          if (!emit(d)) break outer;
        }
      }
    } else {
      const stepDays = r.FREQ === 'DAILY' ? interval : r.FREQ === 'WEEKLY' ? 7 * interval : 0;
      let i = 0;
      if (unbounded && stepDays) {
        const k = Math.floor((from - ev.start) / (stepDays * 864e5)) - 1;
        if (k > 0) i = k;
      }
      for (let guard = 0; guard < 1500; guard++, i++) {
        const d = new Date(ev.start);
        if (r.FREQ === 'DAILY' || r.FREQ === 'WEEKLY') d.setDate(d.getDate() + i * stepDays);
        else if (r.FREQ === 'MONTHLY') d.setMonth(d.getMonth() + i * interval);
        else if (r.FREQ === 'YEARLY') d.setFullYear(d.getFullYear() + i * interval);
        else {
          emit(d);
          break;
        }
        if (!emit(d)) break;
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

OMD.defineWidget({
  id: 'calendar',
  name: 'Calendar',
  icon: 'calendar',
  group: 'Family',
  variants: { agenda: 'agenda', week: 'week', month: 'month', upnext: 'up next' },
  settings: [
    [
      'CALENDARS',
      'iCal feeds — native dark calendar',
      'textarea',
      { help: 'One per line: <code>Name | #8b9cff | https://…/basic.ics</code>. Google: Settings → calendar → “Secret address in iCal format”.' },
    ],
    [
      'CALENDAR_URL',
      'Or: Google calendar ID(s) / embed URL',
      'text',
      {
        placeholder: 'family0123…@group.calendar.google.com',
        help: 'For the Google <b>Family</b> calendar: Google Calendar → Settings → Family → Integrate calendar → Calendar ID. The tablet’s browser must be signed in to a family Google account. Used only when no iCal feeds are set.',
      },
    ],
    [
      ['CALENDAR_DAYS', 'Agenda days', 'number', { min: 1, max: 31 }],
      ['CALENDAR_REFRESH_MIN', 'Refresh (min)', 'number', { min: 1 }],
    ],
    ['CALENDAR_DARK_FILTER', 'Force dark mode on embedded calendar', 'checkbox'],
  ],
  /* Layer A — iframe embed (used when CALENDARS is empty):
       Google:  just paste the calendar ID(s), comma-separated, e.g. the Google Family
                calendar "family0123456789@group.calendar.google.com". Private calendars
                show when the kiosk browser is signed in to a Google account that can see them.
       Outlook: Settings → Calendar → Shared calendars → Publish → HTML link.
     Layer B — native dark calendars from iCal feeds: "Name | #color | https://…/basic.ics".
     Both empty → demo calendar. */
  defaults: {
    CALENDAR_URL: '',
    CALENDARS: [
      // "Family | #8b9cff | https://calendar.google.com/calendar/ical/…/basic.ics",
    ],
    CALENDAR_DARK_FILTER: true, // Invert light-themed calendar embeds into dark mode.
    CALENDAR_DAYS: 7, // Agenda look-ahead.
    CALENDAR_REFRESH_MIN: 15,
  },

  mount(ctx) {
    const { h, icon, settings: s, fmt, util } = ctx;
    const { PALETTE, hash, hexToRgb, ymd, pipe, hostOf } = util;
    const timeStr = (d) => fmt.time.format(d);
    const { weekday: fmtWeekday, weekdayShort: fmtWeekdayShort, dayMonth: fmtDayMonth, dateShort: fmtDateShort, monthYear: fmtMonthYear } = fmt;

    const calendarSources = s.CALENDARS.map((line, i) => {
      const parts = pipe(line);
      const url = parts[parts.length - 1];
      const color = parts.find((x) => /^#[0-9a-f]{6}$/i.test(x)) || PALETTE[i % PALETTE.length];
      const name = parts.length > 1 && !/^#/.test(parts[0]) ? parts[0] : `Calendar ${i + 1}`;
      return { name, color, url: url.replace(/^webcal:\/\//i, 'https://') };
    }).filter((x) => /^(https?:|data:)/i.test(x.url));
    const USE_CAL_EMBED = !!s.CALENDAR_URL && !calendarSources.length;
    const GCAL_MODE = { agenda: 'AGENDA', week: 'WEEK', month: 'MONTH' };
    const CAL_IS_GOOGLE = !/^https?:\/\//i.test(s.CALENDAR_URL.trim()) || /calendar\.google\.com/i.test(s.CALENDAR_URL);
    /**
     * Layer A embed URL. CALENDAR_URL may be a full embed URL, or just Google calendar
     * ID(s) — e.g. the family calendar "family0123…@group.calendar.google.com" — in which
     * case a clean embed is built. Google embeds get the view's mode (agenda/week/month).
     */
    function calendarEmbedUrl(mode) {
      const raw = s.CALENDAR_URL.trim();
      if (/^https?:\/\//i.test(raw)) {
        try {
          const u = new URL(raw);
          if (/calendar\.google\.com$/i.test(u.hostname)) u.searchParams.set('mode', GCAL_MODE[mode]);
          return u.href;
        } catch {
          return raw;
        }
      }
      const u = new URL('https://calendar.google.com/calendar/embed');
      raw
        .split(/[\s,]+/)
        .filter(Boolean)
        .forEach((id) => u.searchParams.append('src', id));
      const params = {
        ctz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        mode: GCAL_MODE[mode],
        wkst: String({ 0: 1, 1: 2, 6: 7 }[s.WEEK_START] || 2),
        hl: (s.LOCALE || navigator.language || 'en').replace('-', '_'),
        showTitle: 0,
        showNav: 1,
        showDate: 1,
        showPrint: 0,
        showTabs: 0,
        showCalendars: 0,
        showTz: 0,
        bgcolor: '#ffffff',
      };
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      return u.href;
    }
    const DEMO_CAL = !calendarSources.length;

    function demoEvents() {
      const now = new Date();
      const today = startOfDay(now);
      const at = (dayOffset, hh, mm = 0) => {
        const d = addDays(today, dayOffset);
        d.setHours(hh, mm, 0, 0);
        return d;
      };
      const nextHour = Math.min(22, now.getHours() + 1);
      const C = { fam: PALETTE[0], work: PALETTE[1], kids: PALETTE[2], fun: PALETTE[3] };
      const ev = (title, start, end, color, extra = {}) => ({ title, start, end, color, ...extra });
      const list = [
        ev('Design review', new Date(now.getTime() - 20 * 60000), new Date(now.getTime() + 25 * 60000), C.work, { location: 'Studio · Room 4' }),
        ev('Pick up groceries', at(0, nextHour, 30), at(0, nextHour + 1), C.fam, { location: 'Market Hall' }),
        ev('Recycling collection', at(1, 0), at(2, 0), C.fam, { allDay: true }),
        ev('Dentist', at(1, 9, 15), at(1, 10), C.fam, { location: 'Smile Clinic' }),
        ev('Yoga', at(1, 18, 30), at(1, 19, 30), C.fun, { location: 'Riverside Studio' }),
        ev('Team stand-up', at(2, 9, 30), at(2, 9, 45), C.work, { location: 'Video call' }),
        ev('Swimming lesson', at(2, 16, 30), at(2, 17, 15), C.kids),
        ev('Car service', at(3, 11), at(3, 12), C.fam, { location: 'Northgate Garage' }),
        ev('Parents evening', at(4, 18), at(4, 19), C.kids, { location: 'School hall' }),
        ev('Weekend away', at(5, 0), at(7, 0), C.fun, { allDay: true }),
        ev('Birthday party', at(6, 15), at(6, 18), C.kids, { location: 'The Green Room' }),
      ];
      // Recurring demo events so the month view looks lived-in.
      for (let i = -35; i < 42; i++) {
        const d = addDays(today, i),
          dow = d.getDay();
        if (dow === 2) list.push(ev('Football practice', at(i, 17), at(i, 18), C.kids));
        if (dow === 4) list.push(ev('Book club', at(i, 19, 30), at(i, 21), C.fun));
        if (dow === 1 && i % 14 < 7) list.push(ev('Bin day', at(i, 0), at(i + 1, 0), C.fam, { allDay: true }));
        if (dow === 3 && i % 14 < 7) list.push(ev('Piano lesson', at(i, 16), at(i, 17), C.kids));
      }
      return list;
    }
    const evColor = (e) => e.color || PALETTE[hash(e.title || '') % PALETTE.length];
    const sortDay = (a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || a.start - b.start;
    const overlaps = (e, from, to) => e.start < to && e.end > from;

    function renderAgenda(host, events, days) {
      const now = new Date(),
        today = startOfDay(now);
      const list = expandEvents(events, today, addDays(today, days));
      const groups = [];
      for (let i = 0; i < days; i++) {
        const dayStart = addDays(today, i),
          dayEnd = addDays(today, i + 1);
        const items = list.filter((e) => overlaps(e, dayStart, dayEnd) && (i > 0 || e.end > now) && (e.allDay || i === 0 || e.start >= dayStart)); // timed events don't repeat on the next day
        if (!items.length) continue;
        items.sort(sortDay);
        const name = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtWeekday.format(dayStart);
        groups.push(
          h(
            'section',
            null,
            h('h3', { class: `day-label${i === 0 ? ' is-today' : ''}` }, name, h('span', null, fmtDayMonth.format(dayStart))),
            h(
              'div',
              { class: 'events' },
              items.slice(0, 12).map((e) => {
                const isNow = !e.allDay && e.start <= now && e.end > now;
                const minsTo = Math.round((e.start - now) / 60000);
                const tag = isNow ? 'Now' : i === 0 && !e.allDay && minsTo > 0 && minsTo <= 90 ? `in ${minsTo} min` : '';
                const when = e.allDay ? (e.holiday ? 'Public holiday' : 'All day') : `${timeStr(e.start)} – ${timeStr(e.end)}`;
                return h(
                  'div',
                  { class: `event${isNow ? ' is-now' : ''}`, style: { '--c': evColor(e) } },
                  h('span', { class: 'event-bar' }),
                  h(
                    'div',
                    { style: { minWidth: '0' } },
                    h('div', { class: 'event-title' }, e.title || '(No title)'),
                    h('div', { class: 'event-sub' }, e.location ? `${when} · ${e.location}` : when),
                  ),
                  tag ? h('span', { class: 'event-tag' }, tag) : null,
                );
              }),
            ),
          ),
        );
      }
      host.replaceChildren(
        groups.length
          ? h('div', { class: 'agenda scroll-y' }, groups)
          : h('div', { class: 'empty' }, icon('calendar'), `Nothing scheduled in the next ${days} days`),
      );
    }

    function renderWeek(host, events) {
      const today = startOfDay(new Date());
      const list = expandEvents(events, today, addDays(today, 7));
      host.replaceChildren(
        h(
          'div',
          { class: 'week' },
          Array.from({ length: 7 }, (_, i) => {
            const d0 = addDays(today, i),
              d1 = addDays(today, i + 1);
            const items = list.filter((e) => overlaps(e, d0, d1) && (e.allDay || e.start >= d0 || i === 0)).sort(sortDay);
            return h(
              'div',
              { class: `w-col${i === 0 ? ' is-today' : ''}` },
              h('div', { class: 'w-head' }, fmtWeekdayShort.format(d0), h('b', null, d0.getDate())),
              items.map((e) =>
                h(
                  'div',
                  { class: 'w-ev', style: { '--c': evColor(e) } },
                  h('span', null, e.allDay ? 'All day' : timeStr(e.start)),
                  h('b', null, e.title || '(No title)'),
                ),
              ),
            );
          }),
        ),
      );
    }

    function renderMonth(host, events) {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const offset = (first.getDay() - s.WEEK_START + 7) % 7;
      const gridStart = addDays(first, -offset);
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const weeks = Math.ceil((offset + daysInMonth) / 7);
      const list = expandEvents(events, gridStart, addDays(gridStart, weeks * 7));
      const todayKey = ymd(now);
      const head = h(
        'div',
        { class: 'month-head' },
        Array.from({ length: 7 }, (_, i) => h('span', null, fmtWeekdayShort.format(addDays(gridStart, i)))),
      );
      const grid = h('div', { class: 'month-grid', style: { gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` } });
      for (let i = 0; i < weeks * 7; i++) {
        const d0 = addDays(gridStart, i),
          d1 = addDays(gridStart, i + 1);
        const items = list.filter((e) => overlaps(e, d0, d1) && (e.allDay || e.start >= d0)).sort(sortDay);
        const weekend = d0.getDay() === 0 || d0.getDay() === 6;
        grid.append(
          h(
            'div',
            { class: `m-cell${d0.getMonth() !== now.getMonth() ? ' is-out' : ''}${ymd(d0) === todayKey ? ' is-today' : ''}${weekend ? ' is-weekend' : ''}` },
            h('div', { class: 'm-num' }, h('span', null, d0.getDate()), h('span', { class: 'm-more' })),
            items.map((e) => {
              const c = evColor(e);
              return h('div', { class: `m-ev ${e.allDay ? 'all' : 'timed'}`, style: { '--c': c, '--cbg': `${c}55` }, title: e.title }, e.title || '(No title)');
            }),
          ),
        );
      }
      host.replaceChildren(h('div', { class: 'month' }, head, grid));
      // Trim chips that don't fit and show "+N more".
      ctx.raf(() =>
        grid.querySelectorAll('.m-cell').forEach((cell) => {
          const chips = [...cell.querySelectorAll('.m-ev')];
          let hidden = 0;
          while (chips.length && cell.scrollHeight > cell.clientHeight + 1) {
            chips.pop().remove();
            hidden++;
          }
          if (hidden) cell.querySelector('.m-more').textContent = `+${hidden}`;
        }),
      );
    }

    /** "25 min" · "1 h 20 min" · "3 days" */
    const fmtSpan = (ms) => {
      const m = Math.max(1, Math.round(ms / 60000));
      return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${Math.round(m / 1440)} days`;
    };
    /**
     * Up next: the next (or current) timed event. When nothing timed is coming up, what's
     * still going on instead — today's all-day events, a trip that spans several days.
     */
    function renderUpNext(host, events) {
      const now = new Date();
      const all = expandEvents(events, now, addDays(now, 30))
        .filter((e) => e.end > now)
        .sort((a, b) => a.start - b.start);
      const timed = all.filter((e) => !e.allDay);
      const allDayNow = all.filter((e) => e.allDay && e.start <= now);
      const pool = timed.length ? timed : allDayNow;
      if (!pool.length) {
        host.replaceChildren(h('div', { class: 'empty' }, icon('calendar'), 'Nothing coming up'));
        return;
      }
      const [next, ...rest] = pool;
      const live = next.start <= now;
      const lastDay = new Date(next.end - 1);
      let label, when, count;
      if (next.allDay) {
        const days = Math.max(1, Math.round((startOfDay(next.end) - startOfDay(next.start)) / 864e5));
        const day = Math.round((startOfDay(now) - startOfDay(next.start)) / 864e5) + 1;
        label = 'Today';
        when = days > 1 ? `${fmtDateShort.format(next.start)} – ${fmtDateShort.format(lastDay)}` : 'All day';
        count = days > 1 ? `Day ${day} of ${days}` : 'All day';
      } else {
        label = live ? 'Happening now' : 'Up next';
        when = `${fmtDateShort.format(next.start)} · ${timeStr(next.start)} – ${timeStr(next.end)}`;
        count = live ? `${fmtSpan(next.end - now)} left` : `in ${fmtSpan(next.start - now)}`;
      }
      // Timed events lead; today's all-day ones still get a quiet line.
      const alsoToday = timed.length ? allDayNow.map((e) => e.title).filter(Boolean) : [];
      const c = evColor(next);
      host.replaceChildren(
        h(
          'div',
          { class: 'upnext' },
          h(
            'div',
            { class: `upnext-hero${live ? ' is-live' : ''}`, style: { '--c': c, '--c-rgb': hexToRgb(c) } },
            h('small', null, label),
            h('h3', null, next.title || '(No title)'),
            h('p', null, `${when}${next.location ? ` · ${next.location}` : ''}`),
            h('div', { class: 'count' }, count),
          ),
          alsoToday.length ? h('div', { class: 'upnext-also' }, h('b', null, 'Today'), ` ${alsoToday.join(' · ')}`) : null,
          h(
            'div',
            { class: 'events scroll-y' },
            rest
              .slice(0, 6)
              .map((e) =>
                h(
                  'div',
                  { class: 'event', style: { '--c': evColor(e) } },
                  h('span', { class: 'event-bar' }),
                  h(
                    'div',
                    { style: { minWidth: '0' } },
                    h('div', { class: 'event-title' }, e.title),
                    h(
                      'div',
                      { class: 'event-sub' },
                      e.allDay ? `${fmtDateShort.format(e.start)} · all day` : `${fmtDateShort.format(e.start)} · ${timeStr(e.start)}`,
                    ),
                  ),
                ),
              ),
          ),
        ),
      );
    }

    const VIEWS = ['agenda', 'week', 'month', 'upnext'];
    let view = VIEWS.includes(ctx.spec.view) ? ctx.spec.view : 'agenda';
    const p = ctx.panel({ title: ctx.spec.title || 'Calendar', tint: 'accent', dark: !!ctx.spec.dark });

    if (USE_CAL_EMBED) {
      // Layer A — official embed (e.g. the Google family calendar)
      const MODES = ['agenda', 'week', 'month'];
      let mode = view === 'month' || view === 'week' ? view : 'agenda';
      let frame = null;
      const mountEmbed = () => {
        frame?.destroy();
        const url = calendarEmbedUrl(mode);
        p.setMeta(`${mode[0].toUpperCase()}${mode.slice(1)} · ${CAL_IS_GOOGLE ? 'Google Calendar' : hostOf(url)}`);
        // No forced reloads: Google's embed keeps itself up to date.
        frame = ctx.ui.frame(p.body, { url, title: 'Calendar', invert: s.CALENDAR_DARK_FILTER, skeletonKind: 'list' });
      };
      if (CAL_IS_GOOGLE)
        p.addAction('layout', 'Change calendar view', () => {
          mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
          mountEmbed();
        });
      mountEmbed();
      p.reloadable(() => frame.reload());
      return;
    }

    // One feed for every calendar on every screen (Home agenda, Family month, Frame agenda).
    const calendarFeed = ctx.sharedFeed(
      'events',
      () => async () => {
        const errors = [];
        let events = [];
        if (DEMO_CAL) events = demoEvents();
        else {
          const results = await Promise.allSettled(
            calendarSources.map(async (src) => parseICS(await ctx.fetchText(src.url)).map((e) => ({ ...e, color: src.color, cal: src.name }))),
          );
          results.forEach((r, i) =>
            r.status === 'fulfilled' ? events.push(...r.value) : errors.push(`${calendarSources[i].name}: ${r.reason?.message || r.reason}`),
          );
          if (!events.length && errors.length) throw new Error(errors.join(' · '));
        }
        try {
          events.push(...(await ctx.holidays()));
        } catch {
          /* holidays are optional */
        }
        return { events, errors, demo: DEMO_CAL };
      },
      s.CALENDAR_REFRESH_MIN * 60000,
    );

    let data = null;
    const LABEL = { agenda: `Next ${s.CALENDAR_DAYS} days`, week: 'Next 7 days', upnext: 'Up next' };
    const draw = () => {
      if (!data) return;
      if (view === 'agenda') renderAgenda(p.body, data.events, s.CALENDAR_DAYS);
      else if (view === 'week') renderWeek(p.body, data.events);
      else if (view === 'month') renderMonth(p.body, data.events);
      else renderUpNext(p.body, data.events);
      const label = view === 'month' ? fmtMonthYear.format(new Date()) : LABEL[view];
      if (data.demo) p.setMeta(h('span', { class: 'badge' }, 'Demo'), ` ${label} · add CALENDARS`);
      else
        p.setMeta(
          calendarSources.length > 1 ? calendarSources.map((x) => h('span', { class: 'legend', style: { '--c': x.color } }, h('i'), x.name)) : [],
          label,
          data.errors.length ? h('span', { class: 'late', title: data.errors.join('\n') }, ' · ⚠ feed error') : null,
        );
    };
    p.addAction('layout', 'Change calendar view', () => {
      view = VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length];
      draw();
    });
    p.body.replaceChildren(h('div', { class: 'frame', style: { background: 'transparent', boxShadow: 'none' } }, ctx.ui.skeleton('list')));
    ctx.subscribe(calendarFeed, (d, err) => {
      if (d) {
        data = d;
        draw();
      } else if (err && !data) {
        p.body.replaceChildren(
          h(
            'div',
            { class: 'empty' },
            icon('alert'),
            h('div', null, 'Could not load the calendar feed.'),
            h(
              'small',
              null,
              ctx.hasProxy
                ? String(err.message || err)
                : 'The feed probably blocks cross-origin requests — set CORS_PROXY in settings (see cors-proxy/worker.js).',
            ),
          ),
        );
      }
    });
    ctx.onTick((n) => {
      if (n.getSeconds() === 0 && (view === 'agenda' || view === 'upnext' || n.getMinutes() % 30 === 0)) draw();
    });
    let lastSize = '';
    ctx.observeResize(p.body, () => {
      const size = `${p.body.clientWidth}x${p.body.clientHeight}`;
      if (view === 'month' && size !== lastSize) {
        lastSize = size;
        ctx.raf(draw);
      }
    });
    p.onReload = () => calendarFeed.refresh();
  },
});
