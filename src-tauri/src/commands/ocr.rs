//! OCR receipt commands (FR-2.1). Thin wrapper: call the on-device OCR plugin
//! (`plugin:ocr|recognize_text`) for raw text + boxes, then run the DETERMINISTIC Rust extractor
//! (`rules::receipt::extract`) to suggest merchant/date/total. The plugin makes no financial
//! decision and nothing is saved here - the frontend always confirms with the user before a save.
//!
//! Recognition runs off the UI thread (the Android native engine uses `Dispatchers.IO`, and this
//! command is `async` so it never blocks the WebView). When the native engine is unavailable
//! (desktop dev/test, iOS deferred) the plugin returns `NotImplemented`; we surface that as a
//! distinct DTO variant so the UI can show an "OCR engine not available yet" state rather than a
//! generic error.

use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_ocr::{Error as OcrError, OcrExt};

use crate::error::AppError;
use crate::rules::receipt::{self, ExtractedReceipt};

/// Result of an `extract_receipt` call (mirrors TS `ReceiptExtraction`). Either the engine is
/// unavailable on this platform, or extraction ran and produced (possibly empty) suggested fields.
/// `engineAvailable` lets the UI branch without string-matching error messages.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptExtraction {
    /// False when the native OCR engine is not implemented on this platform (desktop/iOS-deferred).
    pub engine_available: bool,
    /// Suggested fields from the deterministic extractor. All-`None` when the engine is
    /// unavailable or nothing recognisable was found (the UI shows a low-confidence/manual state).
    pub fields: ExtractedReceipt,
}

#[tauri::command]
pub async fn extract_receipt<R: Runtime>(
    app: AppHandle<R>,
    image_path: String,
) -> Result<ReceiptExtraction, AppError> {
    // Delegate recognition to the platform OCR plugin (ML Kit on Android, stub on desktop). The
    // native side runs off the UI thread; this command is async so the WebView stays responsive.
    let recognised = app
        .ocr()
        .recognize_text(tauri_plugin_ocr::RecognizeTextArgs { image_path });

    match recognised {
        Ok(result) => {
            // Deterministic extraction: `today` injected from the system clock (no ML decides).
            let today = chrono::Local::now().date_naive();
            let fields = receipt::extract(&result.blocks, today);
            Ok(ReceiptExtraction { engine_available: true, fields })
        }
        // Engine not built on this platform - surface distinctly, not as a hard error.
        Err(OcrError::NotImplemented) => Ok(ReceiptExtraction {
            engine_available: false,
            fields: ExtractedReceipt::default(),
        }),
        // A real failure (image missing, native error): bubble up the plugin's message.
        Err(e) => Err(AppError::Internal(e.to_string())),
    }
}
