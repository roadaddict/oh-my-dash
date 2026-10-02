/**
 * Now Playing — Spotify: what's playing, controls, volume, and "play one of my playlists"
 * on any Spotify Connect speaker (Google Home / Nest included). Needs the backend
 * integration (lib/integrations/spotify.js); without it, an optional embed player.
 */
const { pad2 } = OMD.util;
/** When Now Playing was last asked (shared by every Now Playing on the page, like the feed). */
let spotifyFetchedAt = 0;

/** A Spotify link or URI → its embed player URL. */
function spotifyEmbedUrl(input) {
  if (!input) return '';
  const s = input.trim();
  const uri = /^spotify:(playlist|album|artist|track|show|episode):([A-Za-z0-9]+)$/.exec(s);
  if (uri) return `https://open.spotify.com/embed/${uri[1]}/${uri[2]}?utm_source=generator&theme=0`;
  try {
    const u = new URL(s);
    if (!/spotify\.com$/.test(u.hostname)) return s;
    const parts = u.pathname
      .split('/')
      .filter(Boolean)
      .filter((x) => !/^intl-/.test(x) && x !== 'embed');
    if (parts.length >= 2) return `https://open.spotify.com/embed/${parts[0]}/${parts[1]}?utm_source=generator&theme=0`;
  } catch {
    /* fall through */
  }
  return s;
}

OMD.defineWidget({
  id: 'spotify',
  name: 'Now Playing',
  icon: 'music',
  group: 'Photos, music & news',
  integrations: ['spotify'],
  settings: [
    [
      'SPOTIFY_DEVICE',
      'Default Spotify speaker',
      'text',
      {
        placeholder: 'e.g. Living Room speaker',
        help: 'Playlists start here when nothing is playing. Empty = the last speaker picked on this screen. Connect the account under <b>Accounts</b>.',
      },
    ],
    [
      'SPOTIFY_URL',
      'Fallback: Spotify embed link',
      'url',
      { placeholder: 'https://open.spotify.com/playlist/…', help: 'Only used while no Spotify account is connected.' },
    ],
  ],
  defaults: {
    SPOTIFY_DEVICE: '', // Speaker to start playlists on when nothing is playing, e.g. "Living Room speaker". "" = ask.
    SPOTIFY_URL: '', // Optional fallback: embed player for a link/URI when the account isn't connected.
  },

  mount(ctx) {
    const { h, icon, settings: s } = ctx;
    const p = ctx.panel({ tint: 'spotify', meta: 'Spotify' });
    p.el.prepend(h('div', { class: 'spotify-glow', 'aria-hidden': 'true' }));

    // Polled every 10 s while something plays, every 30 s when idle, only while on screen (~0.6 KB a poll).
    const spotifyFeed = ctx.sharedFeed(
      'now',
      () => async () => {
        const prev = spotifyFeed.data;
        if (prev && !prev.playing && Date.now() - spotifyFetchedAt < 28000) return prev;
        spotifyFetchedAt = Date.now();
        return { ...(await ctx.api('spotify/now')), fetchedAt: Date.now() };
      },
      10000,
      { visibleOnly: true, persist: false }, // what played an hour ago isn't worth showing
    );
    const refreshSpotify = (delay = 900) =>
      ctx.setTimeout(() => {
        spotifyFetchedAt = 0;
        spotifyFeed.refresh();
      }, delay);
    const spotifyDevicePref = ctx.local('device', '', { legacyKey: 'omd.spotify-device.v1' });

    function mountSpotifyEmbed(url) {
      const kind = (/embed\/(\w+)/.exec(url) || [])[1];
      p.setMeta(kind ? `Spotify ${kind}` : 'Spotify');
      const frame = ctx.ui.frame(p.body, {
        url,
        title: 'Spotify player',
        rounded: true,
        skeletonKind: 'list',
        allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
      });
      // Snap to Spotify's native heights so the row can be resized freely in the layout editor.
      const frameEl = p.body.querySelector('.frame');
      const stacked = matchMedia('(max-width: 599px), (orientation: landscape) and (max-height: 480px)');
      ctx.observeResize(p.body, () => {
        if (stacked.matches || p.el.classList.contains('is-expanded')) {
          frameEl.style.height = '';
          return;
        }
        const avail = p.body.clientHeight;
        frameEl.style.height = `${avail >= 352 ? 352 : avail >= 152 ? 152 : 80}px`;
      });
      p.reloadable(frame.reload);
    }

    function mountNowPlaying() {
      p.body.classList.add('np-host');
      const art = h('div', { class: 'np-art' }, icon('music'));
      const title = h('div', { class: 'np-title' });
      const artist = h('div', { class: 'np-artist' });
      const bar = h('i');
      const tNow = h('span'),
        tEnd = h('span');
      const btn = (ic, label, fn, cls = '') =>
        h('button', { class: `icon-btn np-btn${cls}`, type: 'button', 'aria-label': label, title: label, onclick: fn }, icon(ic));
      const playBtn = btn('play', 'Play', () => control(state?.playing ? 'pause' : 'play'), ' is-main');
      const sheet = h('div', { class: 'np-sheet', hidden: true });
      const toast = h('div', { class: 'np-toast', role: 'status' });
      // Volume: the button swaps the progress bar for a slider, which steps back a few seconds after the last touch.
      const volIn = h('input', { type: 'range', min: 0, max: 100, step: 5, 'aria-label': 'Volume' });
      const volOut = h('span', { class: 'np-vol-val' });
      const volBtn = btn('volume-2', 'Volume', () => showVol(!mid.classList.contains('show-vol')), ' np-vol-btn');
      const mid = h(
        'div',
        { class: 'np-mid' },
        h('div', { class: 'np-progress' }, h('div', { class: 'np-bar' }, bar), h('div', { class: 'np-times' }, tNow, tEnd)),
        h('div', { class: 'np-vol' }, volIn, volOut),
      );
      p.body.append(
        h(
          'div',
          { class: 'np' },
          art,
          h(
            'div',
            { class: 'np-main' },
            h('div', { class: 'np-text' }, title, artist),
            mid,
            h(
              'div',
              { class: 'np-controls' },
              btn('skip-back', 'Previous', () => control('previous')),
              playBtn,
              btn('skip-forward', 'Next', () => control('next')),
              volBtn,
            ),
          ),
        ),
        sheet,
        toast,
      );
      p.addAction('speaker', 'Choose speaker', () => openSheet('devices'));
      p.addAction('list-music', 'My playlists', () => openSheet('playlists'));

      let state = null,
        artUrl = '',
        endedUri = null,
        pendingContext = null,
        toastTimer = 0;
      let volHide = 0,
        volSend = 0,
        volAt = 0;
      const volIcon = (v) => (v <= 0 ? 'volume-x' : v < 50 ? 'volume-1' : 'volume-2');
      function paintVol(v) {
        volIn.value = v;
        volIn.style.setProperty('--v', `${v}%`);
        volOut.textContent = `${v}%`;
        volBtn.replaceChildren(icon(volIcon(v)));
        volBtn.title = `Volume ${v}%`;
      }
      function showVol(on) {
        mid.classList.toggle('show-vol', on);
        volBtn.classList.toggle('is-on', on);
        ctx.clearTimeout(volHide);
        if (on) volHide = ctx.setTimeout(() => showVol(false), 5000);
      }
      function renderVol(d) {
        const dev = d?.active ? d.device : null,
          ok = !!dev && dev.canVolume !== false && dev.volume != null;
        volBtn.hidden = !ok;
        if (!ok) {
          showVol(false);
          return;
        }
        if (Date.now() - volAt > 4000) paintVol(dev.volume); // don't fight a slider that was just moved
      }
      ctx.listen(volIn, 'input', () => {
        const v = Number(volIn.value);
        volAt = Date.now();
        paintVol(v);
        showVol(true);
        ctx.clearTimeout(volSend);
        volSend = ctx.setTimeout(() => control('volume', { value: v }), 250);
      });
      const say = (text) => {
        toast.textContent = text;
        toast.classList.add('is-on');
        ctx.clearTimeout(toastTimer);
        toastTimer = ctx.setTimeout(() => toast.classList.remove('is-on'), 4000);
      };
      const mmss = (ms) => {
        const s = Math.max(0, Math.floor(ms / 1000));
        return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
      };
      const position = () => (state?.playing ? Math.min(state.duration, state.progress + (Date.now() - state.fetchedAt)) : state?.progress || 0);
      function setPlayIcon(playing) {
        playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
        playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        p.el.classList.toggle('is-playing', !!playing);
      }
      function tick() {
        if (!state?.active || !state.duration) {
          bar.style.width = '0';
          tNow.textContent = tEnd.textContent = '';
          return;
        }
        const x = position();
        bar.style.width = `${(x / state.duration) * 100}%`;
        tNow.textContent = mmss(x);
        tEnd.textContent = mmss(state.duration);
        if (state.playing && x >= state.duration && endedUri !== state.uri) {
          endedUri = state.uri;
          refreshSpotify(1500);
        }
      }
      function render(d, err) {
        if (err) {
          if (err.status === 409) {
            title.textContent = 'Spotify disconnected';
            artist.textContent = 'Reconnect it in ⚙ Settings → Accounts';
          }
          p.setMeta('Spotify · offline');
          return;
        }
        state = d;
        if (!d?.active) {
          title.textContent = 'Nothing playing';
          artist.textContent = 'Tap ♫ to play one of your playlists';
          p.setMeta('Spotify · idle');
        } else {
          title.textContent = d.title || '—';
          artist.textContent = d.artist || d.album || '';
          p.setMeta(d.device?.name ? `on ${d.device.name}` : 'Spotify');
        }
        if ((d?.image || '') !== artUrl) {
          artUrl = d?.image || '';
          art.replaceChildren(artUrl ? h('img', { src: artUrl, alt: '', decoding: 'async' }) : icon('music'));
        }
        setPlayIcon(d?.playing);
        renderVol(d);
        tick();
      }
      ctx.subscribe(spotifyFeed, render);
      ctx.onTick(() => {
        if (state?.playing && ctx.isVisible()) tick();
      });

      async function preferredDevice() {
        const want = (s.SPOTIFY_DEVICE || spotifyDevicePref.get() || '').toLowerCase();
        if (!want) return null;
        const { devices } = await ctx.api('spotify/devices');
        return devices.find((d) => d.name.toLowerCase() === want) || devices.find((d) => d.name.toLowerCase().includes(want)) || null;
      }
      async function control(action, extra = {}) {
        try {
          let deviceId = extra.device_id;
          if (!deviceId && !state?.active && (action === 'play' || action === 'next' || action === 'previous')) {
            deviceId = (await preferredDevice())?.id;
            if (!deviceId) {
              pendingContext = extra.context_uri || null;
              return openSheet('devices');
            }
          }
          if ((action === 'play' || action === 'pause') && state?.active && !extra.context_uri) {
            state.progress = position();
            state.fetchedAt = Date.now();
            state.playing = action === 'play';
            setPlayIcon(state.playing);
          }
          await ctx.api('spotify/player', { method: 'POST', body: JSON.stringify({ ...extra, action, device_id: deviceId }) });
        } catch (e) {
          say(e.message);
          if (/device/i.test(e.message)) openSheet('devices');
        }
        refreshSpotify();
      }
      const closeSheet = () => {
        sheet.hidden = true;
        sheet.replaceChildren();
      };
      const row = (thumb, name, sub, fn, current) =>
        h(
          'button',
          { class: `np-row${current ? ' is-current' : ''}`, type: 'button', onclick: fn },
          h('span', { class: 'np-thumb' }, thumb),
          h('span', { class: 'np-row-text' }, h('b', null, name), h('small', null, sub)),
        );
      let playlistCache = null;
      async function openSheet(kind) {
        sheet.hidden = false;
        sheet.replaceChildren(
          h(
            'div',
            { class: 'np-sheet-head' },
            h('b', null, kind === 'devices' ? (pendingContext ? 'Play it on…' : 'Play on…') : 'My playlists'),
            h(
              'button',
              {
                class: 'icon-btn',
                type: 'button',
                'aria-label': 'Close',
                onclick: () => {
                  pendingContext = null;
                  closeSheet();
                },
              },
              icon('x'),
            ),
          ),
          h('div', { class: 'empty' }, 'Loading…'),
        );
        try {
          let list;
          if (kind === 'devices') {
            const { devices } = await ctx.api('spotify/devices');
            list = devices.length
              ? devices.map((d) =>
                  row(
                    icon('speaker'),
                    d.name,
                    d.active ? 'Playing here' : d.type,
                    () => {
                      spotifyDevicePref.set(d.name);
                      closeSheet();
                      const ctx = pendingContext;
                      pendingContext = null;
                      control(ctx ? 'play' : 'transfer', { device_id: d.id, ...(ctx ? { context_uri: ctx } : {}) });
                    },
                    d.active,
                  ),
                )
              : [
                  h(
                    'div',
                    { class: 'empty' },
                    icon('speaker'),
                    'No speakers found',
                    h(
                      'small',
                      null,
                      'Google Home / Nest speakers show up once they have played Spotify recently — e.g. “Hey Google, play Spotify”. The Spotify app on a phone works too.',
                    ),
                  ),
                ];
          } else {
            if (!playlistCache || Date.now() - playlistCache.at > 300000)
              playlistCache = { at: Date.now(), list: (await ctx.api('spotify/playlists')).playlists };
            list = playlistCache.list.length
              ? playlistCache.list.map((pl) =>
                  row(
                    pl.image ? h('img', { src: pl.image, alt: '', loading: 'lazy' }) : icon('list-music'),
                    pl.name,
                    pl.owner,
                    () => {
                      closeSheet();
                      control('play', { context_uri: pl.uri });
                    },
                    state?.context === pl.uri,
                  ),
                )
              : [h('div', { class: 'empty' }, icon('list-music'), 'No playlists in this account')];
          }
          sheet.lastChild.replaceWith(h('div', { class: 'np-list scroll-y' }, list));
        } catch (e) {
          sheet.lastChild.replaceWith(h('div', { class: 'empty' }, icon('alert'), e.message));
        }
      }
      p.onReload = () => refreshSpotify(0);
    }

    ctx.status('spotify').then(
      ctx.guard((st) => {
        if (st.connected) return mountNowPlaying();
        const url = spotifyEmbedUrl(s.SPOTIFY_URL);
        if (url) return mountSpotifyEmbed(url);
        p.body.append(
          h(
            'div',
            { class: 'empty' },
            icon('music'),
            st.configured ? 'Spotify isn’t connected yet' : 'Now Playing needs the Spotify app keys',
            st.configured
              ? h('a', { class: 'cta', href: ctx.apiUrl('spotify/login') }, icon('link'), 'Connect Spotify')
              : h(
                  'small',
                  null,
                  st.local
                    ? 'Available when the dashboard runs on its Cloudflare Worker.'
                    : 'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET on the Worker — README → Spotify.',
                ),
          ),
        );
      }),
    );
  },
});
