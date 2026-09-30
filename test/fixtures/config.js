/* Test-only screens (built into test/.build/index.html, never into public/). */
OMD.configure({
  layouts: {
    // Fixture widgets that fail in every way a widget can, next to a healthy clock.
    lab: {
      name: 'Lab',
      icon: 'zap',
      landscape: {
        cols: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)',
        rows: 'minmax(0,1fr) minmax(0,1fr)',
        areas: ['clock mount later', 'busy syntax counter'],
      },
      blocks: {
        clock: { type: 'clock', variant: 'compact' },
        mount: { type: 'boom-mount' },
        later: { type: 'boom-later' },
        busy: { type: 'busy' },
        syntax: { type: 'broken-syntax' },
        counter: { type: 'counter' },
      },
    },
    // One widget filling the screen (weather sizes).
    solo: {
      name: 'Solo',
      icon: 'sun',
      landscape: { cols: 'minmax(0,1fr)', rows: 'minmax(0,1fr)', areas: ['w'] },
      blocks: { w: { type: 'weather' } },
    },
    // The weather component at six sizes at once: wide/narrow × tall/medium/short.
    wx: {
      name: 'Weather sizes',
      icon: 'sun',
      landscape: { cols: 'minmax(0,1fr) 380px', rows: 'minmax(0,1fr) 300px 220px', areas: ['a b', 'c d', 'e f'] },
      blocks: Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => [k, { type: 'weather' }])),
    },
    // Every widget of the dashboard at once.
    all: {
      name: 'All',
      icon: 'dashboard',
      landscape: {
        cols: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)',
        rows: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)',
        areas: [
          'clock weather worldclock countdown calendar lists',
          'chores meals message quote photo spotify',
          'news ticker transport commute planes smarthome',
          'data webpage strava sports markets example',
        ],
      },
      blocks: Object.fromEntries(
        [
          'clock',
          'weather',
          'worldclock',
          'countdown',
          'calendar',
          'lists',
          'chores',
          'meals',
          'message',
          'quote',
          'photo',
          'spotify',
          'news',
          'ticker',
          'transport',
          'commute',
          'planes',
          'smarthome',
          'data',
          'webpage',
          'strava',
          'sports',
          'markets',
          'example',
        ].map((t) => [t, { type: t }]),
      ),
    },
  },
});
