//! On-device OCR plugin for BudgetMate.
//!
//! Contract (architecture.md §6.2):
//!   invoke("plugin:ocr|recognize_text", { imagePath }) -> { blocks: [{ text, bbox, confidence }] }
//!
//! The plugin returns **raw recognised text + boxes only** — it makes no financial decision.
//! Field extraction (merchant/date/total) is deterministic Rust in `app_lib::rules::receipt`,
//! and results are always confirmed by the user before saving.
//!
//! Native engines (Apple Vision on iOS, Google ML Kit on Android) are DEFERRED. Until they land,
//! `recognize_text` returns `Error::NotImplemented` so callers fail explicitly rather than
//! silently. The command surface, types, ACL, and bridge wiring are real so implementing the
//! native side later is additive (see `npx tauri plugin android init` in the run-app skill).

mod models;

pub use models::{BBox, Error, OcrBlock, OcrResult, RecognizeTextArgs, Result};

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[tauri::command]
async fn recognize_text(args: RecognizeTextArgs) -> Result<OcrResult> {
    // TODO(native): on Android call ML Kit via run_mobile_plugin on Dispatchers.IO; on iOS call
    // Apple Vision (VNRecognizeTextRequest). Both off the UI thread. Return raw blocks.
    let _ = args.image_path;
    Err(Error::NotImplemented)
}

/// Initialise the OCR plugin. Registered in `app_lib::run()`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ocr")
        .invoke_handler(tauri::generate_handler![recognize_text])
        .build()
}
