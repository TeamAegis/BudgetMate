use serde::{Deserialize, Serialize};

/// Axis-aligned bounding box of a recognised text block, in image pixel coordinates.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BBox {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// One recognised block of text with its location and engine confidence (0.0–1.0).
///
/// Note: Google ML Kit's text-recognition API does not expose a per-block confidence, so the
/// Android engine emits a sentinel of `1.0`. The deterministic extractor (`app_lib::rules::receipt`)
/// makes its decisions from text + position, not confidence, so this is safe — confidence is
/// informational only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OcrBlock {
    pub text: String,
    pub bbox: BBox,
    pub confidence: f32,
}

/// Raw OCR output. The plugin returns text + boxes ONLY — it makes no financial decision.
/// Deterministic field extraction (merchant/date/total) happens in the Rust core
/// (`app_lib::rules::receipt`) and is always confirmed by the user before saving.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct OcrResult {
    pub blocks: Vec<OcrBlock>,
}

/// Argument for the `recognize_text` command. Also serialised when forwarding to the native
/// Android plugin via `run_mobile_plugin`, hence `Serialize`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognizeTextArgs {
    pub image_path: String,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("OCR is not yet implemented on this platform (native engine deferred)")]
    NotImplemented,
    #[error("image not found: {0}")]
    ImageNotFound(String),
    #[error("OCR plugin error: {0}")]
    Plugin(String),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
