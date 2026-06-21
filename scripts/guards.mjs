#!/usr/bin/env node
// CI guards enforcing the product's load-bearing promises (architecture.md §7, §10.4).
// Pure Node, no dependencies, no network. Exits non-zero on any violation.
//
//   1. No-network   - no networking crate as a DIRECT dep (src-tauri/Cargo.toml); no
//                     tauri-plugin-http anywhere in Cargo.lock; no INTERNET in AndroidManifest.
//   2. No-telemetry - forbidden analytics/crash-reporter crate + npm names.
//   3. No-float-money - no f32/f64 in Rust money paths (annotate genuine non-money floats with
//                       `// guard:allow-float`).
//   4. Style          - no em/en dashes and no emoji (all FAIL). README is emoji-exempt (but
//                       still no dashes); the Claude Code PR-trailer line is whitelisted. See
//                       .claude/rules/style.md.
//
// On Android, Tauri CORE transitively pulls reqwest/hyper via a feature we cannot disable without
// forking Tauri. That is acknowledged here: per architecture §7.1 the load-bearing Android
// guarantee is the OMITTED INTERNET permission - without it the OS blocks all sockets regardless
// of what is linked. So we forbid networking crates we CONTROL (direct deps) + tauri-plugin-http,
// and verify the manifest, rather than failing on framework-transitive crates.
//
// Run: npm run guards   (also part of the pre-PR gate).

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
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
    note('Cargo.lock not found (build the Rust core first) - skipping lock scan.');
    return;
  }
  const names = new Set(
    [...readFileSync(lock, 'utf8').matchAll(/^name = "([^"]+)"/gm)].map((m) => m[1]),
  );
  if (names.has('tauri-plugin-http')) {
    errors.push('[no-network] tauri-plugin-http present in Cargo.lock - never add it.');
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
    note('gen/android not present yet - skipping INTERNET-permission check.');
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
              ` - use i64 minor units / rust_decimal, or annotate with // guard:allow-float`,
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

const EM_DASH = new RegExp(String.fromCodePoint(0x2014));
const EN_DASH = new RegExp(String.fromCodePoint(0x2013));
// Emoji ranges: pictographs, regional-indicator flags, misc-symbols + dingbats, and the variation
// selector. Kept narrow on purpose so typographic arrows (U+2190..U+21FF) are NOT matched.
const EMOJI =
  /[\u{1F000}-\u{1FAFF}]|[\u{1F1E6}-\u{1F1FF}]|[\u{2600}-\u{27BF}]|[\u{2B00}-\u{2BFF}]|\u{FE0F}/u;
// The Claude Code PR-trailer is mandatory (CLAUDE.md / feature-branch). Built from a code point so
// this file stays emoji-free; any line containing it is exempt from the emoji rule.
const TRAILER = `${String.fromCodePoint(0x1f916)} Generated with [Claude Code](https://claude.com/claude-code)`;
const STYLE_EXTS = new Set([
  '.md', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.rs', '.scss', '.css', '.html',
  '.json', '.yml', '.yaml', '.kt', '.kts', '.swift', '.toml', '.sh',
]);
const STYLE_PRUNE = new Set(['node_modules', 'target', 'dist', '.git', '.angular', 'gen']);

function* walkStyle(dir) {
  for (const entry of readdirSync(dir)) {
    if (STYLE_PRUNE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkStyle(full);
    else yield full;
  }
}

// 4. Style: no em/en dashes and no emoji (all FAIL). README is emoji-exempt (but still no dashes);
// the Claude Code PR-trailer line is whitelisted. Typographic arrows (U+2190..U+21FF) are allowed.
function checkStyle() {
  for (const file of walkStyle(ROOT)) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (rel.endsWith('package-lock.json')) continue;
    const inGithooks = rel.startsWith('.githooks/');
    if (!STYLE_EXTS.has(extname(file)) && !inGithooks) continue;
    const isReadme = rel === 'README.md';
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes(TRAILER)) return;
      if (!isReadme && EMOJI.test(line)) {
        errors.push(
          `[style] emoji in ${rel}:${i + 1} - remove it (emoji allowed only in README; see .claude/rules/style.md)`,
        );
      }
      if (EM_DASH.test(line)) {
        errors.push(`[style] em dash in ${rel}:${i + 1} - replace it (see .claude/rules/style.md)`);
      }
      if (EN_DASH.test(line)) {
        errors.push(`[style] en dash in ${rel}:${i + 1} - replace it (see .claude/rules/style.md)`);
      }
    });
  }
}

// 5. IPC contract: every Rust serde DTO must have a field-for-field TS mirror in core/models.
// See .claude/rules/type-safety.md and docs/adr/0001. Pure regex (no Rust toolchain) so it runs in
// the fast frontend CI job. It compares camelCased Rust struct field NAMES to the matching TS
// interface; types and optionality stay human-owned (the curated bridge carries those invariants).
const snakeToCamel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

// Rust serde structs that deliberately do NOT cross IPC (no TS mirror expected).
const DTO_SKIP = new Set(['VaultMeta']);
// Rust struct name -> TS interface name, for intentional renames.
const DTO_NAME_MAP = { PreviewInput: 'RulePreviewInput' };

function parseRustDtos() {
  const dtos = {};
  const dirs = ['domain', 'commands', 'vault', 'db', 'rules'].map((d) =>
    join(ROOT, 'src-tauri', 'src', d),
  );
  const re = /((?:#\[[^\]]*\]\s*)+)pub struct (\w+)\s*\{([^}]*)\}/g;
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      if (!file.endsWith('.rs')) continue;
      const text = readFileSync(file, 'utf8');
      let m;
      while ((m = re.exec(text))) {
        const [, attrs, name, body] = m;
        if (!/derive\([^)]*(Serialize|Deserialize)/.test(attrs)) continue;
        if (!/rename_all\s*=\s*"camelCase"/.test(attrs)) continue;
        const fields = new Set();
        for (const fm of body.matchAll(/(?:^|\n)\s*pub\s+(\w+)\s*:/g)) {
          fields.add(snakeToCamel(fm[1]));
        }
        dtos[name] = fields;
      }
    }
  }
  return dtos;
}

function parseTsInterfaces() {
  const file = join(ROOT, 'src', 'app', 'core', 'models', 'index.ts');
  if (!existsSync(file)) return {};
  const text = readFileSync(file, 'utf8');
  const fieldsOf = {};
  const parentsOf = {};
  const re = /export interface (\w+)(?:\s+extends\s+([\w,\s]+?))?\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const [, name, parents, body] = m;
    const fields = new Set();
    for (const fm of body.matchAll(/(?:^|\n)\s*(\w+)\??\s*:/g)) fields.add(fm[1]);
    fieldsOf[name] = fields;
    parentsOf[name] = parents ? parents.split(',').map((s) => s.trim()) : [];
  }
  const resolve = (name, seen = new Set()) => {
    if (seen.has(name)) return new Set();
    seen.add(name);
    const out = new Set(fieldsOf[name] || []);
    for (const p of parentsOf[name] || []) for (const f of resolve(p, seen)) out.add(f);
    return out;
  };
  const resolved = {};
  for (const name of Object.keys(fieldsOf)) resolved[name] = resolve(name);
  return resolved;
}

function checkIpcContract() {
  const rust = parseRustDtos();
  const ts = parseTsInterfaces();
  for (const [rname, rfields] of Object.entries(rust)) {
    if (DTO_SKIP.has(rname)) continue;
    const tname = DTO_NAME_MAP[rname] || rname;
    const tfields = ts[tname];
    if (!tfields) {
      note(
        `[ipc-contract] Rust DTO ${rname} has no TS interface ${tname} in core/models; ` +
          `add the mirror, or list it in DTO_NAME_MAP / DTO_SKIP (scripts/guards.mjs).`,
      );
      continue;
    }
    for (const f of rfields) {
      if (!tfields.has(f)) {
        errors.push(
          `[ipc-contract] ${rname}.${f} (Rust) has no counterpart in TS ${tname} - ` +
            `update the mirror (.claude/rules/type-safety.md).`,
        );
      }
    }
    for (const f of tfields) {
      if (!rfields.has(f)) {
        errors.push(
          `[ipc-contract] ${tname}.${f} (TS) has no counterpart in Rust ${rname} - ` +
            `update the mirror (.claude/rules/type-safety.md).`,
        );
      }
    }
  }
}

console.log(
  'Running BudgetMate guards (no-network / no-telemetry / no-float-money / style / ipc-contract)…',
);
checkDirectDeps();
checkCargoLock();
checkAndroidManifest();
checkTelemetry();
checkFloatMoney();
checkStyle();
checkIpcContract();

if (errors.length) {
  console.error(`\n[x] ${errors.length} guard violation(s):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log('[ok] All guards passed.');
