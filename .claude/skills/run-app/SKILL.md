---
name: run-app
description: Build, run, and debug the Vault app on desktop dev, Android, and iOS. Use when the user wants to start the dev server, run on a device or emulator, produce a release build, or troubleshoot Tauri mobile build failures (toolchain, NDK, signing, SQLCipher C build).
---

# Running Vault

Vault = Angular (static) + Tauri 2.x + Rust core, targeting iOS and Android.

## Prerequisites (check before building)
- Node LTS + npm; Rust (MSRV ~1.80+); the Tauri CLI (`npm run tauri`).
- A C toolchain (needed to compile bundled SQLCipher).
- **Android:** Android SDK + NDK (use NDK 28+ for 16 KB page alignment), `ANDROID_HOME` /
  `NDK_HOME` set, Rust targets `aarch64-linux-android` etc.
- **iOS:** Xcode + command line tools, an Apple dev account for device builds, Rust target
  `aarch64-apple-ios`.

## Common commands
- Frontend only (browser preview): `npm run start` → http://localhost:4200
- Android emulator/device (hot reload): `npm run tauri android dev`
- iOS simulator/device (hot reload): `npm run tauri ios dev`
- Release build: `npm run tauri android build` / `npm run tauri ios build`
- Frontend production bundle: `npm run build` → `dist/vault/browser`

## First-time mobile init (greenfield)
If `src-tauri/gen/android` or `src-tauri/gen/apple` is missing:
`npm run tauri android init` and `npm run tauri ios init`. **Commit the generated `gen/`
folders** — do not gitignore them (they hold the manifest/entitlements that enforce the
zero-internet policy).

## Troubleshooting
- **SQLCipher build fails on mobile:** confirm the C toolchain + NDK are visible to the build;
  the bundled-SQLCipher feature needs to compile C for the target arch. Verify the Rust target
  is installed (`rustup target add aarch64-linux-android aarch64-apple-ios`).
- **White screen / slow start on Android:** likely WebView init; check the splash and that
  heavy routes (import/reports) are lazy-loaded.
- **Native command freezes UI on Android:** the call is running on the main thread — move it to
  a coroutine and post the result back.
- **Capability/permission errors (opaque):** check `src-tauri/capabilities/*.json` — the
  command being invoked must be granted to the window's capability.
- **Asset 404 in the WebView:** check `baseHref: "/"` in `angular.json` and `frontendDist` in
  `tauri.conf.json` point at `dist/vault/browser`.

## Pre-PR gate
`npm run lint && npm test && cargo test --manifest-path src-tauri/Cargo.toml && \
 cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
Plus: confirm CI no-network / no-telemetry / no-float-money guards pass.
