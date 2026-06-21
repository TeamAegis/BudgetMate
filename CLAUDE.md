# CLAUDE.md — Vault (Private Offline Budget App)

Greenfield mobile app. Read this fully before doing anything. Keep changes consistent with
`docs/architecture.md` and `docs/functional-requirements.md` — those are the source of truth;
this file is the operating manual.

## What this is
A **strictly offline**, privacy-first mobile budget app. Manual expense tracking, on-device
OCR receipt scanning, deterministic categorisation. **No network, no cloud, no AI logic, no
telemetry.** Built with Tauri 2.x. **v1 targets Android**; Windows desktop is a dev/test target
only (WebView2); **iOS is deferred** (macOS/Xcode-only build). See `docs/architecture.md` §11.

## Stack (do not substitute without updating the architecture doc)
- **Shell:** Tauri 2.11.x, native system WebView.
- **Frontend:** Angular 18+ **standalone**, **CSR static build (NO SSR / no Angular
  Universal)**. Charts: Chart.js via `ng2-charts`, bundled locally. Icons: **`@lucide/angular`**
  (bundled, tree-shaken) — the only icon source; no icon fonts/CDN.
- **Core logic:** Rust. Owns all money math, crypto, DB, import/export, rules.
- **DB:** SQLite + **SQLCipher** via `rusqlite` (`sqlcipher` feature) or `sqlx` +
  `libsqlite3-sys` `bundled-sqlcipher`. **NOT** the official `tauri-plugin-sql` (it has no
  SQLCipher support).
- **OCR:** custom Tauri mobile plugin → Apple Vision (iOS, Swift) + ML Kit (Android, Kotlin).
  Pure-Rust `ocrs`/RTen is the only allowed fallback. **Never** add Tesseract.js as primary.
- **Plugins:** `tauri-plugin-biometric`, `tauri-plugin-dialog`, `tauri-plugin-fs`,
  `tauri-plugin-android-fs` (Android export). Money: `rust_decimal` / integer minor units.
  Import: `ofx-rs`, `csv`. Export: `rust_xlsxwriter`.

## YOU MUST (hard rules — violating these breaks the product promise)
- **YOU MUST NOT add any network capability.** No `tauri-plugin-http`, no `reqwest`/`hyper`/
  `ureq`/`tokio::net`, no remote fonts/scripts/CDN. The CI no-network guard will fail the
  build; do not work around it.
- **YOU MUST NOT add telemetry, analytics, or crash-reporting** of any kind.
- **YOU MUST keep money as integer minor units or `rust_decimal`. Never `f32`/`f64` for
  money.**
- **YOU MUST keep all business logic (money, dedup, recurrence, categorisation, currency
  conversion) in Rust.** TypeScript only formats and presents.
- **YOU MUST wrap multi-step DB writes in a single transaction** (ACID). A crash mid-save must
  never corrupt data.
- **YOU MUST route all frontend↔backend access through `src/app/core/bridge`** (typed
  `invoke<T>()` wrappers). Feature components never call Tauri directly.
- **YOU MUST NOT remove `INTERNET`-omission from `gen/android` or add network entitlements on
  iOS.** Zero-internet is enforced there.

## Conventions
- Angular: standalone components, signals/typed forms, no NgModules unless unavoidable. Lazy-
  load `import` (OCR) and `reports` (charts) routes to protect cold start.
- When a Rust DTO changes, update its mirror in `src/app/core/models` **in the same change**
  (`.claude/rules/type-safety.md`).
- Keep the Tauri ACL minimal: grant only the commands a capability actually uses.
- OCR plugin returns raw text + boxes only; field extraction (merchant/date/total) is
  deterministic Rust, and results are always confirmed by the user before saving.
- Recurrence is materialised **lazily on app open** — never add a background scheduler/polling
  (battery rule).

## Commands
- Frontend dev: `npm run start` (Angular on :4200)
- Frontend build: `npm run build` → `dist/vault/browser`
- Desktop dev (WebView2, fast UI/bridge loop): `npm run tauri dev`
- Run on device/emulator: `npm run tauri android dev`
- Build app: `npm run tauri android build`
- Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml`
- Rust lint: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
- Frontend tests/lint: `npm test` / `npm run lint`
- Full local gate before PR: `npm run lint && npm test && cargo test ... && cargo clippy ...`

## Repo map
- `src/` — Angular app (`core/`, `features/`, `shared/` — reusable UI components live in
  `shared/ui/`; build new ones with the `ui-component` skill, never inline). See
  `.claude/rules/frontend.md` and, for UI/styling, `.claude/rules/design.md`.
- `src/styles/_tokens.scss` + `design-tokens.json` — design tokens (mirror
  `docs/design/design-system.md`). Use tokens only; never hardcode hex/px/radii in components.
- `src-tauri/src/` — Rust core (`db/`, `import/`, `rules/`, `export/`, `crypto/`). See
  `.claude/rules/rust.md` and `.claude/rules/database.md`.
- `src-tauri/plugins/ocr/` — custom native OCR plugin (Swift + Kotlin).
- `src-tauri/capabilities/` — Tauri ACL. See `.claude/rules/tauri.md` (IPC/ACL/CSP).
- `src-tauri/gen/` — committed `android/` project (the `apple/` project is added when iOS
  resumes). Do not gitignore — the Android manifest enforces zero-internet. See
  `.claude/rules/android.md` (16KB pages, WebView quirks, signing).
- `docs/` — architecture + requirements; `docs/design/` — UI/UX spec (design-system,
  ux-blueprint, screens) plus `ui-ux-principles.md` (the UI/UX heuristics knowledge base — UX laws,
  WCAG 2.2, anti-patterns — validate against it with `/design-check`, **not** a feature backlog);
  `docs/financial-knowledge.md` — financial-domain reference (definitions,
  budgeting frameworks, category taxonomy, MUR formatting, 🇲🇺 statutory figures) used to validate
  correctness + low-literacy usability, **not** a feature backlog. Update these when behaviour/UI
  changes.
- `.claude/agents/` — **role subagents** (personas, scoped tools). `.claude/skills/` — **task
  procedures**. `.claude/rules/` — domain conventions. See below. Project-wide rules:
  `.claude/rules/type-safety.md` (Rust/TS IPC contract), `.claude/rules/engineering.md`
  (testing, dependencies, ADRs, maintainability), `.claude/rules/style.md` (writing style: no
  em/en dashes or emoji). Architecture Decision Records live in `docs/adr/`.

## Roles & task skills
Delegate work to the right **role** (a `.claude/agents/` subagent — its own context + tool scope).
Only the implementer and bug-hunter may edit code; the rest are read-only advisors that report back.

| Role | Use it to… | Edits? |
| --- | --- | --- |
| **architect** | design an approach / plan non-trivial work before coding | no |
| **fullstack-engineer** | implement end-to-end (Rust-first → bridge → Angular) | yes |
| **bug-hunter** | reproduce, root-cause, and minimally fix a defect | yes (minimal) |
| **feature-researcher** | research libraries/approaches on the web, offline-filtered | no |
| **gap-analyst** | find scope-vs-code gaps for an FR / issue / area | no |
| **doc-alignment-reviewer** | find docs↔code drift and which side to fix | no |
| **finance-validator** | check a feature/screen/copy is money-correct **and** usable by a low/no-financial-literacy person | no |
| **design-validator** | check a screen/component/blueprint is UI/UX-sound **and** accessible/on-system (tokens, states, a11y) | no |
| **code-reviewer** | review a diff/area for Vault invariants (money, IPC, ACID, async, zero-internet, a11y) | no |

Task `/commands` (fork into a role): **`/gap-analysis <FR\|issue\|area>`**, **`/research-feature
<question>`**, **`/doc-align <doc\|area>`**, **`/finance-check <FR\|screen\|area>`**, **`/design-check
<screen\|component\|FR\|blueprint>`**, **`/review-vault <diff\|PR\|area>`**. Implementation and
debugging just invoke the role directly (and use the
`new-feature`/`new-screen`/`db-migration`/`dependency-audit`/`run-app` skills).

## Git & CI workflow (always)
- **Never commit or push to `main` directly.** Every change goes on its own branch off updated
  `main` and lands via a PR — so `main` always holds working code. Direct pushes to `main` are
  blocked by `.githooks/pre-push`; after cloning, run **`git config core.hooksPath .githooks`** once
  (see the `harden-main` skill).
- Branch with the **`feature-branch`** skill: `git switch -c <type>/<issue#>-<slug>`
  (`feat|fix|chore|docs|refactor`). **Conventional Commits**; every commit ends with the
  `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer. Open a PR linking the issue (`Closes #N`).
- **CI must be green before merge** — land PRs with the **`merge-pr`** skill (`gh pr checks
  --watch --fail-fast`); never merge a failing/pending check, never `--admin`/`--no-verify` past it.
- New GitHub Actions workflows: use the **`new-workflow`** skill (the real CI pipeline is issue #5).

## Definition of done for any change
1. Logic in Rust, presentation in Angular; bridge used for IPC.
2. Money is minor-units/decimal; DB writes are transactional.
3. No network/telemetry introduced; CI guards pass.
4. Rust DTO ↔ TS model kept in sync.
5. Tests + clippy + lint pass locally.
6. If behaviour changed, `docs/` updated.

> If a task seems to require breaking a YOU MUST rule, stop and flag it — do not silently work
> around it. These rules are the product.
