/* ==========================================================================
   SETTINGS DRAWER (on-device configuration, persisted to localStorage)
   ========================================================================== */
/**
 * The drawer's sections: the dashboard's own (CORE_SECTIONS), then one per widget with
 * settings, generated from its definition. A key shows up once, in its first section.
 */
function settingsSections() {
  const seen = new Set();
  const once = (f) => (seen.has(f[0]) ? null : (seen.add(f[0]), f));
  const dedupe = (fields) => fields.map((f) => (Array.isArray(f[0]) ? f.map(once).filter(Boolean) : once(f))).filter((f) => f && f.length);
  return [
    ...CORE_SECTIONS.map(([legend, ic, fields]) => ({ legend, ic, fields: dedupe(fields), def: null })),
    ...widgetList()
      .filter((d) => d.settings.length && !widgetProblems.has(d.id) && (DEV || !d.hidden))
      .map((d) => ({ legend: d.name, ic: d.icon, fields: dedupe(d.settings), def: d })),
  ];
}
const optVal = (v) => (typeof v === 'function' ? v() : v);

const settingsEl = $('#settings'),
  form = $('#settingsForm');
function buildField([key, label, type, opts = {}], def = null) {
  const v = cfg[key];
  const id = `f_${key}`;
  const help = opts.help ? h('small') : null;
  if (help) help.innerHTML = optVal(opts.help); // trusted, static strings from the widget definitions
  if (def && typeof def.fields[type] === 'function') {
    // A widget's own field type (e.g. the Commute editor): must contain a form control named `key`.
    try {
      const local = (name, fallback) => persisted(`omd.w.${def.id}.${name}`, fallback);
      const settings = Object.fromEntries([...Object.keys(def.defaults), ...SHARED_KEYS].map((k) => [k, cfg[k]]));
      // Timers of a settings field live as long as the drawer is open.
      return def.fields[type]({
        ...KIT,
        h,
        key,
        label,
        value: v,
        help,
        opts,
        settings,
        local,
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id),
      });
    } catch (e) {
      console.error(`Settings field ${key} of "${def.id}" failed:`, e);
      return h('div', { class: 'field' }, h('span', null, label), h('small', null, `⚠ This setting couldn’t be shown: ${e.message}`));
    }
  }
  if (type === 'checkbox') {
    return h('label', { class: 'field toggle', for: id }, h('span', null, label), h('input', { type: 'checkbox', id, name: key, checked: !!v }));
  }
  let input;
  if (type === 'select') {
    input = h(
      'select',
      { id, name: key },
      optVal(opts.options).map(([val, text]) => h('option', { value: val, selected: String(val) === String(v) }, text)),
    );
  } else if (type === 'textarea') {
    input = h('textarea', { id, name: key, rows: Array.isArray(v) ? Math.min(6, Math.max(2, v.length + 1)) : 3, spellcheck: 'false' });
    input.value = Array.isArray(v) ? v.join('\n') : v;
  } else if (type === 'geo') {
    input = h('input', { type: 'text', id, name: key, value: v });
    const btn = h('button', { class: 'btn', type: 'button' }, icon('map-pin'), h('span', null, 'Find'));
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const r = (await fetchJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(input.value)}`)).results?.[0];
        if (r) {
          form.elements.LATITUDE.value = r.latitude.toFixed(4);
          form.elements.LONGITUDE.value = r.longitude.toFixed(4);
          input.value = r.name;
        } else btn.lastChild.textContent = 'Not found';
      } catch {
        btn.lastChild.textContent = 'Offline';
      }
      btn.disabled = false;
    });
    return h('label', { class: 'field', for: id }, h('span', null, label), h('div', { class: 'field-inline' }, input, btn), help);
  } else {
    input = h('input', {
      type,
      id,
      name: key,
      value: v ?? '',
      placeholder: opts.placeholder,
      step: opts.step,
      min: opts.min,
      max: opts.max,
      spellcheck: 'false',
      inputmode: type === 'number' ? 'decimal' : null,
    });
  }
  return h('label', { class: 'field', for: id }, h('span', null, label), input, help);
}
/* ---------- Data usage: this device + every device's report (shared "netstats") ---------- */
const netStore = sharedState('netstats', {});
const deviceStore = persisted('omd.device.v1', null);
const device =
  deviceStore.get() ||
  (() => {
    const ua = navigator.userAgent;
    // cleanLayouts: a browser new to the dashboard starts from the default layouts, never the old shared one
    const d = {
      id: uid(),
      name: /Fully/i.test(ua) ? 'Kiosk tablet' : /Mobile/i.test(ua) ? 'Phone' : /Android/i.test(ua) ? 'Tablet' : 'Browser',
      cleanLayouts: true,
    };
    deviceStore.set(d);
    return d;
  })();
function reportUsage() {
  if (!sync.cloud) return;
  const s = netmeter.summary();
  const entry = {
    name: device.name,
    at: Date.now(),
    today: s.today,
    lastHour: s.lastHour,
    avgKbps: +s.avgKbps.toFixed(1),
    peakKbps: +s.peakKbps.toFixed(1),
    days: s.days,
    top: s.hosts.slice(0, 5),
  };
  netStore.update((v) => {
    v ||= {};
    v[device.id] = entry;
    for (const [id, e] of Object.entries(v)) if (Date.now() - (e.at || 0) > 14 * 864e5) delete v[id]; // forget silent devices
    return v;
  });
}
setTimeout(reportUsage, 90000);
every(15 * 60000, reportUsage);

function usageSection() {
  const s = netmeter.summary();
  const maxDay = Math.max(1, ...s.days.map(([, b]) => b));
  const nameInput = h('input', { type: 'text', value: device.name, 'aria-label': 'Device name' });
  nameInput.addEventListener('change', () => {
    device.name = nameInput.value.trim() || device.name;
    deviceStore.set(device);
    reportUsage();
  });
  const others = Object.entries(netStore.get() || {}).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  const note = h('small');
  note.innerHTML =
    'Counted in the page: dashboard API, feeds, weather, photos. <b>Not visible to a web page:</b> what runs <i>inside</i> iframes (transit app, Spotify, Google Calendar). For the full total, Android shows per-app Wi-Fi use: <i>Settings → Network &amp; internet → Internet → Non-carrier data usage</i> (the kiosk browser).';
  return h(
    'details',
    null,
    h('summary', null, icon('activity'), 'Data usage'),
    h(
      'div',
      { class: 'group' },
      h(
        'div',
        { class: 'usage' },
        h('div', null, h('b', null, fmtBytes(s.today)), h('span', null, `today · ${s.todayReqs} requests`)),
        h('div', null, h('b', null, fmtBytes(s.lastHour)), h('span', null, `last hour · ${s.reqPerMin.toFixed(1)} req/min`)),
        h('div', null, h('b', null, `${s.avgKbps.toFixed(1)}`), h('span', null, `avg kbit/s · peak ${s.peakKbps.toFixed(0)}`)),
      ),
      s.days.length
        ? h(
            'div',
            { class: 'usage-bars', title: 'Last 7 days' },
            s.days.map(([d, b]) =>
              h('div', null, h('i', { style: { height: `${Math.max(3, (b / maxDay) * 46)}px` }, title: fmtBytes(b) }), fmtWeekdayShort.format(parseYMD(d))),
            ),
          )
        : null,
      s.hosts.length
        ? h(
            'table',
            { class: 'usage-table' },
            h('tr', null, h('th', null, 'Top sources today'), h('th', null, '')),
            s.hosts.slice(0, 6).map(([host, b]) => h('tr', null, h('td', null, host), h('td', null, fmtBytes(b)))),
          )
        : null,
      sync.cloud && others.length
        ? h(
            'table',
            { class: 'usage-table' },
            h('tr', null, h('th', null, 'All devices'), h('th', null, 'Today'), h('th', null, 'Last hour'), h('th', null, 'Avg kbit/s')),
            others.map(([id, e]) =>
              h(
                'tr',
                null,
                h('td', null, `${e.name}${id === device.id ? ' (this)' : ''}`, h('br'), h('small', { class: 'muted' }, timeAgo(new Date(e.at)))),
                h('td', null, fmtBytes(e.today)),
                h('td', null, fmtBytes(e.lastHour)),
                h('td', null, String(e.avgKbps)),
              ),
            ),
          )
        : null,
      h('label', { class: 'field' }, h('span', null, 'This device’s name'), nameInput),
      note,
    ),
  );
}

/* ---------- Accounts: Spotify + Aqara tokens live server-side (D1 "secrets"), shared by every screen ---------- */
function accountsSection() {
  const box = h('div', { class: 'group' }, h('small', { class: 'muted' }, 'Checking…'));
  const el = h('details', null, h('summary', null, icon('link'), 'Accounts: Spotify, Aqara, Strava'), box);
  if (!sync.cloud) {
    box.replaceChildren(h('small', null, 'Connecting accounts needs the Cloudflare backend (cloud sync).'));
    return el;
  }
  const post = (path, body) => apiJSON(path, { method: 'POST', body: JSON.stringify(body || {}) });
  const row = (name, st, setup) =>
    h(
      'div',
      { class: 'account' },
      h(
        'div',
        null,
        h('b', null, name),
        h('small', { class: 'muted' }, st.connected ? ' Connected' : st.configured ? ' Not connected' : ` Not set up — README → ${name}`),
      ),
      st.connected
        ? h(
            'button',
            {
              class: 'btn btn-ghost',
              type: 'button',
              onclick: async () => {
                if (confirm(`Disconnect ${name} for every screen?`)) {
                  await post(`/${name.toLowerCase()}/logout`).catch(() => {});
                  location.reload();
                }
              },
            },
            'Disconnect',
          )
        : st.configured
          ? h('a', { class: 'btn btn-primary', href: `${API}/${name.toLowerCase()}/login` }, `Connect ${name}`)
          : null,
      setup,
    );
  Promise.all([serviceStatus('spotify'), serviceStatus('aqara'), serviceStatus('strava')]).then(([sp, aq, sv]) => {
    let codeFlow = null;
    if (aq.configured && !aq.connected) {
      const account = h('input', { type: 'text', placeholder: 'Aqara account e-mail or phone', 'aria-label': 'Aqara account' });
      const code = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'Code', 'aria-label': 'Verification code' });
      const status = h('small');
      const send = h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: async () => {
            try {
              await post('/aqara/code', { account: account.value });
              status.textContent = 'Code sent — check your e-mail / SMS.';
            } catch (e) {
              status.textContent = e.message;
            }
          },
        },
        'Send code',
      );
      const verify = h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: async () => {
            try {
              await post('/aqara/verify', { account: account.value, code: code.value });
              location.reload();
            } catch (e) {
              status.textContent = e.message;
            }
          },
        },
        'Verify',
      );
      codeFlow = h(
        'div',
        { class: 'account-code' },
        h('small', { class: 'muted' }, `If the sign-in page doesn’t work: get a one-time code for your Aqara account (region ${aq.region}).`),
        h('div', { class: 'field-inline' }, account, send),
        h('div', { class: 'field-inline' }, code, verify),
        status,
      );
    }
    // Strava: one connection per person (each signs in to their own account).
    const strava = h(
      'div',
      { class: 'account' },
      h(
        'div',
        null,
        h('b', null, 'Strava'),
        h(
          'small',
          { class: 'muted' },
          sv.configured ? ` ${sv.athletes.length ? sv.athletes.map((a) => a.name).join(' · ') : 'No one connected yet'}` : ' Not set up — README → Strava',
        ),
      ),
      sv.configured
        ? (sv.apps || [1]).map((n) =>
            h('a', { class: `btn${n === 1 ? ' btn-primary' : ''}`, href: `${API}/strava/login?app=${n}` }, n === 1 ? 'Connect a person' : 'Connect via app 2'),
          )
        : null,
      sv.athletes?.length
        ? h(
            'div',
            { class: 'account-code' },
            sv.athletes.map((a) =>
              h(
                'div',
                { class: 'field-inline' },
                h('span', { style: { flex: '1' } }, a.name),
                h(
                  'button',
                  {
                    class: 'btn btn-ghost',
                    type: 'button',
                    onclick: async () => {
                      if (confirm(`Disconnect ${a.name}'s Strava?`)) {
                        await post('/strava/logout', { id: a.id }).catch(() => {});
                        location.reload();
                      }
                    },
                  },
                  'Disconnect',
                ),
              ),
            ),
          )
        : null,
    );
    box.replaceChildren(
      row('Spotify', sp),
      row('Aqara', aq, codeFlow),
      strava,
      h('small', { class: 'muted' }, 'Tokens stay on the Worker and are never sent to the screens.'),
    );
  });
  return el;
}

/* ---------- Backup: settings + family data as one JSON file ---------- */
const BACKUP_KEYS = ['config', 'lists', 'chores', 'meals', 'message', 'layouts'];
const localKey = (k) => (k === 'config' ? STORE_KEY : `omd.${k}.v1`);
function backupSection() {
  const ipNote = h('small', { class: 'muted' });
  if (sync.mode !== 'local')
    api('/health')
      .then((r) => r.json())
      .then((j) => {
        if (j.ip) ipNote.textContent = `This network’s public IP: ${j.ip} — use it in ALLOWED_IPS if the tablet bypasses Cloudflare Access.`;
      })
      .catch(() => {});
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  file.addEventListener('change', async () => {
    let data;
    try {
      data = JSON.parse(await file.files[0].text());
    } catch {
      alert('Not a dashboard backup file.');
      return;
    }
    const keys = BACKUP_KEYS.filter((k) => data?.[k] != null);
    if (
      !keys.length ||
      !confirm(`Replace ${keys.join(', ')} ${sync.cloud ? 'for every screen' : 'on this device'} with the backup from ${data.exported || 'file'}?`)
    )
      return;
    window.__omdSavingConfig = true;
    for (const k of keys) {
      if (!sync.cloud) {
        store.set(localKey(k), JSON.stringify(data[k]));
        continue;
      }
      let rev = sync.items[k]?.rev ?? 0;
      for (let i = 0; i < 4; i++) {
        const r = await api(`/state/${k}`, { method: 'PUT', body: JSON.stringify({ rev, value: data[k] }) });
        if (r.status !== 409) break;
        rev = (await r.json()).rev;
      }
    }
    location.reload();
  });
  const download = () => {
    const out = { app: 'oh-my-dashboard', exported: new Date().toISOString() };
    for (const k of BACKUP_KEYS) {
      if (sync.cloud) out[k] = sync.items[k]?.value ?? null;
      else {
        try {
          out[k] = JSON.parse(store.get(localKey(k)));
        } catch {
          out[k] = null;
        }
      }
    }
    const a = h('a', {
      href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })),
      download: `flora-home-backup-${ymd(new Date())}.json`,
    });
    document.body.append(a);
    a.click();
    a.remove();
  };
  const note = h('small');
  note.innerHTML = sync.cloud
    ? 'Settings and lists live in Cloudflare D1 and survive every redeploy. D1 also keeps 30 days of history: <code>npx wrangler d1 time-travel restore &lt;database&gt; --timestamp=…</code>'
    : 'Stored in this browser only — download a backup before clearing browser data.';
  return h(
    'details',
    null,
    h('summary', null, icon('database'), 'Backup & access'),
    h(
      'div',
      { class: 'group' },
      h(
        'div',
        { class: 'field-inline' },
        h('button', { class: 'btn', type: 'button', onclick: download }, 'Download backup'),
        h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, 'Restore…'),
        file,
      ),
      note,
      ipNote,
    ),
  );
}

/** Widget background steps: 0 % = none … 20 % = the frosted glass. */
const BG_STEPS = [0, 5, 10, 15, 20];
const bgStep = (v) => BG_STEPS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
function applyWidgetBg(v) {
  document.documentElement.style.setProperty('--glass-k', String(bgStep(Number(v) || 0) / 20));
}
/** The photo slideshow behind every screen (started on first use). */
function applyPhotoBg(on) {
  const bg = $('#bgPhotos');
  if (on && !bg.dataset.started) {
    bg.dataset.started = '1';
    slideshow(bg, { captions: false, glass: () => $('.screen.is-active > .grid') });
  }
  bg.hidden = !on;
}
/** Settings, above the groups: widget background + photos behind them, previewed live. */
function backgroundField() {
  let peekTimer = 0;
  const peek = () => {
    // the scrim steps aside for a moment so the change shows
    document.body.classList.add('settings-peek');
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => document.body.classList.remove('settings-peek'), 1400);
  };
  const cur = bgStep(cfg.WIDGET_BG);
  const steps = h(
    'div',
    { class: 'bg-steps', role: 'radiogroup', 'aria-label': 'Widget background' },
    BG_STEPS.map((s) =>
      h(
        'label',
        { class: 'bg-step' },
        h('input', {
          type: 'radio',
          name: 'WIDGET_BG',
          value: s,
          checked: s === cur,
          onchange: () => {
            applyWidgetBg(s);
            peek();
          },
        }),
        h('span', null, `${s}%`),
      ),
    ),
  );
  const photos = h('input', {
    type: 'checkbox',
    id: 'f_PHOTO_BACKGROUND',
    name: 'PHOTO_BACKGROUND',
    checked: !!cfg.PHOTO_BACKGROUND,
    onchange: (e) => {
      applyPhotoBg(e.target.checked);
      peek();
    },
  });
  return h(
    'div',
    { class: 'settings-top' },
    h('div', { class: 'field' }, h('span', null, 'Widget background'), steps),
    h('label', { class: 'field toggle', for: 'f_PHOTO_BACKGROUND' }, h('span', null, 'Photos behind the widgets'), photos),
  );
}
function buildSettings() {
  const section = ({ legend, ic, fields, def }) =>
    h(
      'details',
      def ? { class: `b-${def.id}`, 'data-widget': def.id } : null,
      h('summary', null, icon(ic), legend),
      h(
        'div',
        { class: 'group' },
        fields.map((f) =>
          Array.isArray(f[0])
            ? h(
                'div',
                { class: 'field-row' },
                f.map((x) => buildField(x, def)),
              )
            : buildField(f, def),
        ),
      ),
    );
  const group = (title, sub, kids) => h('section', { class: 'settings-group' }, h('h3', null, title, h('small', null, sub)), kids);
  const sections = settingsSections();
  const retired = RETIRED_SECRET_KEYS.filter((k) => saved[k]);
  form.replaceChildren(
    retired.length
      ? h(
          'div',
          { class: 'settings-top', role: 'note' },
          h(
            'small',
            null,
            `${retired.join(', ')} ${retired.length > 1 ? 'are' : 'is'} still in the saved settings, where every signed-in screen can read ${retired.length > 1 ? 'them' : 'it'}. API keys are Worker secrets now (README → Secrets): add ${retired.length > 1 ? 'them' : 'it'} there, then Save here to remove ${retired.length > 1 ? 'them' : 'it'} from the settings.`,
          ),
        )
      : '',
    backgroundField(),
    group('System', 'Screens, status bar, location and the tablet itself', sections.filter((s) => !s.def).map(section)),
    group('Data & accounts', 'Sign-ins, data usage, backups', [
      accountsSection(),
      usageSection(),
      backupSection(),
      h(
        'details',
        null,
        h('summary', null, icon('link'), 'Make it permanent'),
        h(
          'div',
          { class: 'group' },
          h(
            'label',
            { class: 'field' },
            h('span', null, 'Saved overrides — paste into OMD.configure({ defaults: … }) in app/config.js to bake them in'),
            h('textarea', { readonly: true, rows: 6 }, JSON.stringify(saved, null, 2)),
          ),
        ),
      ),
    ]),
    group('Widgets', 'What each widget shows', sections.filter((s) => s.def).map(section)),
  );
}
function openSettings(focusKey) {
  buildSettings();
  updateSyncNote();
  settingsEl.classList.add('is-open');
  settingsEl.setAttribute('aria-hidden', 'false');
  scrim.classList.add('is-visible');
  setTimeout(() => {
    const el = focusKey ? form.elements[focusKey] : $('#btnSettingsClose');
    el?.closest('details')?.setAttribute('open', '');
    el?.focus();
  }, 250);
}
function closeSettings() {
  if (!settingsEl.classList.contains('is-open')) return;
  settingsEl.classList.remove('is-open');
  settingsEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('settings-peek');
  applyWidgetBg(cfg.WIDGET_BG); // an unsaved preview goes back
  applyPhotoBg(cfg.PHOTO_BACKGROUND);
  if (!document.querySelector('.panel.is-expanded')) scrim.classList.remove('is-visible');
}
function saveSettings() {
  const next = {};
  for (const key of Object.keys(CONFIG)) {
    const el = form.elements[key];
    if (!el) {
      if (key in saved) next[key] = saved[key];
      continue;
    }
    const value = coerce(el.type === 'checkbox' ? el.checked : el.value, CONFIG[key]);
    if (JSON.stringify(value) !== JSON.stringify(CONFIG[key])) next[key] = value;
  }
  persistSettings(next);
}
/** Local mode: localStorage. Cloud mode: shared D1 row → every screen reloads with it. */
async function persistSettings(next) {
  if (!sync.cloud) {
    store.set(STORE_KEY, JSON.stringify(next));
    location.reload();
    return;
  }
  window.__omdSavingConfig = true;
  const btn = $('#btnSettingsSave');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  let rev = sync.items.config?.rev ?? 0;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await api('/state/config', { method: 'PUT', body: JSON.stringify({ rev, value: next }) });
      if (r.ok) {
        location.reload();
        return;
      }
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) {
        rev = j.rev;
        continue;
      } // settings are last-write-wins
      throw new Error(j.hint || j.error || `HTTP ${r.status}`);
    }
    throw new Error('too many concurrent edits, try again');
  } catch (e) {
    alert(`Could not save settings to the cloud: ${e.message}`);
  }
  window.__omdSavingConfig = false;
  btn.disabled = false;
  btn.textContent = 'Save & reload';
}
const SYNC_NOTES = {
  cloud: 'Synced via Cloudflare — changes apply to every screen in the family.',
  offline: 'Cloud sync unreachable — showing the last synced settings. Changes will not save until it is back.',
  denied: 'Not signed in to the sync API — settings and lists are saved on this device only.',
  local: 'Saved on this device. Overrides the built-in defaults.',
};
const updateSyncNote = () => {
  $('#settingsNote').textContent = SYNC_NOTES[sync.mode] || SYNC_NOTES.local;
};
$('#btnSettings').addEventListener('click', () => openSettings());
$('#btnSettingsClose').addEventListener('click', closeSettings);
$('#btnSettingsCancel').addEventListener('click', closeSettings);
$('#btnSettingsSave').addEventListener('click', saveSettings);
$('#btnSettingsReset').addEventListener('click', () => {
  const where = sync.cloud ? 'shared (all screens)' : 'on-device';
  if (!confirm(`Reset all ${where} settings to the defaults? (Lists, chores and notes are kept.)`)) return;
  if (sync.cloud) persistSettings({});
  else {
    store.remove(STORE_KEY);
    location.reload();
  }
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  saveSettings();
});
scrim.addEventListener('click', () => {
  setExpanded(null, false);
  closeSettings();
});

/* ---------- Dashboard name: ⚙ → Status bar, or tap it in the status bar while editing the layout ---------- */
const brandName = $('.brand-name');
const dashName = () => String(cfg.DASHBOARD_NAME || '').trim() || CORE_DEFAULTS.DASHBOARD_NAME;
function applyName() {
  brandName.textContent = dashName();
  if (VIEW !== 'lists') document.title = dashName();
}
/** Save one setting without reloading this screen (the other screens reload as usual). */
async function saveConfigValue(key, value) {
  const next = { ...saved };
  if (JSON.stringify(value) === JSON.stringify(CONFIG[key])) delete next[key];
  else next[key] = value;
  if (!sync.cloud) {
    store.set(STORE_KEY, JSON.stringify(next));
    saved = next;
    return;
  }
  window.__omdSavingConfig = true;
  try {
    let rev = sync.items.config?.rev ?? 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await api('/state/config', { method: 'PUT', body: JSON.stringify({ rev, value: next }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        sync.items.config = { rev: j.rev, value: next };
        saveSyncCache();
        saved = next;
        return;
      }
      if (r.status !== 409) throw new Error(j.hint || j.error || `HTTP ${r.status}`);
      rev = j.rev; // settings are last-write-wins
    }
    throw new Error('too many concurrent edits, try again');
  } finally {
    window.__omdSavingConfig = false;
  }
}
brandName.addEventListener('click', () => {
  if (!editing) return;
  const input = h('input', { class: 'brand-input', type: 'text', value: dashName(), maxlength: 40, 'aria-label': 'Dashboard name', enterkeyhint: 'done' });
  let done = false;
  const finish = async (keep) => {
    if (done) return;
    done = true;
    const v = input.value.trim().replace(/\s+/g, ' ');
    input.replaceWith(brandName);
    if (!keep || !v || v === dashName()) return;
    const before = cfg.DASHBOARD_NAME;
    cfg.DASHBOARD_NAME = v;
    applyName();
    try {
      await saveConfigValue('DASHBOARD_NAME', v);
      toast(`Renamed to ${v}`);
    } catch (e) {
      cfg.DASHBOARD_NAME = before;
      applyName();
      toast(`Could not save the name: ${e.message}`);
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  brandName.replaceWith(input);
  input.focus();
  input.select();
});
