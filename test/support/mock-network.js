/**
 * Deterministic stand-ins for every outside service the dashboard talks to, plus an
 * in-memory version of the Worker API (/api/*). Tests and the screenshot tool run
 * with no real network access: anything not handled here is aborted.
 *
 *   await mockNetwork(page, { cloud: true })   // cloud mode: /api answers, feeds go through /api/proxy
 *   await mockNetwork(page)                    // local mode: /api/state is unavailable
 */

/** The moment every test runs at: Wednesday 18 March 2026, 10:42 in London. */
export const NOW = new Date('2026-03-18T10:42:00Z');
export const TIMEZONE = 'Europe/London';

const pad = (n) => String(n).padStart(2, '0');
const localIso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const day = (i) => localIso(new Date(Date.UTC(2026, 2, 18 + i))).slice(0, 10);

export function forecast() {
  const hours = Array.from({ length: 7 * 24 }, (_, i) => new Date(Date.UTC(2026, 2, 18, i)));
  return {
    current: {
      time: '2026-03-18T10:30',
      temperature_2m: 11.4,
      apparent_temperature: 9.8,
      relative_humidity_2m: 71,
      weather_code: 2,
      wind_speed_10m: 14.2,
      is_day: 1,
    },
    hourly: {
      time: hours.map(localIso),
      temperature_2m: hours.map((d, i) => +(8 + 5 * Math.sin(((d.getUTCHours() - 9) / 24) * 2 * Math.PI) + (i % 5) * 0.2).toFixed(1)),
      precipitation_probability: hours.map((_, i) => [0, 5, 10, 30, 60, 20, 0][i % 7]),
      weather_code: hours.map((_, i) => [0, 1, 2, 3, 61, 3, 2][i % 7]),
    },
    daily: {
      time: Array.from({ length: 7 }, (_, i) => day(i)),
      weather_code: [2, 61, 3, 0, 1, 80, 71],
      temperature_2m_max: [13.2, 11.8, 12.5, 15.1, 16.4, 12.2, 7.9],
      temperature_2m_min: [6.1, 5.4, 4.8, 7.2, 8.8, 6.0, 1.2],
      precipitation_probability_max: [10, 80, 30, 0, 5, 60, 40],
      sunrise: Array.from({ length: 7 }, (_, i) => `${day(i)}T06:0${i}`),
      sunset: Array.from({ length: 7 }, (_, i) => `${day(i)}T18:1${i}`),
      uv_index_max: [3.1, 2.2, 2.8, 4.0, 4.4, 2.1, 1.5],
    },
  };
}

const rss = (title, items) => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>${title}</title>
${items.map(([t, mins, img]) => `<item><title>${t}</title><pubDate>${new Date(NOW - mins * 60000).toUTCString()}</pubDate>${img ? `<media:thumbnail url="https://img.example/${img}.png"/>` : ''}</item>`).join('\n')}
</channel></rss>`;

const FEEDS = {
  'feeds.bbci.co.uk': rss('BBC', [
    ['Scientists map the deepest canyon under the Antarctic ice', 12, 'a'],
    ['Rail operators agree new timetable for spring', 55, 'b'],
    ['Museum reopens after a two-year renovation', 130, null],
    ['Record numbers sign up for the city half marathon', 240, 'c'],
  ]),
  'www.theverge.com': rss('The Verge', [
    ['A closer look at the new e-ink tablets', 25, 'd'],
    ['Why smart displays keep getting cheaper', 95, null],
    ['The best open-source home dashboards', 300, 'e'],
  ]),
};

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPtfDwAE/QHrHo1ZtwAAAABJRU5ErkJggg==', 'base64');
/** A flat colour per URL, so photo slides are distinguishable in screenshots. */
function solidPng(seed) {
  const colours = [
    [62, 96, 140],
    [140, 92, 60],
    [52, 120, 96],
    [110, 70, 130],
    [150, 130, 70],
  ];
  const [r, g, b] = colours[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % colours.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="100%" height="100%" fill="rgb(${r},${g},${b})"/><circle cx="1100" cy="380" r="220" fill="rgba(255,255,255,.18)"/></svg>`;
  return { contentType: 'image/svg+xml', body: svg };
}

const aircraft = [
  {
    hex: '4ca1b2',
    flight: 'EIN154 ',
    r: 'EI-DEA',
    t: 'A320',
    desc: 'AIRBUS A-320',
    ownOp: 'Aer Lingus',
    alt_baro: 9800,
    gs: 310,
    track: 80,
    baro_rate: -800,
    lat: 51.52,
    lon: -0.1,
  },
  {
    hex: '406a3b',
    flight: 'BAW21K ',
    r: 'G-EUUA',
    t: 'A320',
    desc: 'AIRBUS A-320',
    ownOp: 'British Airways',
    alt_baro: 24000,
    gs: 420,
    track: 200,
    baro_rate: 1200,
    lat: 51.6,
    lon: -0.2,
  },
  {
    hex: '3c6751',
    flight: 'DLH4AB ',
    r: 'D-AIBF',
    t: 'A319',
    desc: 'AIRBUS A-319',
    ownOp: 'Lufthansa',
    alt_baro: 36000,
    gs: 460,
    track: 110,
    baro_rate: 0,
    lat: 51.45,
    lon: 0.05,
  },
];

function external(url) {
  const u = new URL(url);
  const host = u.hostname;
  const json = (body) => ({ contentType: 'application/json', body: JSON.stringify(body) });
  if (host === 'api.open-meteo.com') return json(forecast());
  if (host === 'air-quality-api.open-meteo.com') return json({ current: { european_aqi: 28, pm2_5: 7.4 } });
  if (host === 'geocoding-api.open-meteo.com') return json({ results: [{ name: 'Berlin', latitude: 52.52, longitude: 13.405 }] });
  if (host === 'date.nager.at') {
    const y = u.pathname.split('/')[4];
    return json([
      { date: `${y}-04-03`, name: 'Good Friday' },
      { date: `${y}-04-06`, name: 'Easter Monday' },
      { date: `${y}-12-25`, name: 'Christmas Day' },
    ]);
  }
  if (host === 'picsum.photos' && u.pathname.startsWith('/v2/list'))
    return json(Array.from({ length: 5 }, (_, i) => ({ id: String(10 + i), author: `Photographer ${i + 1}` })));
  if (host === 'picsum.photos' || host === 'img.example' || host === 'coin-images.example') return solidPng(u.pathname);
  if (FEEDS[host]) return { contentType: 'application/rss+xml', body: FEEDS[host] };
  if (host === 'api.coingecko.com') {
    const spark = (base) => Array.from({ length: 168 }, (_, i) => base * (1 + Math.sin(i / 12) * 0.03));
    return json([
      {
        id: 'bitcoin',
        name: 'Bitcoin',
        symbol: 'btc',
        image: 'https://coin-images.example/btc.png',
        current_price: 84210,
        price_change_percentage_24h: 1.84,
        sparkline_in_7d: { price: spark(84000) },
      },
      {
        id: 'ethereum',
        name: 'Ethereum',
        symbol: 'eth',
        image: 'https://coin-images.example/eth.png',
        current_price: 2012.5,
        price_change_percentage_24h: -0.72,
        sparkline_in_7d: { price: spark(2000) },
      },
      {
        id: 'solana',
        name: 'Solana',
        symbol: 'sol',
        image: 'https://coin-images.example/sol.png',
        current_price: 131.2,
        price_change_percentage_24h: 3.1,
        sparkline_in_7d: { price: spark(130) },
      },
    ]);
  }
  if (host === 'site.api.espn.com') {
    const team = (abbr, name, score, homeAway) => ({ homeAway, score, team: { abbreviation: abbr, shortDisplayName: name } });
    return json({
      leagues: [{ abbreviation: u.pathname.includes('soccer') ? 'EPL' : 'NBA' }],
      events: [
        {
          date: '2026-03-18T19:30Z',
          status: { type: { state: 'pre', shortDetail: '7:30 PM' } },
          competitions: [{ competitors: [team('ARS', 'Arsenal', '0', 'home'), team('CHE', 'Chelsea', '0', 'away')] }],
        },
        {
          date: '2026-03-17T20:00Z',
          status: { type: { state: 'post', shortDetail: 'FT' } },
          competitions: [{ competitors: [team('LIV', 'Liverpool', '2', 'home'), team('MCI', 'Man City', '2', 'away')] }],
        },
      ],
    });
  }
  if (host === 'opendata.adsb.fi' || host === 'api.adsb.lol') return json({ aircraft });
  if (host === 'api.adsbdb.com')
    return json({
      response: {
        flightroute: {
          airline: { name: 'Test Air' },
          origin: { municipality: 'Dublin', iata_code: 'DUB' },
          destination: { municipality: 'London', iata_code: 'LHR' },
        },
      },
    });
  if (host === 'photon.komoot.io') return json({ features: [{ geometry: { coordinates: [-0.09, 51.51] }, properties: { name: 'Bank', city: 'London' } }] });
  if (host === 'routing.openstreetmap.de') return json({ routes: [{ duration: 1260, distance: 7400 }] });
  if (host === 'v6.vbb.transport.rest') return { status: 500, contentType: 'application/json', body: '{}' };
  if (host === 'api.transitous.org')
    return json({
      itineraries: [
        {
          startTime: new Date(+NOW + 5 * 60000).toISOString(),
          endTime: new Date(+NOW + 38 * 60000).toISOString(),
          legs: [{ mode: 'SUBWAY', routeShortName: 'Central', realTime: true }],
        },
      ],
    });
  if (host === 'oh-my-bussy.vercel.app' || host === 'transit.example') {
    return {
      contentType: 'text/html',
      body: '<!doctype html><body style="margin:0;background:#050505;color:#9ca3af;font:16px sans-serif;display:grid;place-items:center;height:100vh">Transit app</body>',
    };
  }
  return null;
}

/** An in-memory Worker API. `state` is shared between pages of one test (like D1). */
export function fakeApi(opts = {}) {
  const state = opts.state || {};
  const services = {
    spotify: { configured: true, connected: true },
    aqara: { configured: true, connected: true, region: 'GER' },
    strava: {
      configured: true,
      apps: [1],
      athletes: [
        { id: 1, name: 'Alex', avatar: null, app: 1 },
        { id: 2, name: 'Sam', avatar: null, app: 1 },
      ],
    },
    todoist: { configured: false },
    finnhub: { configured: false },
    tomtom: { configured: false },
    ...opts.services,
  };
  const week = (km, days) => ({ km, time: 14400, count: 4, days, start: '2026-03-16', bySport: { Run: km * 0.6, Ride: km * 0.4 } });
  const routes = {
    'spotify/now': () => ({
      active: true,
      playing: true,
      progress: 61000,
      duration: 215000,
      title: 'Holocene',
      artist: 'Bon Iver',
      album: 'Bon Iver',
      image: null,
      uri: 'spotify:track:1',
      context: null,
      device: { id: 'd1', name: 'Kitchen', type: 'Speaker', active: true, volume: 40, canVolume: true },
    }),
    'spotify/devices': () => ({ devices: [{ id: 'd1', name: 'Kitchen', type: 'Speaker', active: true, volume: 40, canVolume: true }] }),
    'spotify/playlists': () => ({ playlists: [{ id: 'p1', name: 'Morning', uri: 'spotify:playlist:p1', image: null, owner: 'Alex' }] }),
    'aqara/sensors': () => ({
      at: +NOW,
      sensors: [
        {
          id: 's1',
          name: 'Living room',
          room: 'Living',
          model: 'lumi.weather',
          kind: 'climate',
          online: true,
          updated: +NOW - 120000,
          readings: { temperature: { value: 21.3, unit: '°C' }, humidity: { value: 44, unit: '%' } },
        },
        {
          id: 's2',
          name: 'Front door',
          room: 'Hall',
          model: 'lumi.magnet',
          kind: 'contact',
          online: true,
          updated: +NOW - 60000,
          readings: { contact: { value: 'closed' } },
        },
        {
          id: 's3',
          name: 'Bathroom',
          room: 'Bath',
          model: 'lumi.flood',
          kind: 'leak',
          online: true,
          updated: +NOW - 600000,
          readings: { leak: { value: false }, battery: { value: 12 } },
        },
        {
          id: 's4',
          name: 'Hallway',
          room: 'Hall',
          model: 'lumi.motion',
          kind: 'motion',
          online: true,
          updated: +NOW - 300000,
          readings: { motion: { value: false } },
        },
      ],
    }),
    'strava/stats': () => ({
      athletes: [
        {
          id: 1,
          name: 'Alex',
          avatar: null,
          week: week(23.4, [5.2, 0, 8.1, 0, 0, 0, 0]),
          lastWeek: { km: 31, toDate: 19.2 },
          fourWeeks: { km: 104.2 },
          year: { km: 402.1, year: '2026' },
          last: { name: 'Morning run', sport: 'Run', km: 8.1, time: 2700, date: '2026-03-18T07:10:00Z' },
        },
        {
          id: 2,
          name: 'Sam',
          avatar: null,
          week: week(12.1, [0, 12.1, 0, 0, 0, 0, 0]),
          lastWeek: { km: 20, toDate: 14 },
          fourWeeks: { km: 60.5 },
          year: { km: 180.9, year: '2026' },
          last: { name: 'Commute', sport: 'Ride', km: 12.1, time: 2400, date: '2026-03-17T08:00:00Z' },
        },
      ],
    }),
    'todoist/tasks': () => ({
      tasks: [
        { id: 't1', text: 'Call the bank', done: false },
        { id: 't2', text: 'Pay the nursery', done: false },
      ],
    }),
    'finnhub/quotes': () => ({ quotes: [{ sym: 'AAPL', price: 212.4, change: 0.8 }] }),
    'tomtom/route': () => ({ mins: 31, delay: 6, km: 11.2 }),
    ...opts.routes,
  };
  let rev = 0;
  async function handle(route, request) {
    const u = new URL(request.url());
    const path = u.pathname.replace(/^\/api\/?/, '');
    const method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === 'ping') return route.fulfill({ status: 204 });
    if (path === 'health') return json({ ok: true, authorized: true, db: true, authConfigured: true, ip: '203.0.113.7' });
    if (path === 'state') return json({ items: state, now: +NOW });
    const st = /^state\/(\w+)$/.exec(path);
    if (st) {
      const key = st[1];
      if (method === 'GET') return json(state[key] || { rev: 0, value: null });
      const body = JSON.parse(request.postData() || '{}');
      const cur = state[key] || { rev: 0, value: null };
      if (body.rev !== cur.rev) return json({ error: 'conflict', ...cur }, 409);
      state[key] = { rev: cur.rev + 1, value: body.value };
      rev++;
      return json({ rev: cur.rev + 1 });
    }
    if (path === 'proxy') {
      const inner = u.searchParams.get('url');
      const res = external(inner);
      return res
        ? route.fulfill({ status: res.status || 200, contentType: res.contentType, body: res.body })
        : route.fulfill({ status: 502, body: 'unreachable' });
    }
    const svc = /^(\w+)\/status$/.exec(path);
    if (svc && services[svc[1]]) return json(services[svc[1]]);
    const hit = routes[path];
    if (hit) {
      const v = hit({ url: u, method, body: request.postData() });
      return v?.status ? json(v.body, v.status) : json(v || { ok: true });
    }
    if (method === 'POST') return json({ ok: true });
    return json({ error: 'not found' }, 404);
  }
  return {
    state,
    services,
    handle,
    get writes() {
      return rev;
    },
  };
}

/**
 * Route every request of a page. `cloud` answers /api like the Worker; without it the
 * page falls back to local mode (as on file:// or a static host).
 */
export async function mockNetwork(page, { cloud = false, api = cloud ? fakeApi() : null, log = null } = {}) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const u = new URL(request.url());
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      if (u.pathname === '/api' || u.pathname.startsWith('/api/')) {
        if (api) return api.handle(route, request);
        return route.fulfill({ status: 404, contentType: 'text/plain', body: 'no backend' });
      }
      return route.continue();
    }
    const res = external(request.url());
    if (res) {
      const body = typeof res.body === 'string' ? res.body : res.body;
      return route.fulfill({ status: res.status || 200, contentType: res.contentType, body, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    log?.push(request.url());
    return route.abort();
  });
  return api;
}

/** Same numbers on every run: seeded Math.random, before any page script. */
export async function seedRandom(page, seed = 42) {
  await page.addInitScript((s) => {
    let x = s;
    Math.random = () => {
      x = (x * 1664525 + 1013904223) % 4294967296;
      return x / 4294967296;
    };
  }, seed);
}

export { PNG_1PX };
