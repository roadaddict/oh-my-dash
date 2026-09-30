/* ==========================================================================
   REGISTRY — every widget registered itself with OMD.defineWidget() before this
   runs. Here their defaults join the core ones (CONFIG), and definitions that
   clash with each other are caught: such a widget shows an error card instead
   of mounting, and the rest of the dashboard carries on.
   ========================================================================== */
const REG = OMD._internal;
const LAYOUTS = { ...BUILTIN_LAYOUTS, ...REG.user.layouts };
/** Shared-state keys from before widgets had their own; a widget claims one with `state: ['lists']`. */
const LEGACY_STATE = ['lists', 'chores', 'meals', 'message'];

/** A settings list as single fields (rows are nested lists). */
const flatFields = (fields) => fields.flatMap((f) => (Array.isArray(f[0]) ? f : [f]));
const settingKeys = (fields) => flatFields(fields).map((f) => f[0]);
const FIELD_TYPES = ['text', 'url', 'number', 'password', 'time', 'textarea', 'checkbox', 'select', 'geo'];
/** Why a widget can't mount (definition problems), by widget id. */
const widgetProblems = new Map();
const problem = (id, msg) => {
  console.error(`Widget "${id}": ${msg}`);
  if (!widgetProblems.has(id)) widgetProblems.set(id, msg);
};

const OWNER = new Map(Object.keys(CORE_DEFAULTS).map((k) => [k, 'the dashboard']));
const CONFIG = { ...CORE_DEFAULTS };
const stateOwner = new Map();
for (const def of REG.widgets.values()) {
  for (const [k, v] of Object.entries(def.defaults)) {
    if (OWNER.has(k)) {
      problem(def.id, `setting ${k} is already defined by ${OWNER.get(k)}`);
      continue;
    }
    OWNER.set(k, `widget "${def.id}"`);
    CONFIG[k] = v;
  }
  for (const key of def.state) {
    if (!LEGACY_STATE.includes(key)) problem(def.id, `state "${key}" isn't a shared key; use ctx.state("${key}") without declaring it`);
    else if (stateOwner.has(key)) problem(def.id, `state "${key}" already belongs to "${stateOwner.get(key)}"`);
    else stateOwner.set(key, def.id);
  }
}
for (const def of REG.widgets.values()) {
  for (const k of [...settingKeys(def.settings), ...def.reads]) if (!(k in CONFIG)) problem(def.id, `setting ${k} has no default (add it to "defaults")`);
  for (const [key, , type] of flatFields(def.settings)) {
    if (!FIELD_TYPES.includes(type) && typeof def.fields[type] !== 'function')
      problem(def.id, `setting ${key} has an unknown type "${type}" (add it to "fields")`);
  }
}
for (const [k, v] of Object.entries(REG.user.defaults)) {
  if (k in CONFIG) CONFIG[k] = v;
  else console.warn(`app/config.js: unknown setting ${k} (no widget defines it)`);
}

/** Widget folders whose script never ran (it doesn't parse in this browser) or threw while registering. */
const loadFailures = new Map(); // widget id → Error
for (const [folder, info] of Object.entries(REG.manifest.widgets || {})) {
  const err = REG.loadErrors.get(folder) || (!REG.loaded.has(folder) ? new Error('its script could not be read by this browser (syntax error?)') : null);
  if (!err) continue;
  for (const id of info.ids) if (!REG.widgets.has(id)) loadFailures.set(id, err);
}
const widgetDef = (type) => REG.widgets.get(type) || null;
/** ?dev=1: hidden widgets (like the example) show up in the picker and the settings. */
const DEV = /[?&]dev=1/.test(location.search);
