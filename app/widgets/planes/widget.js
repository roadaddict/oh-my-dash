/**
 * Planes overhead — live ADS-B positions (adsb.fi, adsb.lol) on a little radar, with
 * routes from adsbdb. Position feeds send no CORS headers, so this needs the proxy
 * (the Worker's /api/proxy, or CORS_PROXY). Centred on LATITUDE / LONGITUDE.
 */
const toRad = (d) => (d * Math.PI) / 180;
function distBearing(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1),
    dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const km = 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return { km, bearing: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 };
}

// Flight routes (airline, origin → destination) — adsbdb.com, CORS-enabled, cached per callsign.
const routeCache = new Map();
async function lookupRoute(callsign, fetchJSON) {
  const hit = routeCache.get(callsign);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.route;
  routeCache.set(callsign, { at: Date.now(), route: hit?.route ?? null });
  try {
    const j = await fetchJSON(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`);
    const r = j?.response?.flightroute;
    const place = (x) => (x ? `${x.municipality || x.name} (${x.iata_code || x.icao_code})` : '');
    const route = r ? { airline: r.airline?.name, from: place(r.origin), to: place(r.destination) } : null;
    routeCache.set(callsign, { at: Date.now(), route });
    return route;
  } catch {
    return null;
  }
}

OMD.defineWidget({
  id: 'planes',
  name: 'Planes overhead',
  icon: 'plane',
  group: 'Getting around',
  settings: [
    [
      ['PLANES_RADIUS_KM', 'Radius (km)', 'number', { min: 2, max: 250 }],
      ['PLANES_MAX', 'Aircraft listed', 'number', { min: 1, max: 30 }],
    ],
    [
      ['PLANES_MIN_ALT_M', 'Hide below (m)', 'number', { min: 0 }],
      ['PLANES_REFRESH_SEC', 'Refresh (s)', 'number', { min: 5 }],
    ],
  ],
  defaults: {
    PLANES_RADIUS_KM: 25,
    PLANES_MAX: 8, // Aircraft listed (closest first)
    PLANES_MIN_ALT_M: 0, // Hide aircraft below this altitude in metres (ground traffic is always hidden)
    PLANES_REFRESH_SEC: 15,
  },

  mount(ctx) {
    const { h, icon, settings: s } = ctx;
    const planesFeed = ctx.sharedFeed(
      'aircraft',
      () => async () => {
        const lat = s.LATITUDE,
          lon = s.LONGITUDE;
        const nm = Math.max(1, Math.min(250, s.PLANES_RADIUS_KM / 1.852)).toFixed(1);
        const sources = [`https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}`, `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${nm}`];
        if (!ctx.hasProxy) throw new Error('needs-proxy');
        let data, lastErr;
        for (const u of sources) {
          try {
            data = await ctx.fetchJSON(ctx.withProxy(u, 5));
            break;
          } catch (e) {
            lastErr = e;
          }
        }
        if (!data) throw lastErr;
        return (data.aircraft || data.ac || [])
          .filter((a) => a.lat != null && a.lon != null && a.alt_baro !== 'ground' && (a.alt_baro ?? a.alt_geom ?? 0) * 0.3048 >= s.PLANES_MIN_ALT_M)
          .map((a) => ({
            hex: a.hex,
            callsign: (a.flight || '').trim(),
            reg: a.r,
            type: a.t,
            desc: a.desc,
            operator: a.ownOp,
            alt: a.alt_baro ?? a.alt_geom,
            gs: a.gs,
            track: a.track ?? a.true_heading ?? a.mag_heading ?? 0,
            rate: a.baro_rate ?? a.geom_rate ?? 0,
            ...distBearing(lat, lon, a.lat, a.lon),
          }))
          .filter((p) => p.km <= s.PLANES_RADIUS_KM)
          .sort((a, b) => a.km - b.km);
      },
      Math.max(5, s.PLANES_REFRESH_SEC) * 1000,
      { visibleOnly: true, persist: false }, // positions are only true for a few seconds
    );

    const p = ctx.panel({ title: 'Overhead', tint: 'sky' });
    const radar = h('div', { class: 'radar' });
    const list = h('div', { class: 'rows scroll-y' });
    p.body.append(h('div', { class: 'planes' }, radar, list));
    const miles = ctx.imperial;
    const distText = (km) => (miles ? `${(km * 0.621).toFixed(1)} mi` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`);
    const speedText = (kt) => (kt == null ? '' : miles ? `${Math.round(kt * 1.151)} mph` : `${Math.round(kt * 1.852)} km/h`);
    // ADS-B reports feet; shown in metres unless imperial units are selected.
    const altColor = (ft) => (ft * 0.3048 < 3000 ? 'var(--amber)' : ft * 0.3048 < 7500 ? 'var(--cyan)' : 'var(--violet)');
    const altText = (ft) =>
      miles ? `${Math.round(ft).toLocaleString(ctx.locale)} ft` : `${(Math.round((ft * 0.3048) / 10) * 10).toLocaleString(ctx.locale)} m`;
    let planes = [];

    function drawRadar() {
      const R = 92,
        max = s.PLANES_RADIUS_KM;
      const rings = [1 / 3, 2 / 3, 1].map((f) => `<circle class="ring" r="${(R * f).toFixed(1)}"/>`).join('');
      const ringLabel = `<text class="rl" x="3" y="${-R + 9}">${distText(max)}</text>`;
      const marks = planes
        .map((pl, i) => {
          const r = (Math.min(pl.km, max) / max) * R;
          const x = r * Math.sin(toRad(pl.bearing)),
            y = -r * Math.cos(toRad(pl.bearing));
          const near = pl.km < 3;
          const label = i < 3 ? `<text class="pl" x="${(x + 7).toFixed(1)}" y="${(y + 3).toFixed(1)}">${pl.callsign || pl.type || ''}</text>` : '';
          return `${near ? `<circle class="near" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9"/>` : ''}
          <path class="ac" d="M0,-6 L4.5,5 L0,2.8 L-4.5,5 Z" fill="${altColor(pl.alt)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${Math.round(pl.track)})"/>${label}`;
        })
        .join('');
      radar.innerHTML = `<svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet" aria-label="Radar of nearby aircraft">
        <defs><radialGradient id="radarBg"><stop offset="0" stop-color="rgba(125,211,252,.10)"/><stop offset="1" stop-color="rgba(125,211,252,.02)"/></radialGradient></defs>
        <circle r="${R}" fill="url(#radarBg)"/>${rings}
        <line class="ax" x1="${-R}" y1="0" x2="${R}" y2="0"/><line class="ax" x1="0" y1="${-R}" x2="0" y2="${R}"/>
        <g class="sweep"><path d="M0,0 L0,${-R} A${R},${R} 0 0 1 ${(R * Math.sin(toRad(40))).toFixed(1)},${(-R * Math.cos(toRad(40))).toFixed(1)} Z"/></g>
        <text class="n" x="0" y="${-R - 2}">N</text>${ringLabel}
        <circle class="home" r="3"/>${marks}</svg>`;
    }
    function renderList() {
      if (!planes.length) {
        list.replaceChildren(h('div', { class: 'empty' }, icon('plane'), `No aircraft within ${distText(s.PLANES_RADIUS_KM)} right now`));
        return;
      }
      list.replaceChildren(
        ...planes.slice(0, s.PLANES_MAX).map((pl) => {
          const route = pl.callsign ? routeCache.get(pl.callsign)?.route : null;
          const arrow = pl.rate > 300 ? '↑' : pl.rate < -300 ? '↓' : '';
          const what = [route?.airline || pl.operator, pl.desc || pl.type].filter(Boolean).join(' · ');
          return h(
            'div',
            { class: `plane${pl.km < 3 ? ' is-near' : ''}`, style: { '--c': altColor(pl.alt) } },
            h('span', { class: 'plane-ic' }, icon('plane')),
            h(
              'div',
              { style: { minWidth: '0' } },
              h(
                'div',
                { class: 'plane-title' },
                h('b', null, pl.callsign || pl.reg || pl.hex.toUpperCase()),
                route?.from ? h('span', null, ` ${route.from} → ${route.to}`) : null,
              ),
              h('div', { class: 'plane-sub' }, what || pl.reg || '—'),
            ),
            h('div', { class: 'plane-num' }, h('b', null, `${arrow}${altText(pl.alt)}`), h('small', null, `${distText(pl.km)} · ${speedText(pl.gs)}`)),
          );
        }),
      );
    }
    ctx.subscribe(planesFeed, async (d, err) => {
      if (!d) {
        if (err) {
          const msg = err.message === 'needs-proxy' ? 'Live flight data needs the Cloudflare backend (or CORS_PROXY).' : 'Flight data unavailable — retrying';
          radar.replaceChildren();
          list.replaceChildren(h('div', { class: 'empty' }, icon('plane'), msg));
        }
        return;
      }
      planes = d;
      const near = planes.filter((x) => x.km < 3).length;
      p.setMeta(`${planes.length} within ${distText(s.PLANES_RADIUS_KM)}${near ? ` · ${near} overhead` : ''}`);
      drawRadar();
      renderList();
      // Resolve routes for the closest few (politely: at most 3 new lookups per refresh).
      const todo = planes
        .slice(0, s.PLANES_MAX)
        .filter((x) => x.callsign && !routeCache.has(x.callsign))
        .slice(0, 3);
      if (todo.length) {
        await Promise.all(todo.map((x) => lookupRoute(x.callsign, ctx.fetchJSON)));
        renderList();
      }
    });
    p.onReload = () => planesFeed.refresh();
  },
});
