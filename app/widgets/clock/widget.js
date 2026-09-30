/**
 * Clock — the time with a greeting and the date, in three variants:
 *   full     big clock + the full weather component (Home)
 *   compact  one row: clock · date · current weather (Family)
 *   overlay  large white clock + weather over the photos (Frame)
 */
OMD.defineWidget({
  id: 'clock',
  name: 'Clock',
  icon: 'hourglass',
  group: 'Time & weather',
  variants: { full: 'with weather', compact: 'compact', overlay: 'over photos' },
  settings: [
    [
      [
        'CLOCK_STYLE',
        'Clock style',
        'select',
        {
          options: [
            ['digital', 'Digital'],
            ['analog', 'Analog'],
          ],
        },
      ],
      ['SHOW_SECONDS', 'Show seconds', 'checkbox'],
    ],
  ],
  defaults: {
    SHOW_SECONDS: true,
    CLOCK_STYLE: 'digital', // "digital" | "analog"
  },

  mount(ctx) {
    const { h, icon, settings: s, fmt, weather } = ctx;
    const variant = ['full', 'compact', 'overlay'].includes(ctx.spec.variant) ? ctx.spec.variant : 'full';
    const p = ctx.panel({ head: false, bare: variant === 'overlay', compact: variant === 'compact' });
    p.el.classList.add(`v-${variant}`);
    const analog = s.CLOCK_STYLE === 'analog';

    const digitalClock = () => {
      const hm = h('span', { class: 'clock-hm' }),
        ampm = h('span', { class: 'clock-ampm' }),
        sec = h('span', { class: 'clock-sec' });
      const el = h('div', { class: 'clock' }, hm, h('span', { class: 'clock-side' }, ampm, sec));
      const partsFmt = new Intl.DateTimeFormat(ctx.locale, { hour: s.HOUR_12 ? 'numeric' : '2-digit', minute: '2-digit', hour12: s.HOUR_12 });
      ctx.onTick((now) => {
        const parts = partsFmt.formatToParts(now);
        const get = (t) => parts.find((x) => x.type === t)?.value ?? '';
        hm.textContent = `${get('hour')}:${get('minute')}`;
        ampm.textContent = s.HOUR_12 ? get('dayPeriod') : '';
        sec.textContent = s.SHOW_SECONDS ? ctx.util.pad2(now.getSeconds()) : '';
      });
      return el;
    };
    const greetingFor = (hr) => (hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening');

    const date = h('div', { class: variant === 'overlay' ? 'ov-date' : 'hero-date' });
    const greeting = h('div', { class: 'greeting' });
    ctx.onTick((n) => {
      if (n.getSeconds() === 0 || !date.textContent) {
        date.textContent = fmt.dateLong.format(n);
        greeting.textContent = greetingFor(n.getHours());
      }
    });

    if (variant === 'full') {
      const wx = h('div', { class: 'hero-wx' });
      p.body.append(h('div', { class: 'hero' }, h('div', { class: 'hero-top' }, greeting, date), analog ? ctx.ui.analogClock() : digitalClock(), wx));
      ctx.ui.weather(wx);
    } else if (variant === 'compact') {
      const wx = h('div', { class: 'wx-mini' });
      p.body.append(h('div', { class: 'hero-row' }, digitalClock(), h('div', { class: 'stack' }, date, greeting), wx));
      ctx.subscribe(weather.feed, (d) => {
        if (!d) return;
        const w = weather.wmo(d.current.weather_code, d.current.is_day);
        wx.replaceChildren(
          h('span', { style: { color: w.tone } }, icon(w.ic)),
          h(
            'div',
            null,
            h('b', null, `${Math.round(d.current.temperature_2m)}°`),
            h('small', null, `H ${Math.round(d.daily.temperature_2m_max[0])}° · L ${Math.round(d.daily.temperature_2m_min[0])}°`),
          ),
        );
      });
    } else {
      const wx = h('div', { class: 'ov-wx' });
      p.body.style.justifyContent = 'flex-end';
      p.body.append(date, analog ? ctx.ui.analogClock() : digitalClock(), wx);
      ctx.subscribe(weather.feed, (d) => {
        if (!d) return;
        const w = weather.wmo(d.current.weather_code, d.current.is_day);
        wx.replaceChildren(
          h(
            'div',
            { class: 'ov-now' },
            icon(w.ic),
            h('div', null, h('b', null, `${Math.round(d.current.temperature_2m)}°`), h('span', null, `${w.label} · ${s.LOCATION_NAME}`)),
          ),
          h(
            'div',
            { class: 'ov-fc' },
            d.daily.time.slice(1, 5).map((t, i) => {
              const dw = weather.wmo(d.daily.weather_code[i + 1], 1);
              return h(
                'div',
                null,
                fmt.weekdayShort.format(weather.localDate(t)),
                icon(dw.ic),
                `${Math.round(d.daily.temperature_2m_max[i + 1])}° / ${Math.round(d.daily.temperature_2m_min[i + 1])}°`,
              );
            }),
          ),
        );
      });
    }
  },
});
