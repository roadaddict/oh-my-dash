/**
 * Smart home — Aqara sensors through the backend (lib/integrations/aqara.js) next to outdoor
 * air quality (EAQI, PM2.5 for LATITUDE/LONGITUDE). Or any iframe-able dashboard
 * (Home Assistant, SharpTools…), which takes precedence. Otherwise: demo tiles.
 */
OMD.defineWidget({
  id: 'smarthome',
  name: 'Smart home',
  icon: 'home',
  group: 'Home & web',
  integrations: ['aqara'],
  settings: [
    ['AQARA_REFRESH_SEC', 'Aqara sensors refresh (s)', 'number', { min: 30 }],
    ['SMART_HOME_URL', 'Or: smart home dashboard URL (iframe)', 'url', { placeholder: 'https://…', help: 'Takes precedence over Aqara tiles when set.' }],
    [
      ['SMART_HOME_ZOOM', 'Zoom', 'number', { step: 0.05, min: 0.25, max: 3 }],
      ['SMART_HOME_REFRESH_MIN', 'Refresh (min)', 'number', { min: 0 }],
    ],
  ],
  defaults: {
    AQARA_REFRESH_SEC: 60,
    SMART_HOME_URL: '',
    SMART_HOME_ZOOM: 1,
    SMART_HOME_REFRESH_MIN: 0,
  },

  mount(ctx) {
    const { h, icon, fmt, settings } = ctx;
    const p = ctx.panel({ title: 'Home', tint: 'amber', meta: 'Sensors' });
    if (settings.SMART_HOME_URL) {
      p.setMeta(ctx.util.hostOf(settings.SMART_HOME_URL) || 'Cloud hub');
      const frame = ctx.ui.frame(p.body, {
        url: settings.SMART_HOME_URL,
        title: 'Smart home',
        zoom: settings.SMART_HOME_ZOOM,
        refreshMin: settings.SMART_HOME_REFRESH_MIN,
        allow: 'fullscreen',
      });
      p.reloadable(frame.reload);
      return;
    }
    p.body.classList.add('tiles-host');
    // Longer timeout: a cold Worker cache makes several Aqara calls in a row.
    const aqaraFeed = ctx.sharedFeed('aqara', () => () => ctx.api('aqara/sensors', { timeout: 20000 }), Math.max(30, settings.AQARA_REFRESH_SEC) * 1000, {
      visibleOnly: true,
    });
    /* Outdoor air quality (Open-Meteo / Copernicus CAMS, no key), shown with the smart-home sensors.
       It changes hourly, so one small request every 30 min, only while the panel is on screen. */
    const airFeed = ctx.sharedFeed(
      'air',
      () => () =>
        ctx.fetchJSON(
          `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${settings.LATITUDE}&longitude=${settings.LONGITUDE}&current=european_aqi,pm2_5`,
        ),
      30 * 60000,
      { visibleOnly: true },
    );

    /** 2 = needs attention (open door, leak), 1 = activity (motion), 0 = normal. */
    const sensorAlert = (s) => (s.readings.contact?.value === 'open' || s.readings.leak?.value ? 2 : s.readings.motion?.value ? 1 : 0);
    /** One sensor → the same .tile markup the demo and data widgets use. */
    function sensorTile(s) {
      const r = s.readings;
      let ic = 'gauge',
        color = 'c-violet',
        value = '—',
        on = false;
      if (r.contact) {
        on = r.contact.value === 'open';
        ic = on ? 'door-open' : 'door-closed';
        color = on ? 'c-crimson' : 'c-emerald';
        value = on ? 'Open' : 'Closed';
      } else if (r.leak) {
        on = !!r.leak.value;
        ic = 'droplet';
        color = on ? 'c-crimson' : 'c-sky';
        value = on ? 'Leak!' : 'Dry';
      } else if (r.motion) {
        on = !!r.motion.value;
        ic = 'person-standing';
        color = 'c-amber';
        value = on ? 'Motion' : ['Clear', s.updated ? h('small', null, fmt.timeAgo(new Date(s.updated))) : null];
      } else if (r.temperature) {
        ic = 'thermometer';
        color = 'c-accent';
        value = [fmt.temp(r.temperature.value), r.humidity ? h('small', null, `${Math.round(r.humidity.value)}%`) : null];
      } else if (r.humidity) {
        ic = 'droplet';
        color = 'c-sky';
        value = `${Math.round(r.humidity.value)}%`;
      } else if (r.illuminance) {
        ic = 'sun';
        color = 'c-amber';
        value = `${r.illuminance.value} lx`;
      } else if (r.pressure) {
        value = `${r.pressure.value} hPa`;
      }
      const low = r.battery && r.battery.value <= 15;
      return h(
        'div',
        {
          class: `tile ${color}${on ? ' is-on' : ''}${s.online ? '' : ' is-offline'}`,
          title: [s.room, s.name, r.battery && `battery ${r.battery.value}%`, s.updated && `updated ${fmt.timeAgo(new Date(s.updated))}`]
            .filter(Boolean)
            .join(' · '),
        },
        h('span', { class: 'tile-icon' }, icon(ic)),
        h(
          'span',
          { class: 'tile-text' },
          h('div', { class: 'tile-label' }, low ? h('span', { class: 'tile-warn', title: `Battery ${r.battery.value}%` }, icon('battery-low')) : null, s.name),
          h('div', { class: 'tile-value' }, s.online ? value : 'Offline'),
        ),
      );
    }

    // European Air Quality Index bands; PM2.5 uses the same bands' µg/m³ limits.
    const AQI_BANDS = [
      [20, 'Good', 'c-emerald'],
      [40, 'Fair', 'c-emerald'],
      [60, 'Moderate', 'c-amber'],
      [80, 'Poor', 'c-crimson'],
      [100, 'Very poor', 'c-crimson'],
      [Infinity, 'Extremely poor', 'c-crimson'],
    ];
    const PM25_LIMITS = [10, 20, 25, 50, 75, Infinity];
    const statTile = ({ ic, color, on = false, label, value, title = '' }) =>
      h(
        'div',
        { class: `tile ${color}${on ? ' is-on' : ''}`, title },
        h('span', { class: 'tile-icon' }, icon(ic)),
        h('span', { class: 'tile-text' }, h('div', { class: 'tile-label' }, label), h('div', { class: 'tile-value' }, value)),
      );
    function airTiles(d) {
      const c = d?.current;
      if (!c) return [];
      const src = `Outdoor, ${settings.LOCATION_NAME} · Copernicus CAMS via Open-Meteo`,
        out = [];
      if (c.european_aqi != null) {
        const b = AQI_BANDS.findIndex(([max]) => c.european_aqi <= max),
          [, name, color] = AQI_BANDS[b];
        out.push(
          statTile({ ic: 'wind', color, on: b >= 3, label: 'Air quality', value: [name, h('small', null, `EAQI ${Math.round(c.european_aqi)}`)], title: src }),
        );
      }
      if (c.pm2_5 != null) {
        const b = PM25_LIMITS.findIndex((max) => c.pm2_5 <= max);
        out.push(
          statTile({
            ic: 'cloud-fog',
            color: AQI_BANDS[b][2],
            on: b >= 3,
            label: 'PM2.5',
            value: [String(Math.round(c.pm2_5 * 10) / 10), h('small', null, 'µg/m³')],
            title: src,
          }),
        );
      }
      return out;
    }

    function mountAqara() {
      const grid = h('div', { class: 'tiles' });
      p.body.append(grid);
      let last = null;
      function render(d, err) {
        if (d) last = d;
        if (!last) {
          grid.replaceChildren(h('div', { class: 'empty' }, icon('alert'), err ? err.message : 'Loading…'));
          return;
        }
        // Alerts (open doors, leaks, motion) first, then outdoor air, then the rest.
        // 6 tiles fill the panel; all show when expanded.
        const list = [...last.sensors].sort((a, b) => sensorAlert(b) - sensorAlert(a));
        const firstCalm = list.findIndex((s) => !sensorAlert(s));
        const tiles = list.map(sensorTile);
        tiles.splice(firstCalm < 0 ? tiles.length : firstCalm, 0, ...airTiles(airFeed.data));
        const shown = p.el.classList.contains('is-expanded') ? tiles : tiles.slice(0, 6);
        grid.replaceChildren(
          ...(list.length
            ? shown
            : [
                ...shown,
                h(
                  'div',
                  { class: 'empty' },
                  icon('home'),
                  'No sensors with readings',
                  h('small', null, 'Check /api/aqara/raw to see what the Aqara cloud returns.'),
                ),
              ]),
        );
        const alerts = list.filter((s) => sensorAlert(s) === 2).length;
        const hidden = tiles.length - shown.length;
        p.setMeta(`Aqara · ${alerts ? `${alerts} open · ` : ''}${list.length} sensors${hidden > 0 ? ` (+${hidden}, expand)` : ''}${err ? ' · offline' : ''}`);
      }
      ctx.subscribe(aqaraFeed, render);
      ctx.subscribe(airFeed, () => render());
      p.onReload = () => {
        aqaraFeed.refresh();
        airFeed.refresh();
      };
      p.onResize = () => render();
    }

    function mountDemoHome(hint) {
      // Mock sensor grid (demonstrates layout; tap lights / locks to toggle)
      const state = { temp: 21.5, door: false, light: true, hum: 46, lock: true, power: 1.24, fan: false, alarm: true };
      const devices = [
        { label: 'Living Room', ic: 'thermometer', color: 'c-accent', value: () => `${state.temp.toFixed(1)}°C`, on: () => true },
        {
          label: 'Front Door',
          ic: () => (state.door ? 'door-open' : 'door-closed'),
          color: () => (state.door ? 'c-crimson' : 'c-emerald'),
          value: () => (state.door ? 'Open' : 'Closed'),
          on: () => state.door,
          toggle: 'door',
        },
        { label: 'Kitchen', ic: 'lightbulb', color: 'c-amber', value: () => (state.light ? 'On · 80%' : 'Off'), on: () => state.light, toggle: 'light' },
        { label: 'Humidity', ic: 'droplet', color: 'c-sky', value: () => `${Math.round(state.hum)}%`, on: () => false },
        {
          label: 'Garage',
          ic: () => (state.lock ? 'lock' : 'lock-open'),
          color: () => (state.lock ? 'c-emerald' : 'c-crimson'),
          value: () => (state.lock ? 'Locked' : 'Unlocked'),
          on: () => !state.lock,
          toggle: 'lock',
        },
        { label: 'Energy', ic: 'zap', color: 'c-violet', value: () => `${state.power.toFixed(2)} kW`, on: () => false },
        { label: 'Air Purifier', ic: 'fan', color: 'c-sky', value: () => (state.fan ? 'Auto' : 'Off'), on: () => state.fan, toggle: 'fan' },
        { label: 'Security', ic: 'shield', color: 'c-emerald', value: () => (state.alarm ? 'Armed' : 'Disarmed'), on: () => state.alarm, toggle: 'alarm' },
      ];
      const val = (x) => (typeof x === 'function' ? x() : x);
      const grid = h('div', { class: 'tiles' });
      p.body.append(grid);
      function render() {
        // 6 tiles fill a 2×3 or 3×2 grid; all 8 show when the panel is expanded.
        const air = airTiles(airFeed.data);
        const shown = p.el.classList.contains('is-expanded') ? devices : devices.slice(0, Math.max(0, 6 - air.length));
        grid.replaceChildren(
          ...air,
          ...shown.map((d) =>
            h(
              d.toggle ? 'button' : 'div',
              {
                class: `tile ${val(d.color)}${d.on() ? ' is-on' : ''}`,
                type: d.toggle ? 'button' : null,
                'aria-pressed': d.toggle ? String(!!state[d.toggle]) : null,
                onclick: d.toggle
                  ? () => {
                      state[d.toggle] = !state[d.toggle];
                      render();
                    }
                  : null,
              },
              h('span', { class: 'tile-icon' }, icon(val(d.ic))),
              h('span', { class: 'tile-text' }, h('div', { class: 'tile-label' }, d.label), h('div', { class: 'tile-value' }, d.value())),
            ),
          ),
        );
        p.setMeta(ctx.ui.demoMeta(hint));
      }
      render();
      ctx.subscribe(airFeed, () => render());
      ctx.setInterval(() => {
        // gentle sensor drift so the mock feels live
        state.temp = Math.min(23.5, Math.max(19.5, state.temp + (Math.random() - 0.5) * 0.2));
        state.hum = Math.min(60, Math.max(38, state.hum + (Math.random() - 0.5)));
        state.power = Math.max(0.3, state.power + (Math.random() - 0.5) * 0.15 + (state.light ? 0.01 : -0.01));
        render();
      }, 30000);
      p.onReload = render;
      p.onResize = render;
    }

    ctx
      .status('aqara')
      .then(
        ctx.guard((st) => (st.connected ? mountAqara() : mountDemoHome(st.configured ? 'Connect Aqara in ⚙ Settings → Accounts' : 'Aqara: README → Aqara'))),
      );
  },
});
