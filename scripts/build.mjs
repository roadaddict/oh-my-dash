#!/usr/bin/env node
/**
 * Builds the dashboard into ONE file, public/index.html, from:
 *
 *   app/index.html               page skeleton (<!-- @styles -->, <!-- @snapshot --> and <!-- @scripts --> markers)
 *   app/core/snapshot.js         puts back the saved picture of the screen, before anything else runs
 *   app/core/styles/*.css        core styles, in file-name order
 *   app/core/runtime.js          OMD.defineWidget() & co. — runs before any widget
 *   app/config.js                your own defaults and screens (OMD.configure)
 *   app/widgets/<folder>/        widget.js (+ widget.css), one <script>/<style> each
 *   app/core/boot/*.js           the dashboard itself, in file-name order, in one async function
 *
 * Every widget gets its own <script>, so a widget that doesn't even parse (say, syntax an old
 * tablet's browser doesn't know) only takes itself down. The build also checks that every file
 * parses and writes the line ranges of each widget into the page, so the dashboard can tell
 * whose code an uncaught error came from.
 *
 * Next to the page it writes fonts/ (copied from app/fonts) and sw.js (app/sw.js with this
 * build's version and the files to keep offline), so the dashboard also starts without internet.
 *
 * It also writes lib/integrations/index.js: every lib/integrations/*.js (except _*.js) is a
 * backend integration and gets registered automatically.
 *
 *   node scripts/build.mjs                  build once
 *   node scripts/build.mjs --watch          rebuild on every change
 *   node scripts/build.mjs --check          fail if public/index.html or the integration index is out of date
 *   --out <file> · --widgets <dir> (extra widget folders, repeatable) · --config <file> · --no-syntax-check
 */
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'app');
const FONTS = join(APP, 'fonts');
const INTEGRATIONS = join(ROOT, 'lib', 'integrations');

function parseArgs(argv) {
  const o = {
    out: join(ROOT, 'public', 'index.html'),
    widgets: [join(APP, 'widgets')],
    config: join(APP, 'config.js'),
    syntax: true,
    watch: false,
    check: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = resolve(argv[++i]);
    else if (a === '--widgets') o.widgets.push(resolve(argv[++i]));
    else if (a === '--config') o.config = resolve(argv[++i]);
    else if (a === '--no-syntax-check') o.syntax = false;
    else if (a === '--watch') o.watch = true;
    else if (a === '--check') o.check = true;
    else throw new Error(`Unknown option ${a}`);
  }
  return o;
}

const exists = (p) =>
  stat(p).then(
    () => true,
    () => false,
  );
const read = (p) => readFile(p, 'utf8');
const sorted = async (dir, ext) =>
  (await readdir(dir))
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => join(dir, f));
const rel = (p) => relative(ROOT, p);

class BuildError extends Error {}

/** Fails the build with file:line when `code` doesn't parse. `offset` = lines added in front by a wrapper. */
function checkSyntax(code, file, offset = 0) {
  try {
    new vm.Script(code, { filename: file });
  } catch (e) {
    const m = /:(\d+)\s*$/m.exec(e.stack?.split('\n')[0] || '');
    const line = m ? Number(m[1]) - offset : '?';
    throw new BuildError(`${file}:${line}: ${e.message}`);
  }
}

/** Widget ids a folder defines: defineWidget({ id: 'news', … }). */
const idsIn = (code) => [...code.matchAll(/defineWidget\(\s*\{[^]*?\bid:\s*['"]([a-z][a-z0-9-]*)['"]/g)].map((m) => m[1]);

async function collectWidgets(dirs) {
  const out = [];
  for (const dir of dirs) {
    if (!(await exists(dir))) continue;
    for (const folder of (await readdir(dir)).sort()) {
      const js = join(dir, folder, 'widget.js');
      if (!(await exists(js))) continue;
      const css = join(dir, folder, 'widget.css');
      const code = await read(js);
      if (!/^[a-z][a-z0-9-]*$/.test(folder)) throw new BuildError(`${rel(js)}: folder names are lower-case letters, digits and "-"`);
      if (out.some((w) => w.folder === folder)) throw new BuildError(`${rel(js)}: there is already a widget folder called "${folder}"`);
      out.push({ folder, js, code, ids: idsIn(code), css: (await exists(css)) ? await read(css) : '', cssFile: css });
    }
  }
  return out;
}

const lineCount = (s) => s.split('\n').length - 1;

async function buildPage(opts) {
  let template = await read(join(APP, 'index.html'));
  const coreCss = (await Promise.all((await sorted(join(APP, 'core', 'styles'), '.css')).map(async (f) => `/* ${rel(f)} */\n${await read(f)}`))).join('\n');
  const runtime = await read(join(APP, 'core', 'runtime.js'));
  const icons = await read(join(APP, 'core', 'icons.js'));
  const config = (await exists(opts.config)) ? await read(opts.config) : '';
  const bootFiles = await sorted(join(APP, 'core', 'boot'), '.js');
  const boot = (await Promise.all(bootFiles.map(async (f) => `/* ---------- ${rel(f)} ---------- */\n${await read(f)}`))).join('\n');
  const widgets = await collectWidgets(opts.widgets);

  if (opts.syntax) {
    checkSyntax(runtime, rel(join(APP, 'core', 'runtime.js')));
    checkSyntax(icons, rel(join(APP, 'core', 'icons.js')));
    if (config) checkSyntax(config, rel(opts.config));
    for (const f of bootFiles) checkSyntax(`(async () => {\n${await read(f)}\n})`, rel(f), 1);
    checkSyntax(`(async () => {\n${boot}\n})`, 'app/core/boot (combined)', 1);
    for (const w of widgets) {
      checkSyntax(`(function () {\n${w.code}\n})`, rel(w.js), 1);
      if (!w.ids.length) throw new BuildError(`${rel(w.js)}: no OMD.defineWidget({ id: '…' }) found`);
    }
  }
  const allIds = widgets.flatMap((w) => w.ids);
  const dup = allIds.find((id, i) => allIds.indexOf(id) !== i);
  if (dup) throw new BuildError(`Two widgets are called "${dup}"`);

  const styles = [
    `<style>\n${coreCss}</style>`,
    ...widgets.filter((w) => w.css.trim()).map((w) => `<style data-widget="${w.folder}">\n/* ${rel(w.cssFile)} */\n${w.css}</style>`),
  ].join('\n');

  // Scripts are assembled first, then line numbers are measured on the finished page.
  // Instant start: the saved picture of the screen goes back right after its container (see app/core/snapshot.js).
  const snapshot = await read(join(APP, 'core', 'snapshot.js'));
  if (opts.syntax) checkSyntax(snapshot, 'app/core/snapshot.js');
  if (!template.includes('<!-- @snapshot -->')) throw new BuildError('app/index.html needs a <!-- @snapshot --> marker after the screens container');
  template = template.replace('<!-- @snapshot -->', `<script>\n${snapshot}</script>`);
  const [head, rest] = template.split('<!-- @styles -->');
  const [middle, tail] = rest.split('<!-- @scripts -->');
  if (tail === undefined) throw new BuildError('app/index.html needs <!-- @styles --> and <!-- @scripts --> markers');
  const banner = '<!-- GENERATED by scripts/build.mjs from app/ — do not edit this file: change app/ and run `npm run build`. -->\n';
  let page = banner + head + styles + middle;
  page += `<script>\n${runtime}</script>\n<script>\n${icons}</script>\n`;
  if (config) page += `<script data-config>\n${config}</script>\n`;
  const ranges = {};
  for (const w of widgets) {
    const block = `<script data-widget="${w.folder}">\nOMD._load(${JSON.stringify(w.folder)}, function () {\n${w.code}\n});\n</script>\n`;
    const start = lineCount(page) + 3; // first line of the widget's own code
    ranges[w.folder] = { ids: w.ids, from: start, to: start + lineCount(w.code) };
    page += block;
  }
  page += `<script>\nOMD._manifest(${JSON.stringify({ widgets: ranges })});\n</script>\n`;
  page += `<script>\n(async () => {\n'use strict';\n${boot}\n})();\n</script>\n`;
  page += tail;
  if (!page.includes('@build')) throw new BuildError('app/index.html needs <meta name="omd-build" content="@build">');
  // The build id: changes whenever the page does (saved snapshots and the offline copy check it).
  return page.replace('@build', createHash('sha256').update(page).digest('hex').slice(0, 12));
}

async function buildIntegrationIndex() {
  const files = (await readdir(INTEGRATIONS)).filter((f) => f.endsWith('.js') && f !== 'index.js' && !f.startsWith('_')).sort();
  const name = (f) => f.replace(/\.js$/, '').replace(/[^a-z0-9]+(.)/gi, (_, c) => c.toUpperCase());
  return `// GENERATED by scripts/build.mjs — do not edit. Every lib/integrations/*.js (except _*.js)
// is a backend integration; add a file there and run \`npm run build\` to register it.
${files.map((f) => `import ${name(f)} from './${f}';`).join('\n')}

export default [${files.map(name).join(', ')}];
`;
}

async function writeIfChanged(file, content, check) {
  const binary = Buffer.isBuffer(content);
  const before = (await exists(file)) ? await (binary ? readFile(file) : read(file)) : null;
  if (before !== null && (binary ? before.equals(content) : before === content)) return false;
  if (check) throw new BuildError(`${rel(file)} is out of date — run \`npm run build\` and commit the result.`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  return true;
}

/** fonts/* and sw.js next to the page. Returns how many files changed. */
async function writeOfflineFiles(opts, page) {
  const outDir = dirname(opts.out);
  const fonts = (await readdir(FONTS)).filter((f) => /\.(woff2|txt)$/.test(f)).sort();
  let changed = 0;
  for (const f of fonts) if (await writeIfChanged(join(outDir, 'fonts', f), await readFile(join(FONTS, f)), opts.check)) changed++;
  const version = /name="omd-build" content="([0-9a-f]+)"/.exec(page)[1];
  // Kept offline from the start: the Latin fonts every screen uses (other scripts load when needed).
  const precache = fonts.filter((f) => /-latin\.woff2$/.test(f)).map((f) => `fonts/${f}`);
  const sw = (await read(join(APP, 'sw.js')))
    .replace("const VERSION = 'dev';", `const VERSION = '${version}';`)
    .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(precache)};`)
    .replace(/^/, '// GENERATED by scripts/build.mjs from app/sw.js — do not edit.\n');
  if (await writeIfChanged(join(outDir, 'sw.js'), sw, opts.check)) changed++;
  return changed;
}

async function build(opts) {
  const t0 = Date.now();
  const page = await buildPage(opts);
  const changed = await writeIfChanged(opts.out, page, opts.check);
  await writeOfflineFiles(opts, page);
  const index = await buildIntegrationIndex();
  const changedIdx = await writeIfChanged(join(INTEGRATIONS, 'index.js'), index, opts.check);
  console.log(
    `${opts.check ? 'Up to date' : 'Built'}: ${rel(opts.out)}${changed ? '' : ' (unchanged)'} · lib/integrations/index.js${changedIdx ? '' : ' (unchanged)'} · ${Date.now() - t0} ms`,
  );
}

const opts = parseArgs(process.argv.slice(2));
try {
  await build(opts);
} catch (e) {
  if (!(e instanceof BuildError)) throw e;
  console.error(`✘ ${e.message}`);
  if (!opts.watch) process.exit(1);
}
if (opts.watch) {
  let timer = 0;
  const again = () => {
    clearTimeout(timer);
    timer = setTimeout(() => build(opts).catch((e) => console.error(`✘ ${e.message}`)), 80);
  };
  for (const dir of [APP, INTEGRATIONS, ...opts.widgets])
    watch(dir, { recursive: true }, (_, f) => {
      if (f !== 'index.js') again();
    });
  console.log('Watching app/ and lib/integrations/ …');
}
