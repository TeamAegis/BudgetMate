# Rules - Android platform (`src-tauri/gen/android/`, mobile plugins)

Tauri 2.x Android. v1's primary target. Read alongside `.claude/rules/rust.md`,
`.claude/rules/tauri.md`, and the `mobile-plugin` / `run-app` skills.

## Zero-internet (hard rule)
- **Never add the `INTERNET` permission or any network entitlement.** The committed Android
  manifest omits `INTERNET` on purpose - that omission *is* the enforcement. CORS applies normally
  in the Android WebView; there is no "Tauri bypasses the network" mode.
- **Omission is not enough - the manifest merger folds in every dependency's declarations.** ML Kit
  drags in `com.google.android.datatransport` (Google's telemetry uploader), which declares
  `INTERNET` + `ACCESS_NETWORK_STATE`, so the built APK carried both while the source manifest was
  clean. They are stripped with `tools:node="remove"` (see the manifest and
  `docs/adr/0016-strip-dependency-injected-internet-permission.md`). **Check the artifact, not the
  source:** `scripts/wsl-build-apk.sh` runs `aapt2 dump badging` on what it builds and fails on
  `INTERNET`. Any new Android dependency must be re-checked this way - `npm run guards` alone
  cannot see a merged manifest, and CI builds no Android artifact.
- `src-tauri/gen/android/` is **committed** (not gitignored) so the zero-internet manifest is
  versioned. If you rename the app or change the identifier, delete and re-init the project rather
  than hand-editing generated files.

## 16KB page alignment (Play Store submission blocker)
- New/updated apps targeting Android 15+ must support 16KB memory pages. **Build with NDK r28+ and
  AGP 8.5.1+** so native `.so` files (incl. the bundled `libsqlcipher.so`) are aligned
  automatically. Play Console rejecting a bundle for alignment means the NDK/AGP is too old.

## Threading (ANR)
- **Native plugin commands are scheduled on the main thread** - long blocking work freezes the UI
  and triggers an ANR. Launch a coroutine for blocking I/O and post the result back. See the
  `mobile-plugin` skill (OCR ML Kit) for the canonical pattern.

## WebView layout quirks (verify on a real device)
- **`env(safe-area-inset-*)` is unreliable on Android WebView** (returns 0 on older Chromium /
  edge-to-edge mode) - pair it with a `visualViewport`-based workaround or read insets natively;
  don't rely on safe-area CSS alone. (Cross-ref: `.claude/rules/design.md` tap-targets/states.)
- **The keyboard does not resize the WebView** the way desktop browsers do - fixed bottom bars hide
  behind it. Compute a `--keyboard-inset` from the `visualViewport` API and adjust layout. Don't
  clear focus on resize (causes a focus-loss → keyboard-dismiss loop).
- **Forms are full-screen pages, not centred modals** - this avoids the centred-modal keyboard trap
  where the soft keyboard covered the bottom of the card (including Save). `.app-content` consumes
  `--keyboard-inset` as `padding-bottom`, so the focused field scrolls clear of the keyboard, and
  *Save* lives in a **fixed bottom action bar** (`FormActions`) that is itself lifted by
  `--keyboard-inset`, so it rides above the soft keyboard instead of hiding behind it (the form page
  reserves matching bottom padding so the last field clears the bar). The destructive action
  (Delete/Archive) is a danger icon-button in the header. `android:windowSoftInputMode="adjustResize"`
  is set on MainActivity, but the `visualViewport` `--keyboard-inset` service stays the **primary**
  keyboard-aware mechanism (the `interactive-widget` meta does not affect the Android System WebView).
  See `docs/adr/0002-page-based-forms-no-modals.md` (forms are pages) and ADR 0003 (form action
  placement: bottom Save bar + header Delete).

## Versioning & signing
- `versionCode` is derived as `major*1000000 + minor*1000 + patch`; override in config if needed.
  Default `minSdkVersion` is Android 7.0 (SDK 24); raise via config.
- **Never commit the keystore.** `src-tauri/gen/android/app/build.gradle.kts` reads the four signing
  values from `app/keystore.properties` (gitignored) and falls back to the env vars
  (`ANDROID_KEYSTORE_PATH`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`)
  for CI. With none of them set the release build WARNS and emits an unsigned artifact, so a
  size check still works without a key. Paths must be WSL-resolvable (`/mnt/c/...`) since Android
  builds run under WSL2. See `docs/adr/0015-android-release-signing-and-distribution.md`.
- **Build releases with `scripts/wsl-build-apk.sh release [apk|aab]`** (default is `debug apk`); it
  verifies the signature with `apksigner` afterwards. A debug APK is NOT a release artifact - it
  installs under a different application id (`.debug` suffix) and cannot upgrade a release install.
- `build.gradle.kts` and `app/proguard-rules.pro` are generated files that now carry hand-written
  blocks (signing, OCR R8 keep rules). Re-applying them is part of any `tauri android init` redo.

## Debugging
- Inspect the WebView via Chrome DevTools (`chrome://inspect`); use `adb logcat` for native logs.
