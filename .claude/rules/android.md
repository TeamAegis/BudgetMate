# Rules — Android platform (`src-tauri/gen/android/`, mobile plugins)

Tauri 2.x Android. v1's primary target. Read alongside `.claude/rules/rust.md`,
`.claude/rules/tauri.md`, and the `mobile-plugin` / `run-app` skills.

## Zero-internet (hard rule)
- **Never add the `INTERNET` permission or any network entitlement.** The committed Android
  manifest omits `INTERNET` on purpose — that omission *is* the enforcement. CORS applies normally
  in the Android WebView; there is no "Tauri bypasses the network" mode.
- `src-tauri/gen/android/` is **committed** (not gitignored) so the zero-internet manifest is
  versioned. If you rename the app or change the identifier, delete and re-init the project rather
  than hand-editing generated files.

## 16KB page alignment (Play Store submission blocker)
- New/updated apps targeting Android 15+ must support 16KB memory pages. **Build with NDK r28+ and
  AGP 8.5.1+** so native `.so` files (incl. the bundled `libsqlcipher.so`) are aligned
  automatically. Play Console rejecting a bundle for alignment means the NDK/AGP is too old.

## Threading (ANR)
- **Native plugin commands are scheduled on the main thread** — long blocking work freezes the UI
  and triggers an ANR. Launch a coroutine for blocking I/O and post the result back. See the
  `mobile-plugin` skill (OCR ML Kit) for the canonical pattern.

## WebView layout quirks (verify on a real device)
- **`env(safe-area-inset-*)` is unreliable on Android WebView** (returns 0 on older Chromium /
  edge-to-edge mode) — pair it with a `visualViewport`-based workaround or read insets natively;
  don't rely on safe-area CSS alone. (Cross-ref: `.claude/rules/design.md` tap-targets/states.)
- **The keyboard does not resize the WebView** the way desktop browsers do — fixed bottom bars hide
  behind it. Compute a `--keyboard-inset` from the `visualViewport` API and adjust layout. Don't
  clear focus on resize (causes a focus-loss → keyboard-dismiss loop).

## Versioning & signing
- `versionCode` is derived as `major*1000000 + minor*1000 + patch`; override in config if needed.
  Default `minSdkVersion` is Android 7.0 (SDK 24); raise via config.
- **Never commit the keystore.** In CI, read keystore values from env vars (`ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`, `ANDROID_KEYSTORE_PATH`, `ANDROID_STORE_PASSWORD`). The generated
  `build.gradle.kts` varies across Tauri/AGP versions — verify the generated file rather than
  copying blog snippets.

## Debugging
- Inspect the WebView via Chrome DevTools (`chrome://inspect`); use `adb logcat` for native logs.
