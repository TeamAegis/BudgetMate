//! Desktop (Windows/macOS/Linux dev & test target) OCR engine.
//!
//! There is no native desktop OCR engine in v1 - desktop is a dev/test target for the UI and
//! bridge. `recognize_text` returns `Error::NotImplemented` so callers fail explicitly. A pure-Rust
//! `ocrs`/RTen fallback is the documented (but unimplemented) option here; see architecture §6.1.

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Ocr<R>> {
    Ok(Ocr(app.clone()))
}

/// Desktop stub engine. Holds the app handle for a future `ocrs` fallback.
pub struct Ocr<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> Ocr<R> {
    pub fn recognize_text(&self, _args: RecognizeTextArgs) -> crate::Result<OcrResult> {
        Err(Error::NotImplemented)
    }
}
