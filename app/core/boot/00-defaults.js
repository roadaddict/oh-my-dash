/* ==========================================================================
   CORE DEFAULTS — the dashboard's own settings. Each widget brings its own
   defaults (OMD.defineWidget({ defaults })), and app/config.js can override
   any of them. Precedence: URL params > ⚙ settings > app/config.js > these.

   List values are arrays of strings. Many use a "pipe" format, e.g.
     "Family | #8b9cff | https://example.com/family.ics"
   In the settings drawer, write one entry per line.

   🔐 API keys (Todoist, Finnhub, TomTom, Spotify, Aqara, Strava) are Worker
      secrets, never settings: see README → Secrets.
   ========================================================================== */
const CORE_DEFAULTS = {
  /* ── Screens ─────────────────────────────────────────────────────────── */
  DASHBOARD_NAME: 'FLORA-HOME', // shown in the status bar and the browser tab
  SCREENS: ['hub', 'family', 'frame', 'info'],
  START_SCREEN: 'hub',
  SCREEN_ROTATE_SEC: 0, // Auto-advance every N seconds (0 = off). Pauses 2 min after a touch.
  SCREEN_SCHEDULE: [
    // "screen | HH:MM-HH:MM | days"  (days optional: Mon-Fri, Sat,Sun …)
    // "frame | 21:30-07:00",
    // "hub   | 07:00-09:00 | Mon-Fri",
  ],

  /* ── Location, units & time (shared by every widget) ──────────────────── */
  LOCATION_NAME: 'London',
  LATITUDE: 51.5072,
  LONGITUDE: -0.1276,
  TEMP_UNIT: 'celsius', // "celsius" = metric everywhere (°C, km/h, km, m) · "fahrenheit" = imperial
  LOCALE: '', // "" = browser default. e.g. "en-GB", "de-DE", "fr-FR"
  HOUR_12: false,
  WEEK_START: 1, // 1 = Monday, 0 = Sunday
  HOLIDAY_COUNTRY: 'GB', // Public holidays (ISO 3166 code, e.g. "US", "DE"). "" = off.
  WEATHER_REFRESH_MIN: 15, // Open-Meteo, no API key (Clock and Weather widgets)
  CORS_PROXY: '', // Empty on Cloudflare (built-in /api/proxy). Elsewhere: "https://your-worker.workers.dev/?url="

  /* ── Photos (Photos widget, photo screens, optional backdrop) ────────── */
  PHOTO_URLS: [], // "https://…/photo.jpg | Optional caption"
  PHOTO_FEEDS: [], // RSS / Atom / Media-RSS feeds (Flickr, SmugMug, WordPress…)
  GOOGLE_PHOTOS_ALBUM: '', // Shared-album link (https://photos.app.goo.gl/…) — needs CORS_PROXY. Unofficial.
  PHOTO_INTERVAL_SEC: 60,
  PHOTO_SHUFFLE: true,
  PHOTO_KEN_BURNS: true, // Slow pan & zoom
  PHOTO_FIT: 'cover', // "cover" (fill) | "contain" (whole photo on a blurred fill)
  PHOTO_BACKGROUND: false, // Also show the slideshow softly behind the glass on every screen.
  // No photo source configured → scenic demo photos from picsum.photos (Unsplash).

  /* ── Network monitor (status bar) ──────────────────────────────────────── */
  PING_URL: '', // "" = this dashboard's own Worker (/api/ping) at the nearest Cloudflare edge.
  PING_INTERVAL_SEC: 30,
  PING_TIMEOUT_MS: 4000,
  PING_GOOD_MS: 30, // < 30 ms  → emerald
  PING_WARN_MS: 100, // ≤ 100 ms → amber, above → crimson

  /* ── Kiosk behaviour ───────────────────────────────────────────────── */
  NIGHT_MODE_START: '23:00', // Night mode between these times ("" to disable)
  NIGHT_MODE_END: '06:30',
  NIGHT_MODE_STYLE: 'dim', // "dim" | "clock" (minimal clock on black) | "off" (black screen)
  NIGHT_BRIGHTNESS: 0.35, // For "dim": 0–1. Tap the screen to wake it for a minute.
  BURN_IN_SHIFT: true, // Nudge the layout a few px every few minutes.
  KEEP_SCREEN_AWAKE: true, // Screen Wake Lock API.
  HIDE_CURSOR_SEC: 5,
  DAILY_RELOAD_AT: '03:30', // Full page refresh once a day ("" to disable).
  LOW_POWER: false, // Disable blur & animations on slower tablets.
  WIDGET_BG: 20, // widget background: 0 · 5 · 10 · 15 · 20 (%) — 0 = none, 20 = frosted glass
  THEME_ACCENT: '#f0d722', // BVG yellow, matching the transit app
  CUSTOM_CSS: '', // Injected as-is, e.g. ".clock-hm{font-weight:100}"
};

/** Settings every widget may read (ctx.settings), besides its own. */
const SHARED_KEYS = ['LOCATION_NAME', 'LATITUDE', 'LONGITUDE', 'TEMP_UNIT', 'LOCALE', 'HOUR_12', 'WEEK_START', 'HOLIDAY_COUNTRY'];

/** Settings that used to hold API keys; they are Worker secrets now (README → Secrets). */
const RETIRED_SECRET_KEYS = ['TODOIST_TOKEN', 'FINNHUB_TOKEN', 'TOMTOM_KEY'];

/* ==========================================================================
   🧩 LAYOUTS — one entry per screen. Add your own in app/config.js with
   OMD.configure({ layouts: { … } }).
   Each screen is a CSS grid: `areas` rows name where each block goes, and
   `blocks` maps an area name to a widget type + options. Phones stack blocks
   in the order listed. Widget types: see app/widgets/ (one folder each).
   Options: photo: true (full-bleed slideshow behind the screen),
            statusbar: false (status bar slides in on tap).
   Variants: landscape (required), narrow (≤ 3:2 landscape, e.g. 4:3 tablets),
            short (landscape ≤ 680 px tall), portrait. A variant may leave
            out areas — those widgets are hidden there.
   Areas must be cuttable with straight lines (every widget a rectangle). They
   become a tree of splits, so each column sizes its own widgets; the ▦ editor
   resizes, swaps and replaces widgets on top of this and saves per orientation.
   ========================================================================== */
const BUILTIN_LAYOUTS = {
  hub: {
    name: 'Home',
    icon: 'home',
    landscape: {
      cols: 'minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr)',
      rows: 'minmax(0,1.5fr) minmax(0,.4fr) minmax(250px,1.1fr)', // Spotify's row is resizable too
      areas: ['transport hero calendar', 'transport hero home', 'transport spotify home'],
    },
    narrow: { cols: 'minmax(0,1.15fr) minmax(0,1fr) minmax(0,1fr)' }, // ≤ 3:2 landscape (4:3 tablets)
    // Portrait (how the tablet hangs): clock + weather across the top, the transit app runs the full
    // height on the left, calendar · sensors · Now Playing stacked on the right.
    portrait: {
      cols: 'minmax(0,1fr) minmax(0,1fr)',
      rows: 'minmax(0,1.35fr) minmax(0,1fr) minmax(0,.8fr) auto',
      areas: ['hero hero', 'transport calendar', 'transport home', 'transport spotify'],
    },
    blocks: {
      hero: { type: 'clock', variant: 'full' },
      transport: { type: 'transport' },
      calendar: { type: 'calendar', view: 'agenda' },
      spotify: { type: 'spotify' },
      home: { type: 'smarthome' },
    },
  },

  family: {
    name: 'Family',
    icon: 'users',
    landscape: {
      cols: 'minmax(0,1.55fr) minmax(0,1fr) minmax(0,1fr)',
      rows: 'auto minmax(0,1fr) minmax(0,1fr)',
      areas: ['clock message countdown', 'month lists chores', 'month meals chores'],
    },
    portrait: {
      cols: 'minmax(0,1fr) minmax(0,1fr)',
      rows: 'auto auto minmax(0,1.35fr) minmax(0,1fr) minmax(0,1fr)',
      areas: ['clock countdown', 'message message', 'month month', 'lists chores', 'meals chores'],
    },
    blocks: {
      clock: { type: 'clock', variant: 'compact' },
      message: { type: 'message' },
      countdown: { type: 'countdown', compact: true },
      month: { type: 'calendar', view: 'month' },
      lists: { type: 'lists' },
      chores: { type: 'chores' },
      meals: { type: 'meals' },
    },
  },

  frame: {
    name: 'Frame',
    icon: 'image',
    photo: true,
    statusbar: false,
    // Photos with the clock bottom-left; the right column holds the agenda and Now Playing.
    landscape: {
      cols: 'minmax(0,1fr) minmax(300px,30%)',
      rows: 'minmax(0,1fr) minmax(0,1fr) auto auto',
      areas: ['. agenda', 'clock agenda', 'clock spotify', 'ticker ticker'],
    },
    portrait: {
      cols: 'minmax(0,1fr)',
      rows: 'minmax(0,1fr) auto minmax(0,.6fr) auto auto',
      areas: ['.', 'clock', 'agenda', 'spotify', 'ticker'],
    },
    blocks: {
      clock: { type: 'clock', variant: 'overlay' },
      agenda: { type: 'calendar', view: 'agenda', dark: true },
      spotify: { type: 'spotify' },
      ticker: { type: 'ticker' },
    },
  },

  info: {
    name: 'Info',
    icon: 'newspaper',
    landscape: {
      cols: 'minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)',
      rows: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)',
      areas: ['news weather weather markets', 'news clocks commute planes', 'news quote quote planes'],
    },
    // Short landscape (≤ 680 px tall, e.g. a 10" tablet at 2× density): fewer, roomier widgets.
    short: {
      rows: 'minmax(0,1fr) minmax(0,1fr)',
      areas: ['news weather weather planes', 'news markets commute planes'],
    },
    portrait: {
      cols: 'minmax(0,1fr) minmax(0,1fr)',
      rows: 'minmax(0,.75fr) minmax(0,1fr) minmax(0,1fr) auto auto',
      areas: ['weather weather', 'news markets', 'news planes', 'clocks commute', 'quote quote'],
    },
    blocks: {
      weather: { type: 'weather' },
      news: { type: 'news' },
      markets: { type: 'markets' },
      clocks: { type: 'worldclock' },
      commute: { type: 'commute' },
      planes: { type: 'planes' },
      quote: { type: 'quote' },
    },
  },
};

/** Picker and settings groups, in this order; a widget with a new group name adds one at the end. */
const WIDGET_GROUPS = ['Time & weather', 'Family', 'Photos, music & news', 'Getting around', 'Home & web', 'Fitness & markets'];

/**
 * Settings drawer sections that belong to the dashboard itself. Widgets' sections are
 * generated from their definitions. Field: [KEY, label, type, { help, placeholder, … }];
 * a nested list is a row of fields. Types: text · url · number · password · time ·
 * textarea (one entry per line) · checkbox · select ({ options }) · geo, or a widget's own (fields).
 */
const CORE_SECTIONS = [
  [
    'Screens',
    'layout',
    [
      [
        'SCREENS',
        'Screens to show, in order (one per line)',
        'textarea',
        { help: () => `Available: ${Object.keys(LAYOUTS).join(', ')}. Design your own in app/config.js.` },
      ],
      [
        ['START_SCREEN', 'Start screen', 'select', { options: () => Object.entries(LAYOUTS).map(([id, l]) => [id, l.name]) }],
        ['SCREEN_ROTATE_SEC', 'Auto-rotate (s, 0 = off)', 'number', { min: 0 }],
      ],
      ['SCREEN_SCHEDULE', 'Schedule', 'textarea', { help: 'One per line: <code>frame | 21:30-07:00</code> or <code>hub | 07:00-09:00 | Mon-Fri</code>' }],
    ],
  ],
  [
    'Location, units & time',
    'map-pin',
    [
      ['LOCATION_NAME', 'Location', 'geo', { help: 'Home for weather, commute, planes overhead and address suggestions.' }],
      [
        ['LATITUDE', 'Latitude', 'number', { step: 'any' }],
        ['LONGITUDE', 'Longitude', 'number', { step: 'any' }],
      ],
      [
        [
          'TEMP_UNIT',
          'Units',
          'select',
          {
            options: [
              ['celsius', 'Metric (°C · km/h · km · m)'],
              ['fahrenheit', 'Imperial (°F · mph · mi · ft)'],
            ],
          },
        ],
        ['LOCALE', 'Locale', 'text', { placeholder: 'Browser default' }],
      ],
      [
        [
          'WEEK_START',
          'Week starts',
          'select',
          {
            options: [
              ['1', 'Monday'],
              ['0', 'Sunday'],
              ['6', 'Saturday'],
            ],
          },
        ],
        ['HOUR_12', '12-hour clock', 'checkbox'],
      ],
      [
        ['HOLIDAY_COUNTRY', 'Public holidays (country)', 'text', { placeholder: 'GB, US, DE…' }],
        ['WEATHER_REFRESH_MIN', 'Weather refresh (min)', 'number', { min: 5 }],
      ],
      [
        'CORS_PROXY',
        'CORS proxy prefix',
        'text',
        {
          placeholder: 'https://your-worker.workers.dev/?url=',
          help: 'Leave empty on Cloudflare — the built-in /api/proxy is used. Elsewhere, deploy cors-proxy/worker.js.',
        },
      ],
    ],
  ],
  [
    'Status bar',
    'activity',
    [
      ['DASHBOARD_NAME', 'Dashboard name', 'text', { placeholder: 'FLORA-HOME', help: 'Also: <b>Edit layout</b> → tap the name in the status bar.' }],
      [
        'PING_URL',
        'Ping endpoint',
        'url',
        {
          placeholder: 'Empty = own Cloudflare edge (/api/ping)',
          help: 'Leave empty: it measures the round trip to the nearest Cloudflare edge, the same path everything else uses.',
        },
      ],
      [
        ['PING_INTERVAL_SEC', 'Interval (s)', 'number', { min: 2 }],
        ['PING_TIMEOUT_MS', 'Timeout (ms)', 'number', { min: 500 }],
      ],
      [
        ['PING_GOOD_MS', 'Emerald below (ms)', 'number'],
        ['PING_WARN_MS', 'Amber up to (ms)', 'number'],
      ],
    ],
  ],
  [
    'Kiosk & display',
    'maximize',
    [
      [
        ['NIGHT_MODE_START', 'Night from', 'time'],
        ['NIGHT_MODE_END', 'Night until', 'time'],
      ],
      [
        [
          'NIGHT_MODE_STYLE',
          'Night style',
          'select',
          {
            options: [
              ['dim', 'Dim'],
              ['clock', 'Minimal clock'],
              ['off', 'Screen off (black)'],
            ],
          },
        ],
        ['NIGHT_BRIGHTNESS', 'Dim level (0–1)', 'number', { step: 0.05, min: 0.05, max: 1 }],
      ],
      [
        ['DAILY_RELOAD_AT', 'Daily reload at', 'time'],
        ['THEME_ACCENT', 'Accent colour', 'text', { placeholder: '#f0d722' }],
      ],
      ['KEEP_SCREEN_AWAKE', 'Keep screen awake', 'checkbox'],
      ['BURN_IN_SHIFT', 'Burn-in protection (pixel shift)', 'checkbox'],
      ['LOW_POWER', 'Low-power mode (no blur / animations)', 'checkbox'],
      ['CUSTOM_CSS', 'Custom CSS', 'textarea'],
    ],
  ],
];
