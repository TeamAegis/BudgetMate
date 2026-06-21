#!/usr/bin/env node
// Web bundle-size metric (architecture.md §10.4 rule 5 / NFR-Perf2 cold start).
// Pure Node, no dependencies, no network. Exits non-zero if the initial payload exceeds the budget.
//
// Measures the INITIAL load only - the JS/CSS the browser must fetch before first paint - by
// reading the assets referenced directly in dist/vault/browser/index.html (entry <script>s,
// <link rel="modulepreload">, and <link rel="stylesheet">). Lazy route chunks are not referenced
// there, so they are correctly excluded. Reports raw + gzip size per asset and in total, and
// records the table to $GITHUB_STEP_SUMMARY so each CI build tracks the number.
//
// NOTE: this is the cold-start proxy we can measure today. The real NFR-Perf1 install-size budget
// (≤25 MB) is the Android APK/AAB, which is tracked once the Android toolchain lands (issue #4 / #5).
//
// Run: npm run size   (after `npm run build`).

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BROWSER_DIR = join(ROOT, 'dist', 'vault', 'browser');

// Budget for the INITIAL raw payload (JS + CSS). Mirrors angular.json's initial budget; this script
// makes the number visible per build and turns it into a tracked regression gate. Baseline at the
// time of writing ≈ 312 kB raw / ≈ 87 kB gzip, so there is ample headroom.
const WARN_KB = 400;
const ERROR_KB = 500;

const kb = (bytes) => (bytes / 1024).toFixed(2);

function fail(msg) {
  console.error(`[x] ${msg}`);
  process.exit(1);
}

const indexPath = join(BROWSER_DIR, 'index.html');
if (!existsSync(indexPath)) {
  fail(`no build found at dist/vault/browser - run \`npm run build\` first.`);
}

const html = readFileSync(indexPath, 'utf8');

// Collect entry scripts (.js) and stylesheet/modulepreload links from index.html.
const assets = []; // { ref, kind: 'js' | 'css' }
const seen = new Set();
const addRef = (ref, kind) => {
  const clean = ref.split('?')[0].replace(/^\//, ''); // drop query + leading slash (baseHref "/")
  if (!clean || seen.has(clean)) return;
  seen.add(clean);
  assets.push({ ref: clean, kind });
};

for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
  if (/\.js$/i.test(m[1])) addRef(m[1], 'js');
}
for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
  const rel = /\brel=["']([^"']+)["']/i.exec(tag[0])?.[1] ?? '';
  const href = /\bhref=["']([^"']+)["']/i.exec(tag[0])?.[1] ?? '';
  if (!href) continue;
  if (/modulepreload/i.test(rel) && /\.js$/i.test(href)) addRef(href, 'js');
  else if (/stylesheet/i.test(rel) && /\.css$/i.test(href)) addRef(href, 'css');
}

if (assets.length === 0) {
  fail('parsed index.html but found no initial JS/CSS assets - has the build format changed?');
}

// Measure raw + gzip for each asset.
const rows = assets
  .map(({ ref, kind }) => {
    const file = join(BROWSER_DIR, ref);
    if (!existsSync(file)) fail(`index.html references ${ref}, but the file is missing.`);
    const buf = readFileSync(file);
    return { ref, kind, raw: statSync(file).size, gzip: gzipSync(buf).length };
  })
  .sort((a, b) => b.raw - a.raw);

const total = rows.reduce(
  (acc, r) => ({ raw: acc.raw + r.raw, gzip: acc.gzip + r.gzip }),
  { raw: 0, gzip: 0 },
);
const totalRawKb = total.raw / 1024;

// ── Report (stdout + GitHub step summary) ──────────────────────────────────────
const lines = [];
lines.push('### Initial bundle size (web)');
lines.push('');
lines.push('| Asset | Type | Raw | Gzip |');
lines.push('|---|---|--:|--:|');
for (const r of rows) lines.push(`| \`${r.ref}\` | ${r.kind} | ${kb(r.raw)} kB | ${kb(r.gzip)} kB |`);
lines.push(`| **Total initial** | | **${kb(total.raw)} kB** | **${kb(total.gzip)} kB** |`);
lines.push('');
lines.push(`Budget: warn ≥ ${WARN_KB} kB, fail ≥ ${ERROR_KB} kB (raw initial). _Android APK/AAB size (NFR-Perf1 ≤25 MB) is tracked separately once the Android toolchain lands - issue #4._`);

const report = lines.join('\n');
console.log(report);

if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
  } catch {
    /* summary is best-effort; never fail the build over it */
  }
}

// ── Gate ────────────────────────────────────────────────────────────────────────
if (totalRawKb >= ERROR_KB) {
  fail(
    `initial raw bundle ${kb(total.raw)} kB exceeds the ${ERROR_KB} kB budget. ` +
      `Trim initial JS (lazy-load more routes) or justify a budget bump in scripts/bundle-size.mjs.`,
  );
}
if (totalRawKb >= WARN_KB) {
  console.error(
    `[warn] initial raw bundle ${kb(total.raw)} kB is over the ${WARN_KB} kB warning threshold (budget ${ERROR_KB} kB).`,
  );
}
console.log(`[ok] initial bundle within budget (${kb(total.raw)} kB raw / ${kb(total.gzip)} kB gzip).`);
