//! On-device OCR plugin for BudgetMate.
//!
//! Contract (architecture.md §6.2):
//!   invoke("plugin:ocr|recognize_text", { imagePath }) -> { blocks: [{ text, bbox, confidence }] }
//!
//! The plugin returns **raw recognised text + boxes only** — it makes no financial decision.
//! Field extraction (merchant/date/total) is deterministic Rust in `app_lib::rules::receipt`,
//! and results are always confirmed by the user before saving.
//!
//! Native engines: **Android** uses Google ML Kit Text Recognition (bundled, on-device) — see
//! `mobile.rs` + `android/`. **iOS** (Apple Vision) is DEFERRED. On **desktop** (dev/test target)
//! the engine is a stub returning `Error::NotImplemented` so callers fail explicitly — see
//! `desktop.rs`. The command surface, types, ACL, and bridge wiring are identical across targets.

mod models;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

pub use models::{BBox, Error, OcrBlock, OcrResult, RecognizeTextArgs, Result};

#[cfg(desktop)]
use desktop::Ocr;
#[cfg(mobile)]
use mobile::Ocr;

use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

/// Access the OCR engine handle from any Tauri `Manager` (app, window, …).
pub trait OcrExt<R: Runtime> {
    fn ocr(&self) -> &Ocr<R>;
}

impl<R: Runtime, T: Manager<R>> OcrExt<R> for T {
    fn ocr(&self) -> &Ocr<R> {
        self.state::<Ocr<R>>().inner()
    }
}

/// Recognise text in a local image. Thin: delegates to the platform engine (ML Kit on Android,
/// stub on desktop). The native Android side runs recognition off the UI thread.
///
/// Contract (architecture §6.2): JS calls with `{ imagePath }`; Tauri maps the camelCase key to
/// this snake_case parameter.
#[tauri::command]
async fn recognize_text<R: Runtime>(
    app: AppHandle<R>,
    image_path: String,
) -> Result<OcrResult> {
    app.ocr().recognize_text(RecognizeTextArgs { image_path })
}

/// Initialise the OCR plugin. Registered in `app_lib::run()`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ocr")
        .invoke_handler(tauri::generate_handler![recognize_text])
        .setup(|app, api| {
            #[cfg(mobile)]
            let ocr = mobile::init(app, api)?;
            #[cfg(desktop)]
            let ocr = desktop::init(app, api)?;
            app.manage(ocr);
            Ok(())
        })
        .build()
}
