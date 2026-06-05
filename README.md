# BudgetMate (codename *Vault*)

> **Your money, your control.**

A **strictly offline**, privacy-first mobile budget app. Manual expense tracking, on-device OCR
receipt scanning, deterministic categorisation. Your financial data never leaves your device —
**no network, no cloud, no AI logic, no telemetry.**

- **Platforms (v1):** Android. **Windows desktop** is a dev/test target only (fast UI + IPC
  iteration via WebView2). iOS is deferred (its build is macOS/Xcode-only).
- **Stack:** Tauri 2.11.x · Angular 20 (standalone, CSR) · Rust core · SQLCipher (bundled).
- **Identifier:** `com.aegis.budgetmate`.

See [`docs/architecture.md`](docs/architecture.md) and
[`docs/functional-requirements.md`](docs/functional-requirements.md) for the source of truth,
and [`CLAUDE.md`](CLAUDE.md) for the operating rules.

## Layout
```
src/                     Angular app (core/bridge · core/models · features · shared)
src/styles/_tokens.scss  Design tokens (coral / Poppins) — mirrors docs/design/design-system.md
design-tokens.json       Same tokens, machine-readable (for tooling / sync)
docs/design/             UI/UX spec: design-system · ux-blueprint · screens (FR↔command map)
src-tauri/src/           Rust core: db (SQLCipher) · crypto (Argon2id) · domain (money)
                         · rules (receipt/engine/dedup) · import · export · commands
src-tauri/plugins/ocr/   Custom OCR plugin (raw text+boxes; native engine deferred)
src-tauri/capabilities/  Tauri ACL (minimal grants)
scripts/guards.mjs       no-network / no-telemetry / no-float-money CI guards
.claude/rules,skills     Agent rules (frontend · rust · database · design) + skills
```

## Prerequisites
- **Rust** (MSVC, `rustup default stable-msvc`) + "Desktop development with C++" (C toolchain for
  bundled SQLCipher). **Perl + NASM** are needed to build vendored OpenSSL (Strawberry Perl
  ships both).
- **Node LTS + npm.**
- **Android (when building for device):** Android Studio → SDK, Build-Tools, **NDK 28+**,
  Command-line Tools; set `ANDROID_HOME`, `NDK_HOME`, `JAVA_HOME` (Android Studio JBR);
  `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`.

## Commands
```
npm run start                 # Angular dev server on :4200 (browser preview)
npm run build                 # static build -> dist/vault/browser
npm run tauri dev             # desktop dev (WebView2) — UI + Rust bridge
npm run tauri android init    # first-time: generate src-tauri/gen/android (COMMIT it)
npm run tauri android dev     # run on emulator/device
npm run lint                  # eslint (enforces the core/bridge IPC boundary)
npm test                      # Angular unit tests (ChromeHeadless)
npm run guards                # offline / telemetry / float-money guards
cargo test  --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

## Pre-PR gate
```
npm run lint && npm test && npm run guards \
  && cargo test --manifest-path src-tauri/Cargo.toml \
  && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

## Notes
- **Design system:** coral (`#FF7755`) + **Poppins**, icons via **`@lucide/angular`** (bundled,
  tree-shaken, no CDN), default currency **MUR ("Rs")**. The full UI/UX spec lives in
  [`docs/design/`](docs/design/); tokens are in
  [`src/styles/_tokens.scss`](src/styles/_tokens.scss) + [`design-tokens.json`](design-tokens.json)
  and the build rule is [`.claude/rules/design.md`](.claude/rules/design.md).
- Fonts (**Poppins**) are **bundled** — drop the `.woff2` files into
  [`src/assets/fonts/`](src/assets/fonts/README.md) (no CDN). The UI falls back to `system-ui`
  until then.
- All IPC goes through `src/app/core/bridge` (lint-enforced). Add features via the `new-feature`
  skill (Rust command + DTO first, then mirror the TS model, bridge wrapper, component).
- The Rust core compiles and links bundled SQLCipher on Windows; an encrypted on-disk round-trip
  test proves encryption + key rejection at runtime. SQLCipher cross-compile to Android is
  verified once Android tooling is installed (`npm run tauri android dev`).

## License
[MIT](LICENSE) © 2026 TeamAegis.
