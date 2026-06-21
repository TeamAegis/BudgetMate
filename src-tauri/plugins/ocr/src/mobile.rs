//! Mobile OCR engine. On **Android** this dispatches to the Kotlin `OcrPlugin` (Google ML Kit
//! Text Recognition, bundled model) via `run_mobile_plugin`; the native side runs recognition on
//! `Dispatchers.IO` so the UI thread is never blocked (NFR-Rel2). **iOS** (Apple Vision) is
//! deferred and not built in v1.

use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.plugin.ocr";

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    #[allow(unused_variables)] api: PluginApi<R, C>,
) -> crate::Result<Ocr<R>> {
    #[cfg(target_os = "android")]
    let handle = api
        .register_android_plugin(PLUGIN_IDENTIFIER, "OcrPlugin")
        .map_err(|e| Error::Plugin(e.to_string()))?;
    // iOS (Apple Vision) is deferred - no native plugin is registered in v1.
    #[cfg(not(target_os = "android"))]
    let handle: PluginHandle<R> = unimplemented!("iOS OCR (Apple Vision) is deferred for v1");
    Ok(Ocr(handle))
}

/// Mobile engine backed by the native plugin handle.
pub struct Ocr<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Ocr<R> {
    pub fn recognize_text(&self, args: RecognizeTextArgs) -> crate::Result<OcrResult> {
        self.0
            .run_mobile_plugin("recognize_text", args)
            .map_err(|e| Error::Plugin(e.to_string()))
    }
}
