#!/usr/bin/env node
/**
 * The checks oxlint can't do on its own (run by `npm run lint` after `oxlint`):
 *
 * 1. Core JS: app/core/boot/*.js are fragments of ONE function (the build concatenates
 *    them), so they're linted together — `no-undef` then catches a helper that doesn't exist.
 * 2. Widget CSS stays in its box: every selector in app/widgets/<folder>/widget.css must go
 *    through the widget's own class, `.b-<id>` (the panel has it), and @keyframes are named
 *    `<id>-…`. A `.item { … }` in one widget can then never restyle another.
 */
import { readFile, readdir, stat, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, relative, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import postcss from 'postcss';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => relative(ROOT, p);
const problems = [];

/* ---------- 1. core boot, as one function ---------- */
const bootDir = join(ROOT, 'app', 'core', 'boot');
const bootFiles = (await readdir(bootDir)).filter((f) => f.endsWith('.js')).sort();
const parts = [];
let code = "(async () => {\n'use strict';\n",
  line = 3;
for (const f of bootFiles) {
  const text = await readFile(join(bootDir, f), 'utf8');
  parts.push({ file: join(bootDir, f), from: line, lines: text.split('\n').length });
  code += `${text}\n`;
  line += text.split('\n').length;
}
code += '})();\n';
const where = (n) => {
  const p = parts.find((x) => n >= x.from && n < x.from + x.lines);
  return p ? `${rel(p.file)}:${n - p.from + 1}` : `boot:${n}`;
};
const tmp = await mkdtemp(join(tmpdir(), 'omd-lint-'));
try {
  await writeFile(join(tmp, 'core.js'), code);
  await writeFile(
    join(tmp, '.oxlintrc.json'),
    JSON.stringify({
      env: { browser: true, es2024: true },
      globals: { OMD: 'readonly' },
      rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }] },
    }),
  );
  const oxlint = join(ROOT, 'node_modules', '.bin', 'oxlint');
  const out = await promisify(execFile)(oxlint, ['-c', join(tmp, '.oxlintrc.json'), '-f', 'unix', '--quiet', join(tmp, 'core.js')]).catch((e) => e);
  for (const m of String(out.stdout || '').matchAll(/^.*?core\.js:(\d+):\d+: (.*)$/gm)) problems.push(`${where(Number(m[1]))}: ${m[2]}`);
  if (out.code && !problems.length) problems.push(`oxlint failed: ${out.stderr || out.message}`);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

/* ---------- 2. widget CSS scope ---------- */
const widgetDirs = [join(ROOT, 'app', 'widgets'), join(ROOT, 'test', 'fixtures', 'widgets')];
const exists = (p) =>
  stat(p).then(
    () => true,
    () => false,
  );
for (const dir of widgetDirs) {
  if (!(await exists(dir))) continue;
  for (const folder of (await readdir(dir)).sort()) {
    const cssFile = join(dir, folder, 'widget.css'),
      jsFile = join(dir, folder, 'widget.js');
    if (!(await exists(cssFile))) continue;
    const ids = [...(await readFile(jsFile, 'utf8')).matchAll(/defineWidget\(\s*\{[^]*?\bid:\s*['"]([a-z][a-z0-9-]*)['"]/g)].map((m) => m[1]);
    const scope = new RegExp(`\\.b-(${ids.join('|')})(?![\\w-])`);
    let root;
    try {
      root = postcss.parse(await readFile(cssFile, 'utf8'), { from: cssFile });
    } catch (e) {
      problems.push(`${rel(cssFile)}:${e.line}: ${e.reason}`);
      continue;
    }
    const at = (node) => `${rel(cssFile)}:${node.source?.start?.line ?? '?'}`;
    root.walkAtRules((a) => {
      if (a.name.endsWith('keyframes') && !ids.some((id) => a.params === id || a.params.startsWith(`${id}-`)))
        problems.push(`${at(a)}: @keyframes "${a.params}" must be named ${ids.map((id) => `"${id}-…"`).join(' or ')}`);
      if (['import', 'font-face', 'layer'].includes(a.name)) problems.push(`${at(a)}: @${a.name} isn't allowed in a widget's CSS`);
    });
    root.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && rule.parent.name.endsWith('keyframes')) return;
      for (const sel of rule.selectors) {
        if (!scope.test(sel))
          problems.push(`${at(rule)}: "${sel}" must be scoped to ${ids.map((id) => `.b-${id}`).join(' or ')} (e.g. ".b-${ids[0]} ${sel.trim()}")`);
      }
    });
  }
}

if (problems.length) {
  console.error(problems.map((p) => `✘ ${p}`).join('\n'));
  console.error(`\n${problems.length} problem${problems.length > 1 ? 's' : ''}`);
  process.exit(1);
}
console.log(`✓ core (${bootFiles.length} files, linted as one) · widget CSS scopes`);
