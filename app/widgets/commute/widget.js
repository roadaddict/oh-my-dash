/**
 * Commute — per destination: public transport (live: VBB in Berlin/Brandenburg, Transitous
 * elsewhere in Europe), car (live traffic with the TOMTOM_KEY Worker secret, through
 * lib/integrations/tomtom.js; else typical drive time), bike or on foot (OpenStreetMap).
 * Addresses: Photon (OSM), biased to home. Its settings use a custom editor (fields.commutes).
 */
const COMMUTE_MODES = {
  public: { ic: 'train', label: 'Public transport' },
  car: { ic: 'car', label: 'Car' },
  bike: { ic: 'bike', label: 'Bike' },
  foot: { ic: 'footprints', label: 'On foot' },
};
const MODE_ALIASES = {
  transit: 'public',
  pt: 'public',
  bus: 'public',
  train: 'public',
  öpnv: 'public',
  oepnv: 'public',
  drive: 'car',
  driving: 'car',
  auto: 'car',
  bicycle: 'bike',
  cycle: 'bike',
  cycling: 'bike',
  walk: 'foot',
  walking: 'foot',
};
const modeOf = (s) => {
  const k = String(s || '')
    .trim()
    .toLowerCase();
  return COMMUTE_MODES[k] ? k : MODE_ALIASES[k] || null;
};
/** "Name | destination | mode | origin" — the older "Name | destination | origin" still works (car). */
function parseCommute(line) {
  const [name = '', to = '', a = '', b = ''] = OMD.util.pipe(line);
  const m = modeOf(a);
  return { name, to, mode: m || 'car', from: m ? b : a };
}

/** Address search and geocoding (Photon / Nominatim, biased to home), cached on the device. */
function places({ fetchJSON, settings, local }) {
  const geoStore = local('geocode', {}, { legacyKey: 'omd.geocode.v2' });
  const photonLabel = (p) => [...new Set([p.name, [p.street, p.housenumber].filter(Boolean).join(' '), p.district, p.city].filter(Boolean))].join(', ');
  async function photon(q, limit = 5) {
    const j = await fetchJSON(`https://photon.komoot.io/api/?limit=${limit}&q=${encodeURIComponent(q)}&lat=${settings.LATITUDE}&lon=${settings.LONGITUDE}`);
    return (j.features || []).map((f) => ({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], label: photonLabel(f.properties || {}) }));
  }
  /** Address or "lat,lon" → coordinates (cached on the device). Places near home win. */
  async function geocode(q) {
    if (/^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(q)) {
      const [lat, lon] = q.split(',').map(Number);
      return { lat, lon, label: q.trim() };
    }
    const cache = geoStore.get();
    if (cache[q]) return cache[q];
    let hit = (await photon(q, 1).catch(() => []))[0];
    if (!hit) {
      const j = await fetchJSON(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
      if (j[0]) hit = { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name.split(',').slice(0, 3).join(',') };
    }
    if (!hit) throw new Error(`Place not found: ${q}`);
    cache[q] = hit;
    geoStore.set(cache);
    return hit;
  }
  return { photon, geocode };
}

async function routeOsm(ctx, profile, a, b) {
  const j = await ctx.fetchJSON(`https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
  if (!j.routes?.[0]) throw new Error('No route');
  return { mins: j.routes[0].duration / 60, km: j.routes[0].distance / 1000, source: 'OSM' };
}
/** Next journey leaving now: when to leave, lines, arrival, live delays. */
async function routePublic(ctx, a, b) {
  try {
    const q = new URLSearchParams({
      'from.latitude': a.lat,
      'from.longitude': a.lon,
      'from.address': 'Start',
      'to.latitude': b.lat,
      'to.longitude': b.lon,
      'to.address': 'Destination',
      results: 1,
      stopovers: 'false',
      remarks: 'false',
      polylines: 'false',
    });
    const j = await ctx.fetchJSON(`https://v6.vbb.transport.rest/journeys?${q}`, AbortSignal.timeout ? { signal: AbortSignal.timeout(12000) } : {});
    const legs = j.journeys?.[0]?.legs;
    if (!legs?.length) throw new Error('no journey');
    const rides = legs.filter((l) => !l.walking && l.line);
    const delays = rides.map((l) => l.departureDelay).filter((d) => d != null);
    return {
      leave: Date.parse(legs[0].departure || legs[0].plannedDeparture),
      arrive: Date.parse(legs.at(-1).arrival || legs.at(-1).plannedArrival),
      lines: rides.map((l) =>
        /^\d/.test(l.line.name) ? `${{ bus: 'Bus', tram: 'Tram', ferry: 'Ferry' }[l.line.product] || ''} ${l.line.name}`.trim() : l.line.name,
      ),
      delay: Math.max(0, ...rides.map((l) => l.departureDelay || 0)) / 60,
      cancelled: legs.some((l) => l.cancelled),
      live: delays.length > 0,
      source: 'VBB live',
    };
  } catch {
    // Outside Berlin/Brandenburg (or VBB down): Transitous, Europe-wide open transit routing.
    const j = await ctx.fetchJSON(`https://api.transitous.org/api/v1/plan?fromPlace=${a.lat},${a.lon}&toPlace=${b.lat},${b.lon}&numItineraries=1`);
    const it = j.itineraries?.[0];
    if (!it) throw new Error('No connection found');
    const rides = it.legs.filter((l) => l.mode !== 'WALK');
    return {
      leave: Date.parse(it.startTime),
      arrive: Date.parse(it.endTime),
      lines: rides.map((l) => l.routeShortName || l.mode.toLowerCase()),
      delay: 0,
      live: rides.some((l) => l.realTime),
      source: 'Transitous',
    };
  }
}

/** Commute destinations: name · address (with suggestions) · mode · optional start. Saved as COMMUTES lines. */
function commuteEditor(kit) {
  const { h, icon, key, label, value, help } = kit;
  const { photon, geocode } = places(kit);
  const hidden = h('textarea', { name: key, hidden: true });
  const rows = h('div', { class: 'cm-rows' });
  const datalist = h('datalist', { id: 'cm-places' });
  const sync = () => {
    hidden.value = [...rows.children]
      .map((r) => r._line())
      .filter(Boolean)
      .join('\n');
  };
  let suggestTimer = 0;
  const suggest = (q) => {
    kit.clearTimeout(suggestTimer);
    if (q.trim().length < 3) return;
    suggestTimer = kit.setTimeout(async () => {
      const hits = await photon(q, 6).catch(() => []);
      datalist.replaceChildren(...hits.map((x) => h('option', { value: x.label })));
    }, 300);
  };
  function addRow(c = { name: '', to: '', mode: 'public', from: '' }) {
    const name = h('input', { type: 'text', placeholder: 'Name, e.g. Work', value: c.name, 'aria-label': 'Name', oninput: () => sync() });
    const mode = h(
      'select',
      { 'aria-label': 'How', onchange: () => sync() },
      Object.entries(COMMUTE_MODES).map(([k, m]) => h('option', { value: k, selected: k === c.mode }, m.label)),
    );
    const place = (attrs) =>
      h('input', {
        type: 'text',
        list: 'cm-places',
        autocomplete: 'off',
        ...attrs,
        oninput: (e) => {
          sync();
          suggest(e.target.value);
        },
        onchange: (e) => check(e.target),
      });
    const to = place({ placeholder: 'Address or place', value: c.to, 'aria-label': 'Destination' });
    const from = place({ placeholder: 'From: home', value: c.from || '', 'aria-label': 'Start (optional)' });
    const hint = h('small', { class: 'cm-hint' });
    const del = h(
      'button',
      {
        class: 'icon-btn',
        type: 'button',
        'aria-label': 'Remove destination',
        onclick: () => {
          row.remove();
          sync();
        },
      },
      icon('x'),
    );
    const row = h('div', { class: 'cm-row' }, h('div', { class: 'field-inline' }, name, mode, del), h('div', { class: 'field-inline' }, to, from), hint);
    row._line = () => {
      const n = name.value.trim().replace(/\|/g, '/'),
        t = to.value.trim().replace(/\|/g, '/'),
        f = from.value.trim().replace(/\|/g, '/');
      return n && t ? [n, t, mode.value, f].filter((x, i) => i < 3 || x).join(' | ') : '';
    };
    const check = async (input) => {
      if (!input.value.trim()) {
        hint.textContent = '';
        return;
      }
      hint.textContent = 'Looking up…';
      try {
        const g = await geocode(input.value.trim());
        hint.textContent = `📍 ${g.label || `${g.lat.toFixed(4)}, ${g.lon.toFixed(4)}`}`;
      } catch (e) {
        hint.textContent = `⚠ ${e.message}`;
      }
    };
    rows.append(row);
    if (c.to) check(to);
    sync();
    return name;
  }
  value.map(parseCommute).forEach((c) => addRow(c));
  const add = h('button', { class: 'btn', type: 'button', onclick: () => addRow().focus() }, icon('plus'), h('span', null, 'Add destination'));
  return h('div', { class: 'field' }, h('span', null, label), rows, add, help, datalist, hidden);
}

OMD.defineWidget({
  id: 'commute',
  name: 'Commute',
  icon: 'car',
  group: 'Getting around',
  integrations: ['tomtom'],
  settings: [
    [
      'COMMUTES',
      'Destinations',
      'commutes',
      {
        help: 'Public transport is live (VBB in Berlin/Brandenburg, Transitous elsewhere). Car uses live traffic once the Worker has the <code>TOMTOM_KEY</code> secret (README → Secrets); bike and foot use OpenStreetMap routing.',
      },
    ],
    ['COMMUTE_REFRESH_MIN', 'Refresh (min)', 'number', { min: 2 }],
  ],
  /* "Name | destination (address or lat,lon) | public · car · bike · foot | origin (optional, default = home)" */
  defaults: {
    COMMUTES: [],
    COMMUTE_REFRESH_MIN: 5,
  },
  fields: { commutes: commuteEditor },

  mount(ctx) {
    const { h, icon, fmt, settings: s } = ctx;
    const { geocode } = places(ctx);
    async function routeCar(a, b) {
      if ((await ctx.status('tomtom')).configured) {
        const j = await ctx.api(`tomtom/route?from=${a.lat},${a.lon}&to=${b.lat},${b.lon}`);
        return { mins: j.mins, delay: j.delay, km: j.km, live: true, source: 'TomTom traffic' };
      }
      return { ...(await routeOsm(ctx, 'car', a, b)), live: false };
    }
    const commuteFeed = ctx.sharedFeed(
      'routes',
      () => async () => {
        const routes = s.COMMUTES.map(parseCommute).filter((r) => r.name && r.to);
        if (!routes.length) {
          const now = Date.now();
          return {
            demo: true,
            items: [
              { name: 'Work', mode: 'public', lines: ['U5', 'S3'], leave: now + 4 * 60000, arrive: now + 31 * 60000, delay: 2, live: true },
              { name: 'School', mode: 'bike', mins: 12, km: 3.4 },
              { name: 'Grandparents', mode: 'car', mins: 24, delay: 6, km: 11.2, live: true },
            ],
          };
        }
        const items = await Promise.all(
          routes.map(async (r) => {
            try {
              const b = await geocode(r.to);
              const a = r.from ? await geocode(r.from) : { lat: s.LATITUDE, lon: s.LONGITUDE };
              const res = r.mode === 'public' ? await routePublic(ctx, a, b) : r.mode === 'car' ? await routeCar(a, b) : await routeOsm(ctx, r.mode, a, b);
              return { ...r, ...res, at: Date.now() };
            } catch (e) {
              return { ...r, error: e.message };
            }
          }),
        );
        return { demo: false, items };
      },
      Math.max(2, s.COMMUTE_REFRESH_MIN) * 60000,
      { visibleOnly: true },
    );

    const p = ctx.panel({ tint: 'cyan' });
    const list = h('div', { class: 'rows scroll-y' });
    p.body.append(list);
    let data = null;
    const mins = (ms) => Math.max(0, Math.round(ms / 60000));
    function row(r) {
      const mode = COMMUTE_MODES[r.mode] || COMMUTE_MODES.car;
      const ic = h('span', { class: 'tile-icon' }, icon(r.error ? 'alert' : mode.ic));
      if (r.error)
        return h(
          'div',
          { class: 'commute' },
          ic,
          h('div', null, h('div', { class: 'commute-name' }, r.name), h('div', { class: 'commute-sub' }, r.error)),
          h('span'),
        );
      const now = Date.now();
      let sub, total, arrive;
      if (r.mode === 'public') {
        const leaveIn = mins(r.leave - now),
          delay = Math.round(r.delay || 0);
        arrive = r.arrive;
        total = mins(r.arrive - now);
        sub = [
          r.lines.length ? `${r.lines.join(' → ')} · ` : 'Walk · ',
          leaveIn ? `leave in ${leaveIn} min` : 'leave now',
          r.cancelled
            ? [' · ', h('span', { class: 'down' }, 'cancelled')]
            : delay
              ? [' · ', h('span', { class: delay > 5 ? 'down' : 'late' }, `+${delay} min`)]
              : r.live
                ? [' · ', h('span', { class: 'ontime' }, 'on time')]
                : null,
        ];
      } else {
        total = Math.round(r.mins);
        arrive = now + r.mins * 60000;
        const dist = ctx.imperial ? `${(r.km * 0.621).toFixed(1)} mi` : `${r.km.toFixed(1)} km`;
        const delay = Math.round(r.delay || 0);
        sub = [
          dist,
          ' · ',
          r.mode === 'car'
            ? r.live
              ? delay > 1
                ? h('span', { class: delay > 15 ? 'down' : delay > 5 ? 'late' : 'ontime' }, `+${delay} min traffic`)
                : h('span', { class: 'ontime' }, 'clear roads')
              : 'typical, no live traffic'
            : mode.label.toLowerCase(),
        ];
      }
      return h(
        'div',
        { class: `commute is-${r.mode}`, title: `${mode.label}${r.source ? ` · ${r.source}` : ''}` },
        ic,
        h('div', { style: { minWidth: '0' } }, h('div', { class: 'commute-name' }, r.name), h('div', { class: 'commute-sub' }, sub)),
        h('div', { class: 'commute-min' }, h('b', null, total), h('small', null, `min · ${fmt.time.format(new Date(arrive))}`)),
      );
    }
    function render() {
      if (!data) return;
      list.replaceChildren(...data.items.map(row));
      const sources = [...new Set(data.items.map((r) => r.source).filter(Boolean))];
      const carNoKey = data.items.some((r) => r.mode === 'car' && !r.error && !r.live);
      p.setMeta(
        data.demo
          ? ctx.ui.demoMeta('Add destinations in ⚙ → Commute')
          : [sources.join(' · ') || 'Commute', carNoKey ? ' · add the TOMTOM_KEY secret for traffic' : ''].join(''),
      );
    }
    ctx.subscribe(commuteFeed, (d) => {
      if (d) {
        data = d;
        render();
      }
    });
    ctx.onTick((n) => {
      if (n.getSeconds() === 0 && ctx.isVisible()) render();
    });
    p.onReload = () => commuteFeed.refresh();
  },
});
