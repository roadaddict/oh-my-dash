/**
 * Weather — the shared weather component on its own panel: now, hourly chart,
 * sun / UV / moon, tappable forecast days. Open-Meteo, no API key.
 * (The component itself is core: the Clock widget shows it too.)
 */
OMD.defineWidget({
  id: 'weather',
  name: 'Weather',
  icon: 'cloud-sun',
  group: 'Time & weather',

  mount(ctx) {
    const p = ctx.panel({ icon: 'sun', tint: 'amber', meta: ctx.settings.LOCATION_NAME });
    ctx.ui.weather(p.body);
    p.onReload = () => ctx.weather.feed.refresh();
  },
});
