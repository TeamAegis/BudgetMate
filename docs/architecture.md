# Architecture - Private Offline Budget App (*Vault*)

**Audience:** engineers and Claude Code working in this repo.
**Last verified:** June 2026 against Tauri 2.11.x, Angular 18+, official plugin docs.
**Companion docs:** `functional-requirements.md` (the *what*), `CLAUDE.md` (agent rules).

---

## 1. System Overview

Vault is a single-process, offline mobile app. Three layers, one device, no network:

```
┌──────────────────────────────────────────────────────────────┐
│                         Mobile Device                          │
│                                                                │
│   ┌────────────────────────────────────────────────────────┐  │
│   │  System WebView  (WKWebView / Android System WebView)    │  │
│   │  ┌──────────────────────────────────────────────────┐  │  │
│   │  │  Angular SPA (static, CSR, no SSR)               │  │  │
│   │  │  features: tx · budgets · goals · reports · import│  │  │
│   │  │  charts: Chart.js (bundled)                       │  │  │
│   │  └───────────────┬──────────────────────────────────┘  │  │
│   └──────────────────│ Tauri IPC (invoke / events) ─────────┘  │
│                      │  governed by capabilities/ACL           │
│   ┌──────────────────▼──────────────────────────────────────┐ │
│   │  Rust Core (the brain)                                   │ │
│   │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │ │
│   │  │ domain │ │ import │ │ rules/ │ │ export │ │ crypto │ │ │
│   │  │ logic  │ │csv/ofx │ │ dedup  │ │xlsx/csv│ │ keymgmt│ │ │
│   │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ │ │
│   │           │                                              │ │
│   │  ┌────────▼─────────┐   ┌──────────────────────────────┐│ │
│   │  │ SQLCipher (SQLite│   │ Tauri plugins:               ││ │
│   │  │ encrypted at rest│   │ biometric · dialog · fs      ││ │
│   │  └──────────────────┘   └──────────────────────────────┘│ │
│   │  ┌──────────────────────────────────────────────────────┐│
│   │  │ Custom OCR plugin → Apple Vision (Swift) / ML Kit (Kt)││ │
│   │  └──────────────────────────────────────────────────────┘│ │
│   └──────────────────────────────────────────────────────────┘ │
│                                                                  │
│   NO network stack linked.  Android: INTERNET permission absent. │
└──────────────────────────────────────────────────────────────┘
```

**Design principle:** the Rust core is the source of truth for all business logic and data.
Angular is a presentation + orchestration layer. This keeps logic unit-testable without a
WebView and keeps money math out of JavaScript.

---

## 2. Technology Stack (verified, internally consistent)

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri 2.11.x** | Stable, production-ready; native WebView; no bundled browser. |
| WebView | WKWebView (iOS) / Android System WebView | Native, small, OS-maintained. |
| Frontend | **Angular 18+ standalone**, CSR static build | User-committed; no SSR (Tauri serves static files). |
| Charts | **Chart.js** via `ng2-charts` (bundled) | Canvas, small, fast on mobile, MIT, no CDN. |
| Icons | **`@lucide/angular`** (bundled, tree-shaken inline SVG) | Single-weight outline, MIT, no CDN/icon-font. The single icon source - see `docs/design/design-system.md` §5. |
| Core logic | **Rust** | Memory-safe, fast, testable, owns money + crypto. |
| DB | **SQLite + SQLCipher**, via `rusqlite` (`sqlcipher` feature) or `sqlx`+`libsqlite3-sys` `bundled-sqlcipher` | Encrypted at rest; ACID. **Not** the official SQL plugin (no SQLCipher support). |
| Money | `rust_decimal` and/or integer minor units | Never float. |
| Import | `ofx-rs` (OFX/QFX), `csv` + `serde` (CSV) | Maintained, pure-Rust. |
| Export | `rust_xlsxwriter` (xlsx), `csv`, `serde_json` | Pure-Rust, offline. |
| OCR | **Custom Tauri mobile plugin** → Apple Vision + ML Kit; fallback `ocrs`/RTen | On-device, best accuracy/footprint. |
| Biometric | `tauri-plugin-biometric` | Official, mobile. |
| Files | `tauri-plugin-dialog`, `tauri-plugin-fs` (+ `tauri-plugin-android-fs` for Android export) | Native pickers + sandboxed I/O. |

**Deliberately absent:** `tauri-plugin-http`, any HTTP/socket crate, any analytics/telemetry
SDK. Their presence is a build failure (see §7).

---

## 3. Frontend (Angular)

### 3.1 Build configuration
- Modern Angular standalone components (no NgModules required), **CSR only - no SSR /
  Angular Universal**. Tauri serves static files; SSR would have nothing to serve from.
- `angular.json`:
  - `outputPath` → `dist/vault` (build emits to `dist/vault/browser` with the
    `@angular/build:application` builder).
  - `baseHref: "/"` so assets resolve under Tauri's custom protocol.
  - Strict CSP; all fonts/icons/scripts bundled (no Google Fonts, no CDN).
- `tauri.conf.json` → `build.frontendDist = "../dist/vault/browser"`,
  `build.devUrl = "http://localhost:4200"`, `beforeBuildCommand = "npm run build"`,
  `beforeDevCommand = "npm run start"`.

### 3.2 App structure
```
src/app/
├── core/              # singletons: TauriBridge, models, guards (lock guard)
│   ├── bridge/        # typed wrappers around invoke<T>() - ONE place that calls Tauri
│   ├── models/        # TS interfaces mirroring Rust DTOs (kept in sync)
│   └── lock/          # biometric/passphrase unlock flow, idle-lock
├── features/
│   ├── home/          # Dashboard (balance, trend, quick actions, goals preview)
│   ├── transactions/  # "Expenses": FR-1.1..1.4 entry, split, recurring, multi-currency
│   ├── budgets/       # FR-3.1 envelopes (reached from Settings)
│   ├── goals/         # FR-3.2 savings goals
│   ├── reports/       # "Analytics": FR-3.3 charts
│   ├── import/        # FR-2.1 OCR review, FR-2.2 file import, FR-2.4 dedup review
│   └── settings/      # backup/restore/export, currency base, lock timeout
└── shared/            # dumb UI components, chart wrappers, pipes (money/date)
```
> **UI/UX source of truth:** `docs/design/` - `design-system.md` (tokens: coral + Poppins, MUR
> default), `ux-blueprint.md` (IA, flows, states), and `screens.md` (per-screen FR ↔ Rust-command
> map). Canonical bottom nav: **Home · Expenses · Goals · Analytics**; Settings via the header
> icon; Budgets/Import are nested actions (folder names above are retained; routes/titles follow
> the design). Styling rule: `.claude/rules/design.md` (tokens only, no CDN).

### 3.3 Frontend rules
- **All** access to data goes through `core/bridge` (`invoke`); feature components never call
  Tauri directly. This keeps the IPC surface auditable and the ACL minimal.
- No business logic (money math, dedup, recurrence, categorisation) in TypeScript - call
  Rust. TS only formats and presents.
- Charts: import only the Chart.js controllers/elements actually used (tree-shake).
- Icons: use **`@lucide/angular`** for every icon - import only the icons a component uses
  (tree-shaken inline SVG, no CDN). See `.claude/rules/design.md` and `docs/design/design-system.md` §5.

---

## 4. Domain & Data Model

All amounts stored as **integer minor units** (`amount_minor` + `currency`), plus the
user-supplied `fx_rate` and a derived `base_amount_minor` for reporting.

### 4.1 Core tables (SQLCipher-encrypted SQLite)
```
accounts(id, name, type, currency, opening_balance_minor, archived)
categories(id, name, parent_id, kind)                  -- kind: expense|income|transfer
transactions(id, account_id, posted_date, amount_minor, currency,
             fx_rate, base_amount_minor, payee, note,
             source, source_ref, allowance_id, created_at) -- source: manual|ocr|import;
                                                    -- allowance_id: optional allowance tag (FR-3.4, nullable)
tx_splits(id, transaction_id, category_id, amount_minor) -- sum == parent amount (FR-1.2)
recurring_rules(id, template_json, schedule, next_run_date, last_materialised_date, active)
budgets(id, category_id, period, cap_minor)             -- envelope caps (FR-3.1)
goals(id, name, target_minor, current_minor, currency, target_date) -- savings goals (FR-3.2); `currency` added in migration 0003
allowances(id, name, currency, target_minor, balance_minor, kind, period,
           week_start, next_refresh_date, active, created_at) -- imprest envelopes (FR-3.4);
                                                    -- kind: recurring|one_time; period: weekly|monthly
import_rules(id, ordinal, match_field, match_op, match_value, set_field, set_value, active)
imports(id, filename, format, imported_at, row_count)   -- audit of file imports
schema_migrations(version, applied_at)
```

### 4.2 Invariants (enforced in Rust, inside transactions)
- A split transaction's split amounts sum exactly to the parent `amount_minor` (FR-1.2).
- `base_amount_minor = round(amount_minor * fx_rate)` recomputed on edit (FR-1.4).
- Recurrence materialisation is idempotent: re-running on the same date does not
  double-insert (keyed on `recurring_rules.id` + occurrence date).
- Dedup never deletes; it only sets a `pending_review` flag surfaced to the UI (FR-2.4).
- Allowances (FR-3.4) hold the imprest invariants: `Available = Total - Reserved` where
  `Reserved = sum of max(0, balance_minor)` over active allowances; `Total` (savings) changes only on
  real cash events, never on allocation/refresh/edit/pause/delete (pure re-earmarking); an increase
  to Reserved is gated all-or-nothing by Available; a refresh **sets** the balance to target
  (carryover, no stacking, self-healing). Materialised lazily on app open (no scheduler), like
  recurrence. Full rules and worked examples: `docs/allowances.md`; decision: ADR 0005.

### 4.3 DTOs
Rust structs (`serde`) are serialised to JSON across IPC. TS interfaces in
`core/models` mirror them 1:1. When a Rust DTO changes, the matching TS interface must be
updated in the same change (see `CLAUDE.md`).

---

## 5. Storage & Cryptography

### 5.1 Encryption at rest (SQLCipher)
- **Decision:** the official `tauri-plugin-sql` does **not** support SQLCipher. Vault opens
  the DB in Rust with `rusqlite` compiled with the `sqlcipher` feature (or `sqlx` +
  `libsqlite3-sys` with `bundled-sqlcipher`), and sets the key via `PRAGMA key`.
- The C build of SQLCipher is compiled into the binary, so there is no external system
  dependency at runtime. A C toolchain is required at build time for both
  `aarch64-apple-ios` and `aarch64-linux-android` targets.

### 5.2 Key management
- The DB key is **derived from the user passphrase** (Argon2id) and never stored in
  plaintext.
- The app **boots locked**: managed state holds no connection until the user unlocks. The key is
  derived inside the unlock command, used to open the SQLCipher connection, and the `Zeroizing`
  key/hex are dropped immediately - the keyed connection itself is the only live secret.
- The per-install **salt** and the **recorded Argon2 parameters** (frozen at enrolment so future
  opens reproduce the key) plus non-sensitive lock settings live in an unencrypted sidecar
  `app_data_dir/vault-meta.json`. They must be readable before the DB is open and are not secret;
  security rests on the passphrase + Argon2 cost. An encrypted DB with no sidecar is treated as an
  inconsistent (unrecoverable) state - never silently re-initialised.
- The biometric flow unlocks a key stored in the platform secure enclave / Android Keystore;
  that releases (or decrypts) the DB key into **memory only**. Biometric is Android-only; desktop
  (dev) and the not-yet-enrolled case degrade to passphrase entry.
- On background/lock (FR-5.2), the connection is dropped (zeroising the in-memory key) via an idle
  timer and a Page-Visibility listener; the app returns to the lock screen.
- All DB operations open with the key set before any read/write.

### 5.3 ACID
Every multi-statement operation (split insert, import batch, recurrence materialisation,
restore) runs inside a single transaction. A crash mid-operation rolls back cleanly
(NFR-Rel1).

---

## 6. OCR Subsystem (FR-2.1) - the trickiest part

### 6.1 Decision
**There is no maintained off-the-shelf Tauri OCR plugin.** Vault ships a **custom Tauri
mobile plugin** that wraps the OS OCR engines:

- **iOS:** Apple Vision `VNRecognizeTextRequest` (Swift). Ships with the OS → ~0 added app
  size, runs on the Neural Engine, high accuracy on printed text, fully on-device.
- **Android:** Google ML Kit Text Recognition (Kotlin). Bundled model adds ~4 MB per script;
  the unbundled (Play Services) variant adds ~260 KB and fetches the model on first use.
  Choose **bundled** to preserve the strict offline guarantee (no first-use download).

**Fallback (single cross-platform engine):** pure-Rust `ocrs` + `RTen` (no C / ONNX-runtime
dependency, small models, Latin-only, CPU-only, early-preview accuracy). Use only if
maintaining two native code paths is undesirable and lower accuracy is acceptable.

**Rejected:** Tesseract.js (WASM) as primary - too large and slow on mobile, hurts
size/cold-start budgets. Rust Tesseract FFI (leptess) - fragile mobile cross-compilation.

### 6.2 Plugin contract
```
invoke("plugin:ocr|recognize_text", { imagePath }) ->
   { blocks: [{ text, bbox:{x,y,w,h}, confidence }] }
```
The plugin returns **raw recognised text + boxes only**. It makes no financial decision.

**Status:** implemented on **Android** (Google ML Kit Text Recognition, bundled Latin model, runs
on `Dispatchers.IO`). The plugin's Rust core splits desktop/mobile (`plugins/ocr/src/{desktop,mobile}.rs`):
mobile dispatches to the Kotlin `OcrPlugin` via `run_mobile_plugin`; desktop (dev/test) returns
`NotImplemented`. iOS (Apple Vision) is deferred. **`confidence`** is informational only - ML Kit's
text API exposes no per-block confidence, so the Android engine emits a sentinel of `1.0`; the
deterministic extractor (§6.3) decides from text + position, never from confidence.

### 6.3 Deterministic field extraction (Rust, not ML)
A pure-Rust post-processor turns OCR blocks into `{ merchant, date, total }`:
- **Total:** scan for currency-amount patterns; prefer the largest amount near a
  "total/amount due/balance" keyword, with tax/subtotal exclusion heuristics.
- **Date:** match common date formats; pick the most recent plausible date on the receipt.
- **Merchant:** top-of-receipt heuristic (largest/first text block, filtered against address
  noise).
- Output is always shown to the user for confirmation before saving (FR-2.1). Nothing is
  auto-committed.

### 6.4 Threading
OCR runs off the UI thread (NFR-Rel2). On Android, native plugin calls must not block the
main thread - use coroutines and post the result back over IPC.

---

## 7. Offline Enforcement & Security (NFR-P1, P4)

Two independent layers - neither alone is sufficient:

### 7.1 OS network (the real block)
- **Android:** the generated `AndroidManifest.xml` **omits** `android.permission.INTERNET`.
  Without it, the OS denies all socket creation, app-wide. This is genuinely enforceable and
  verifiable. The `gen/android` project is committed so this cannot silently regress.
- **iOS:** there is no permission to remove. Vault declares **no** network entitlements,
  ships a locked-down App Transport Security (no exception domains), and a
  `PrivacyInfo.xcprivacy` declaring zero network/tracking use. This is enforced by build
  hygiene and review, not an OS socket block.

### 7.2 App layer (Tauri ACL + dependency hygiene)
- Tauri **capabilities/ACL** (`src-tauri/capabilities/*.json`) grant the frontend only the
  specific commands it needs (db, ocr, dialog, fs, biometric). The `http` plugin is never
  registered, so JS cannot make HTTP via Tauri.
- **No** networking crate (`reqwest`, `hyper`, `ureq`, raw `tokio::net`, etc.) and **no**
  telemetry SDK appear in `Cargo.toml`.
- **CI guard:** the build fails if `tauri-plugin-http` appears anywhere, if a networking crate
  is a **direct** dependency of `src-tauri/Cargo.toml`, or if an `INTERNET` permission is present
  in the Android manifest (see §10.4 and `scripts/guards.mjs`).
  - **Implementation note (verified June 2026):** Tauri **core** transitively locks `reqwest`
    + `hyper` on the **Android** target via a feature that cannot be disabled without forking
    Tauri (they are absent from the desktop-dev target). The guard therefore checks the crates
    **we control** (direct deps) + `tauri-plugin-http`, and reports the framework-transitive
    crates as a non-fatal note rather than failing on them. This is sound because the
    **load-bearing** Android block is the omitted `INTERNET` permission (§7.1): without it the OS
    denies all sockets regardless of what is linked into the binary.

### 7.3 At-rest & at-launch
- SQLCipher (§5) for at-rest.
- Biometric/passphrase gate at launch + idle + background (FR-5.1/5.2) via
  `tauri-plugin-biometric`. iOS needs `NSFaceIDUsageDescription`; Android may need
  `androidx.biometric`.

---

## 8. Import Pipeline, Rule Engine & Dedup (FR-2.2/2.3/2.4)

```
file (csv/ofx/qfx) ──pick (dialog)──► read (fs) ──► parse ──► normalise to StagedTx[]
                                                              │
                          ┌───────────────────────────────────┤
                          ▼                                   ▼
                    rule engine (FR-2.3)              dedup scan (FR-2.4)
                    ordered if-then →                 (date window + exact
                    set category/account              amount + account)
                          │                                   │
                          └──────────────► review screen ◄────┘
                                           user confirms
                                                 │
                                       ACID batch insert (Rust tx)
```

- **Parsing:** `ofx-rs` handles OFX 1.x SGML + 2.x XML + QFX; `csv`+`serde` for CSV with a
  user column-mapping step.
- **Rule engine:** ordered rules, top-down, deterministic; `match_field op value → set_field
  value`. Rule management and a live `preview_rules` are built and used on manual entry; applying
  rules during file import lands with the import pipeline.
- **Dedup:** the matcher (date window + exact amount + account) is implemented in
  `rules/dedup.rs` and flags, never deletes. Wiring it into the import flow and manual entry, so
  flags are actually raised and surfaced for keep/skip, is not yet done.
- Whole batch inserts in one transaction (NFR-Rel1).

> **Status (2026-06-25):** the parsing crates are selected and the rule engine is built, but the
> import pipeline itself (file parse -> staged rows -> review -> ACID batch insert) and the dedup
> wiring are **specified, not implemented**. The import/dedup review UI is a design spec
> (`screens.md` §4.5). See §11 "Build status".

---

## 9. Backup, Restore & Export (FR-4.x)

> **Status (2026-06-25):** this section describes the intended approach. The export crates are
> selected, but backup, restore, and export are **specified, not implemented** (no `create_backup`,
> `restore_backup`, or `export_transactions` command exists yet). The Settings screens for them are
> a design spec (`screens.md` §7.4 / §7.5). See §11 "Build status".

- **Backup (FR-4.1):** produce an encrypted `.vaultbak`. Simplest robust path: the encrypted
  SQLCipher DB file *is* already encrypted; copy it (or an encrypted JSON dump) to a
  user-chosen location via the **save dialog**. On Android, `tauri-plugin-android-fs` gives
  Play-Store-safe SAF pickers + persistable URI permissions; on iOS the fs plugin manages
  security-scoped resources for picker-selected destinations.
- **Restore (FR-4.3):** pick a `.vaultbak`, prompt passphrase, validate, then replace or
  merge inside a transaction.
- **Export (FR-4.2):** `rust_xlsxwriter` for `.xlsx`, `csv` for CSV; user picks destination.
  Export is plaintext by design (it's for external use) and the UI warns accordingly.

---

## 10. Performance, Build & CI

### 10.1 Size budget (NFR-Perf1: ≤25 MB, stretch ≤20 MB)
- Native OCR (Vision = 0 MB; ML Kit bundled ≈ 4 MB) keeps OCR cheap; **do not** bundle
  Tesseract.js data or large ONNX models if the budget matters.
- Rust release profile:
  ```toml
  [profile.release]
  lto = true
  strip = true
  panic = "abort"
  codegen-units = 1
  opt-level = "z"   # size-optimised
  ```
- Angular: production build, tree-shaken Chart.js, no source maps in release, optimised
  assets.

### 10.2 Cold start (NFR-Perf2: ≤800 ms, stretch ≤500 ms)
- Splash while WebView initialises; lazy-load `import` (OCR) and `reports` (charts) routes so
  they don't block first paint.
- Measure on real mid-range Android, not just a flagship.

### 10.3 Threading
Long ops (OCR, large imports, xlsx export) run off the UI thread; native Android plugin work
uses coroutines (NFR-Rel2).

### 10.4 CI checks (the enforceable rules)
1. **No-network guard:** fail if `tauri-plugin-http` / known HTTP/socket crates appear in
   `Cargo.lock`, or if `INTERNET` appears in `gen/android/.../AndroidManifest.xml`.
2. **No-telemetry guard:** deny-list of analytics SDK names.
3. **Money guard:** lint/grep to reject `f32`/`f64` in money paths (use `rust_decimal` /
   minor units).
4. Rust `cargo test` + `cargo clippy -D warnings`; Angular `ng test` + lint.
5. Build the actual mobile bundles and record their size as a tracked metric (regression
   gate). *Status:* the **web** initial-payload size (cold-start proxy) is tracked per build by
   `scripts/bundle-size.mjs` (`npm run size`, reported to the CI run summary, fails on budget
   breach). The **Android APK/AAB** install-size metric (the NFR-Perf1 ≤25 MB number) lands with
   the Android toolchain (issue #4).

---

## 11. Maturity, Risks & Open Items

> **Platform scope (v1, locked 2026-06-05).** v1 targets **Android only**. **Windows desktop is
> a dev/test target only** (fast UI + IPC bridge iteration via WebView2) - it is not a shipping
> target. **iOS is deferred** (its build is macOS/Xcode-only and the current dev machine is
> Windows). iOS-specific notes below (Apple Vision OCR, ATS, `PrivacyInfo.xcprivacy`,
> `gen/apple`) are retained as future work and are **not** part of the v1 build.

### 11.1 Build status (as of 2026-06-25)
A snapshot of what is implemented in code, to keep this doc honest about spec vs reality. The FR
traceability table (`functional-requirements.md` §5) carries the same status per requirement.

- **Built (implemented + wired):** manual transaction entry, splits, multi-currency (per-tx
  user-entered fx rate + derived base amount), recurrence (lazy materialisation), savings goals,
  deterministic categorisation rules (management + `preview_rules`), accounts, categories, OCR
  field extraction (Android), passphrase/biometric unlock, lock-on-background, SQLCipher at rest,
  schema migrations.
- **Partial:** dedup (matcher written in `rules/dedup.rs`, not wired into import or manual entry);
  performance metrics (web payload size tracked; Android install-size metric pending issue #4).
- **Specified only (little or no runtime code):** envelope budgeting (FR-3.1; `budgets` table
  exists, no spent-vs-remaining logic), local reporting/analytics aggregations (FR-3.3), the home
  dashboard (`get_dashboard`), the import pipeline + review UI (FR-2.2), backup/restore/export
  (FR-4.x), the income/onboarding profile (`set_onboarding_profile`), and savings-backed allowances
  (FR-3.4; domain spec `docs/allowances.md` + ADR 0005, no schema or runtime code yet).

### 11.2 Open product questions (from the 2026-06 financial-domain review)
Recorded so they are not lost. These are **observations and recommendations, not committed scope**
(building features was deferred); revisit via `/gap-analysis` when budgeting work is scheduled.

- **No income / cash-flow spine.** There is an Income category kind but no place to record
  take-home pay or pay cycle, and no "money in vs out" / "left to spend" view. A budget is
  conventionally built on net income (`financial-knowledge.md` §1, §2, §6); without it, 50/30/20,
  zero-based budgeting, and planned-vs-actual variance cannot be computed.
- **Envelope engine unbuilt (FR-3.1).** The flagship budgeting feature is schema-only; there is no
  spent-vs-remaining aggregation or over-budget state in code yet.
- **Allowances specified, not built (FR-3.4).** The imprest allowance model is fully specified
  (`docs/allowances.md`, ADR 0005) but has no schema or runtime code. It depends on a savings
  `Total` / `Available` balance, so it intersects the income / cash-flow-spine gap above; pin down
  the source of `Total` when scheduling it.
- **Reports/dashboard unbuilt.** No aggregation queries exist, so the home balance and analytics
  remain placeholders.
- **Dedup not wired (FR-2.4).** The promise that duplicates are flagged is not yet met at runtime.
- **Goal progress is hand-edited.** `goals.current_minor` is set manually rather than derived from
  contributions or transactions, so it can drift from real balances.

### 11.3 Maturity and watch/migrate triggers

- **Tauri mobile** is production-ready (stable since Oct 2024; current 2.11.x) but the
  *developer experience* on mobile still has rough edges, not all desktop plugins are ported,
  and mobile CI tooling is still maturing. Expect some friction; pin versions; commit `gen/`.
- **Highest-risk unknowns to prototype first (do these before full build):**
  1. SQLCipher compiled into the Rust binary, cross-compiled to **both** iOS and Android,
     with a verified encrypted read/write on-device.
  2. The custom native OCR plugin (Vision + ML Kit) returning text to JS on both platforms.
  These two de-risk the project; everything else is well-trodden.
- **Watch / migrate triggers:**
  - If a maintained native-OCR Tauri plugin ships → adopt it, drop the custom plugin.
  - If official `tauri-plugin-sql` adds SQLCipher (issues #7/#165/#2528) → migrate DB layer.
  - If `ocrs`/RTen publishes solid mobile receipt benchmarks → consider it as the single
    engine.
  - If measured cold start > ~1 s on target devices → move more out of first paint / reduce
    Angular bundle.

---

## 12. Glossary

- **CSR** - Client-Side Rendering (the only mode used; no SSR).
- **SQLCipher** - SQLite with transparent page-level AES encryption.
- **ACL / capabilities** - Tauri's permission system gating which commands the frontend may
  invoke; governs the IPC bridge, **not** OS network access.
- **Minor units** - integer smallest currency unit (e.g. cents) used for all money storage.
- **Materialise (recurrence)** - turn a recurring rule into concrete ledger rows, done lazily
  on app open (no background scheduler).
- **Allowance (envelope)** - a savings-backed spending float that reserves money and tops up to a
  target on a cadence (FR-3.4, `docs/allowances.md`). Distinct from a savings goal and a category cap.
- **Reserved / Available** - Reserved is savings earmarked by active allowances
  (`sum of max(0, balance)`); Available is free savings (`Total - Reserved`). Shown to users in plain
  language ("set aside" / "free to spend").
- **Imprest (top-up)** - the petty-cash float pattern the allowance uses: a refresh **sets** the
  balance back to target (adds only what was drawn), so it never compounds and missed periods do not
  stack.
