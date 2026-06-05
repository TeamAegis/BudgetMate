---
name: mobile-plugin
description: Implement the Android native side of a Tauri mobile plugin for BudgetMate (Kotlin @TauriPlugin → Rust run_mobile_plugin → JS), keeping work off the UI thread and fully offline. Use when implementing the OCR ML Kit engine (issue #11) or any future on-device native capability. iOS (Swift/Vision) is deferred.
---

# Tauri Android native plugin (BudgetMate)

The only custom plugin today is **OCR** at `src-tauri/plugins/ocr/` — a buildable Rust skeleton
whose `recognize_text` returns `Error::NotImplemented`. This skill covers implementing the Android
native side so it returns real data. The same shape applies to any future native plugin.

Contract (already defined, architecture §6.2):
`invoke("plugin:ocr|recognize_text", { imagePath }) -> { blocks: [{ text, bbox, confidence }] }`.
Shared types live in `plugins/ocr/src/models.rs` (`OcrBlock`, `BBox`, `OcrResult`,
`RecognizeTextArgs`). The plugin returns **raw text + boxes only** — deterministic field
extraction stays in `app_lib::rules::receipt` and the user confirms before saving (FR-2.1).

## Layout
```
src-tauri/plugins/ocr/
├── Cargo.toml            # has `links = "tauri-plugin-ocr"`; build.rs lists COMMANDS
├── build.rs              # tauri_plugin::Builder::new(&["recognize_text"]).build()
├── permissions/          # default.toml grants allow-recognize-text (capability: ocr:default)
├── src/
│   ├── lib.rs            # init(): Builder::new("ocr").invoke_handler(...). Split desktop/mobile.
│   └── models.rs         # shared serde types + Error
└── android/              # [TO CREATE] Kotlin library project (tauri plugin android init)
```

## Steps (Android)
1. **Scaffold the Android project:** from `src-tauri/plugins/ocr/`, run
   `npx tauri plugin android init` to generate the `android/` Gradle/Kotlin library. **Commit it.**
2. **Split the Rust command** so mobile calls native, desktop keeps the stub:
   ```rust
   #[cfg(mobile)]  // dispatch to the Kotlin plugin
   self.0.run_mobile_plugin::<OcrResult>("recognize_text", args).map_err(Into::into)
   #[cfg(not(mobile))]  // desktop dev: keep returning Error::NotImplemented (or ocrs fallback)
   ```
   Register the Android plugin handle in `init()` via `.setup(|app, api| { api.register_android_plugin(...) })`.
3. **Kotlin implementation** (`android/.../OcrPlugin.kt`): a `@TauriPlugin` class extending
   `Plugin`; a `@Command fun recognize_text(invoke: Invoke)` that parses args with
   `@InvokeArg` + `invoke.parseArgs(...)`, runs **Google ML Kit Text Recognition**, maps results to
   the JSON shape (`blocks[].{text,bbox{x,y,w,h},confidence}`), and `invoke.resolve(...)`.
4. **Bundled ML Kit model** (Gradle dependency) — the on-device, **bundled** variant, NOT the
   Play-Services on-demand one, so there is no first-use model download (preserves strict-offline).
5. **Off the UI thread:** do recognition on `Dispatchers.IO` (coroutine); never block the main
   thread (ANR risk). Resolve/reject back over IPC when done.

## Hard rules
- **Zero network.** No HTTP, no remote model fetch. ML Kit must be the bundled model. The
  AndroidManifest still omits `INTERNET` — sockets are blocked OS-wide; verify guards pass.
- **No financial decision in native code** — return raw OCR blocks only.
- Keep the desktop build working: the `#[cfg(not(mobile))]` path must still compile and the
  workspace `cargo test`/`clippy` stay green (CI runs on the desktop target).
- ACL: the capability already grants `ocr:default` → `allow-recognize-text`. New commands need a
  new entry in `permissions/` + the capability.

## Verify
- `cargo clippy`/`cargo test` green on desktop (stub path).
- `npm run tauri android dev` on a device: a real receipt photo returns blocks; works in
  **airplane mode** (proves offline); UI stays responsive during recognition.
- `npm run guards` passes (no network crate added; INTERNET absent).

## iOS (deferred)
When iOS resumes: `npx tauri plugin ios init`, a Swift `Plugin` subclass with
`@objc func recognizeText(_ invoke: Invoke)` wrapping Apple Vision `VNRecognizeTextRequest`, same
JSON shape, off the main thread. Not part of v1.

## References
docs/architecture.md §6 (OCR subsystem), GitHub issue #11 (ML Kit), Tauri mobile-plugin docs
(https://v2.tauri.app/develop/plugins/develop-mobile/), src-tauri/plugins/ocr/.
