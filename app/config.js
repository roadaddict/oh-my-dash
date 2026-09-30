/**
 * Your own defaults and screens — edit this file, then `npm run build`.
 *
 * Everything here can still be changed on the tablet in ⚙ (saved in the cloud or on the
 * device) and per device with URL params; precedence: URL params > ⚙ > this file > built-in.
 * Every setting name is listed in ⚙ → "Make it permanent" and in each widget's definition
 * (app/widgets/<name>/widget.js → defaults).
 *
 * 🔐 Don't put API keys here: they're Worker secrets (README → Secrets).
 */
OMD.configure({
  defaults: {
    // DASHBOARD_NAME: 'Our Home',
    // LOCATION_NAME: 'Berlin', LATITUDE: 52.52, LONGITUDE: 13.405,
    // CALENDARS: ['Family | #8b9cff | https://calendar.google.com/calendar/ical/…/basic.ics'],
  },
  layouts: {
    // A screen of your own (see BUILTIN_LAYOUTS in app/core/boot/00-defaults.js for the format),
    // then add "kitchen" to SCREENS in ⚙ → Screens:
    // kitchen: {
    //   name: 'Kitchen', icon: 'utensils',
    //   landscape: { cols: 'minmax(0,1fr) minmax(0,1fr)', rows: 'minmax(0,1fr)', areas: ['lists meals'] },
    //   blocks: { lists: { type: 'lists' }, meals: { type: 'meals' } },
    // },
  },
});
