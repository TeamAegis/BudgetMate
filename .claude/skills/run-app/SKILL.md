---
name: run-app
description: Build, run, and debug the BudgetMate (Vault) app on Windows desktop dev and Android. Use when the user wants to start the dev server, run on a device/emulator, produce a release build, or troubleshoot Tauri/Rust build failures (toolchain, NDK, SQLCipher/OpenSSL C build, capabilities).
---

# Running BudgetMate (Vault)

Vault = Angular 20 (static, CSR) + Tauri 2.11.x + Rust core. **v1 targets Android.** **Windows
desktop is a dev/test target only** (fast UI + IPC iteration via WebView2) — not shipped. **iOS is
deferred** (its build is macOS/Xcode-only); the `tauri ios *` commands and `gen/apple` are out of
scope on this Windows machine. See `docs/architecture.md` §11 (platform scope).

## Prerequisites (check before building)
- **Node LTS + npm**; **Rust** (MSVC, MSRV ~1.80+); Tauri CLI via `npm run tauri`.
- **C toolchain + OpenSSL build deps for bundled SQLCipher:** MSVC "Desktop development with C++",
  plus **Perl and NASM** on PATH (the `bundled-sqlcipher-vendored-openssl` feature compiles
  OpenSSL from source). Strawberry Perl ships both. Without these the Rust build fails in
  `openssl-sys`/`libsqlite3-sys`.
- **Android:** Android Studio → SDK + Build-Tools + **NDK 28+** (16 KB page alignment) +
  Command-line Tools; set `ANDROID_HOME`, `NDK_HOME`, `JAVA_HOME` (Android Studio JBR); install
  Rust targets: `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`.

## Common commands
- Frontend only (browser preview): `npm run start` → http://localhost:4200
- **Desktop dev (WebView2, fastest UI/bridge loop):** `npm run tauri dev`
- Android emulator/device (hot reload): `npm run tauri android dev`
- Android release: `npm run tauri android build`
- Frontend production bundle: `npm run build` → `dist/vault/browser`

## First-time Android init (greenfield)
If `src-tauri/gen/android` is missing: `npm run tauri android init`. **Commit `src-tauri/gen/android`**
— do not gitignore it; the committed `AndroidManifest.xml` is what enforces the zero-internet
policy by **omitting `android.permission.INTERNET`** (verify this after init; the guard checks it).

## Known pins / gotchas
- **`rusqlite` is pinned to `0.37`** (`src-tauri/Cargo.toml`). 0.40 pulls `libsqlite3-sys` 0.38
  whose build script uses the unstable `cfg_select` feature and fails on stable Rust. Don't bump
  without re-checking this.
- **`tauri-plugin-biometric` is Android-only here** (registered under `#[cfg(target_os = "android")]`
  in `lib.rs`; its `init()` is mobile-only).
- Tauri core transitively locks `reqwest`/`hyper` on Android — expected and neutralised by the
  omitted INTERNET permission (see `scripts/guards.mjs` / architecture §7.2). Not a violation.

## Troubleshooting
- **SQLCipher/OpenSSL build fails:** confirm Perl + NASM (desktop) and the NDK/C toolchain
  (Android) are visible; confirm the Rust target is installed. Do **not** switch off bundled
  SQLCipher.
- **White screen / slow start on Android:** WebView init; check the splash and that heavy routes
  (`import`/`analytics`) stay lazy-loaded.
- **Native command freezes UI on Android:** the call is on the main thread — move it to a
  coroutine (`Dispatchers.IO`) and post the result back (see the `mobile-plugin` skill).
- **Capability/permission errors (opaque):** check `src-tauri/capabilities/*.json` — the invoked
  plugin command must be granted to the window's capability (app-defined commands need no grant).
- **Asset 404 in the WebView:** check `baseHref: "/"` in `angular.json` and `frontendDist` in
  `tauri.conf.json` point at `dist/vault/browser`.

## Pre-PR gate
`npm run lint && npm test && npm run guards && \
 cargo test --manifest-path src-tauri/Cargo.toml && \
 cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
The `guards` step runs the no-network / no-telemetry / no-float-money checks (and the Android
INTERNET-manifest check once `gen/android` exists).
