#!/usr/bin/env node
// CI guards enforcing the product's load-bearing promises (architecture.md §7, §10.4).
// Pure Node, no dependencies, no network. Exits non-zero on any violation.
//
//   1. No-network   — no networking crate as a DIRECT dep (src-tauri/Cargo.toml); no
//                     tauri-plugin-http anywhere in Cargo.lock; no INTERNET in AndroidManifest.
//   2. No-telemetry — forbidden analytics/crash-reporter crate + npm names.
//   3. No-float-money — no f32/f64 in Rust money paths (annotate genuine non-money floats with
//                       `// guard:allow-float`).
//
// On Android, Tauri CORE transitively pulls reqwest/hyper via a feature we cannot disable without
// forking Tauri. That is acknowledged here: per architecture §7.1 the load-bearing Android
// guarantee is the OMITTED INTERNET permission — without it the OS blocks all sockets regardless
// of what is linked. So we forbid networking crates we CONTROL (direct deps) + tauri-plugin-http,
// and verify the manifest, rather than failing on framework-transitive crates.
//
// Run: npm run guards   (also part of the pre-PR gate).

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const note = (m) => console.log(`  - ${m}`);

const NETWORK_CRATES = [
  'reqwest', 'hyper', 'ureq', 'surf', 'isahc', 'attohttpc', 'curl', 'curl-sys',
  'actix-web', 'axum', 'warp', 'rocket', 'tonic', 'tungstenite', 'tokio-tungstenite',
];
// Framework-transitive crates we cannot remove (pulled by tauri core on Android). Neutralised by
// the omitted INTERNET permission. Reported, not failed.
const KNOWN_TRANSITIVE = new Set(['reqwest', 'hyper']);

// ── 1a. No networking crate as a DIRECT dependency (the thing we control). ──────
function checkDirectDeps() {
  const manifest = join(ROOT, 'src-tauri', 'Cargo.toml');
  if (!existsSync(manifest)) return;
  const text = readFileSync(manifest, 'utf8');
  // Crude but effective: collect dependency keys from every [*dependencies] table.
  const depNames = new Set();
  let inDeps = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inDeps = /dependencies\]$/.test(line);
      continue;
    }
    if (inDeps && line && !line.startsWith('#')) {
      const m = line.match(/^([A-Za-z0-9_-]+)\s*=/);
      if (m) depNames.add(m[1]);
    }
  }
  for (const crate of [...NETWORK_CRATES, 'tauri-plugin-http']) {
    if (depNames.has(crate)) {
      errors.push(`[no-network] forbidden DIRECT dependency in src-tauri/Cargo.toml: ${crate}`);
    }
  }
}

// ── 1b. tauri-plugin-http must never appear anywhere; report transitive net crates. ──
function checkCargoLock() {
  const lock = join(ROOT, 'src-tauri', 'Cargo.lock');
  if (!existsSync(lock)) {
    note('Cargo.lock not found (build the Rust core first) — skipping lock scan.');
    return;
  }
  const names = new Set(
    [...readFileSync(lock, 'utf8').matchAll(/^name = "([^"]+)"/gm)].map((m) => m[1]),
  );
  if (names.has('tauri-plugin-http')) {
    errors.push('[no-network] tauri-plugin-http present in Cargo.lock — never add it.');
  }
  for (const crate of NETWORK_CRATES) {
    if (names.has(crate) && KNOWN_TRANSITIVE.has(crate)) {
      note(
        `[no-network] note: ${crate} is locked as a Tauri-core transitive dep ` +
          `(neutralised by the omitted INTERNET permission; not a direct dep).`,
      );
    }
  }
}

// ── 1c. AndroidManifest must omit INTERNET (the load-bearing block). ────────────
function checkAndroidManifest() {
  const base = join(ROOT, 'src-tauri', 'gen', 'android');
  if (!existsSync(base)) {
    note('gen/android not present yet — skipping INTERNET-permission check.');
    return;
  }
  for (const file of walk(base)) {
    if (file.endsWith('AndroidManifest.xml')) {
      const text = readFileSync(file, 'utf8');
      if (/android\.permission\.INTERNET/.test(text)) {
        errors.push(`[no-network] INTERNET permission present in ${relative(ROOT, file)}`);
      }
    }
  }
}

// ── 2. No-telemetry ─────────────────────────────────────────────────────────────
const FORBIDDEN_TELEMETRY = [
  'sentry', 'sentry-core', 'opentelemetry', 'datadog', 'segment', 'mixpanel', 'posthog',
  'firebase-analytics', 'app-insights',
  '@sentry/angular', '@sentry/browser', '@amplitude/analytics-browser', 'mixpanel-browser',
  'posthog-js', '@datadog/browser-rum',
];
function checkTelemetry() {
  const lock = join(ROOT, 'src-tauri', 'Cargo.lock');
  if (existsSync(lock)) {
    const names = new Set(
      [...readFileSync(lock, 'utf8').matchAll(/^name = "([^"]+)"/gm)].map((m) => m[1]),
    );
    for (const c of FORBIDDEN_TELEMETRY) {
      if (names.has(c)) errors.push(`[no-telemetry] forbidden crate: ${c}`);
    }
  }
  const pkg = join(ROOT, 'package.json');
  if (existsSync(pkg)) {
    const json = JSON.parse(readFileSync(pkg, 'utf8'));
    const deps = { ...json.dependencies, ...json.devDependencies };
    for (const c of FORBIDDEN_TELEMETRY) {
      if (deps[c]) errors.push(`[no-telemetry] forbidden npm dependency: ${c}`);
    }
  }
}

// ── 3. No-float-money ─────────────────────────────────────────────────────────────
// Money paths must never use f32/f64. Genuine non-money floats (OCR bbox coordinates) carry a
// `// guard:allow-float` comment on the same line. Comments are stripped before matching so doc
// text mentioning f32/f64 is not flagged.
const MONEY_PATHS = ['domain', 'db', 'rules', 'import', 'export'].map((d) =>
  join(ROOT, 'src-tauri', 'src', d),
);
const FLOAT_RE = /\bf(32|64)\b/;

function checkFloatMoney() {
  for (const base of MONEY_PATHS) {
    if (!existsSync(base)) continue;
    for (const file of walk(base)) {
      if (!file.endsWith('.rs')) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const code = line.split('//')[0]; // strip line comment
        if (FLOAT_RE.test(code) && !line.includes('guard:allow-float')) {
          errors.push(
            `[no-float-money] f32/f64 in money path: ${relative(ROOT, file)}:${i + 1}` +
              ` — use i64 minor units / rust_decimal, or annotate with // guard:allow-float`,
          );
        }
      });
    }
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'target' || entry === 'node_modules') continue;
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

console.log('Running BudgetMate guards (no-network / no-telemetry / no-float-money)…');
checkDirectDeps();
checkCargoLock();
checkAndroidManifest();
checkTelemetry();
checkFloatMoney();

if (errors.length) {
  console.error(`\n✖ ${errors.length} guard violation(s):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log('✔ All guards passed.');
