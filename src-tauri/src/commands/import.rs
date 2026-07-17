//! Bank-file import commands (FR-2.2). Thin wrappers: read the picked file from the path/URI the
//! dialog plugin returned. On the Windows desktop dev/test target that is a real filesystem path,
//! read via `std::fs`. On ANDROID the file picker returns a `content://` URI, which `std::fs`
//! cannot open - so on that target the read goes through `tauri-plugin-android-fs`
//! (`AndroidFsExt::android_fs().open_file(..., FileAccessMode::Read)`, a content-URI-aware
//! `std::fs::File`), still no new ACL permission needed since the call is Rust-side, not a
//! JS-invoked plugin command (see `docs/adr/0010-csv-import-model.md`) - unlike `extract_receipt`,
//! which forwards its path to the native OCR plugin and never touches `std::fs` in Rust at all.
//! Delegates to the pure parsers (`import::csv`, `import::ofx`) and to the DB-aware pipeline
//! (`db::imports`) for preview/commit. Nothing is written until `import_commit`, and even then only
//! the rows the user did not skip; malformed rows are reported (never silently dropped).
//!
//! CSV and OFX/QFX are both wired (`docs/adr/0011-ofx-import-wiring.md`): `format` dispatches to
//! the matching `db::imports` entry point. CSV requires a `mapping` (column layout is not
//! self-describing); OFX/QFX ignore it (the file already names its own fields) - so `mapping` is
//! optional on the wire and validated here for CSV only. `import_read_headers` stays CSV-only: a
//! header/sample-rows preview is meaningless for OFX/QFX.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::db::imports::{self, CommitInput, ImportPreviewData, ImportResultData};
use crate::error::AppError;
use crate::import::csv::{self, ColumnMapping};
use crate::import::ImportFormat;
use crate::state::DbState;

/// Header row + a few sample data rows for the column-mapping step (mirrors Rust `csv::CsvHeaders`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportHeaders {
    pub headers: Vec<String>,
    pub sample_rows: Vec<Vec<String>>,
}

/// Which source column (0-based index into `ImportHeaders.headers`) feeds each target field.
/// `date`/`amount` are required; the rest are optional (mirrors TS `ColumnMappingInput`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMappingInput {
    pub date: usize,
    pub amount: usize,
    pub payee: Option<usize>,
    pub note: Option<usize>,
    pub source_ref: Option<usize>,
}

impl From<&ColumnMappingInput> for ColumnMapping {
    fn from(m: &ColumnMappingInput) -> Self {
        ColumnMapping {
            date: m.date,
            amount: m.amount,
            payee: m.payee,
            note: m.note,
            source_ref: m.source_ref,
        }
    }
}

/// `import_read_headers` is CSV-only: an OFX/QFX file has no columns to map.
fn require_csv(format: ImportFormat) -> Result<(), AppError> {
    if format != ImportFormat::Csv {
        return Err(AppError::Validation(
            "column headers only apply to a CSV file".to_string(),
        ));
    }
    Ok(())
}

/// Windows desktop dev/test target: the dialog returns a real filesystem path.
#[cfg(not(target_os = "android"))]
fn read_file(_app: &AppHandle, path: &str) -> Result<String, AppError> {
    std::fs::read_to_string(path)
        .map_err(|e| AppError::Internal(format!("could not read that file: {e}")))
}

/// Android: the dialog returns a `content://` URI, which only a SAF-aware reader can open.
#[cfg(target_os = "android")]
fn read_file(app: &AppHandle, path: &str) -> Result<String, AppError> {
    use std::io::Read;
    use tauri_plugin_android_fs::{AndroidFsExt, FileAccessMode, FileUri};

    let uri = FileUri::from_uri(path);
    let mut file = app
        .android_fs()
        .open_file(&uri, FileAccessMode::Read)
        .map_err(|e| AppError::Internal(format!("could not read that file: {e}")))?;
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| AppError::Internal(format!("could not read that file: {e}")))?;
    Ok(content)
}

/// Windows desktop dev/test target, raw bytes (OFX/QFX): the dialog returns a real filesystem path.
#[cfg(not(target_os = "android"))]
fn read_file_bytes(_app: &AppHandle, path: &str) -> Result<Vec<u8>, AppError> {
    std::fs::read(path).map_err(|e| AppError::Internal(format!("could not read that file: {e}")))
}

/// Android, raw bytes (OFX/QFX): same content-URI-aware reader as `read_file`, without the UTF-8
/// text decode (OFX bytes are decoded internally by `import::ofx::parse_ofx`).
#[cfg(target_os = "android")]
fn read_file_bytes(app: &AppHandle, path: &str) -> Result<Vec<u8>, AppError> {
    use std::io::Read;
    use tauri_plugin_android_fs::{AndroidFsExt, FileAccessMode, FileUri};

    let uri = FileUri::from_uri(path);
    let mut file = app
        .android_fs()
        .open_file(&uri, FileAccessMode::Read)
        .map_err(|e| AppError::Internal(format!("could not read that file: {e}")))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|e| AppError::Internal(format!("could not read that file: {e}")))?;
    Ok(bytes)
}

/// The picked file's display name, for the `imports` audit row. On the desktop dev/test target
/// this is the path's final segment; on Android a `content://` URI's last segment is an opaque
/// document ID, not a filename, so the SAF-aware name lookup is used instead (falling back to the
/// raw path/URI string if that lookup fails, so `import_commit` never errors on a naming quirk).
#[cfg(not(target_os = "android"))]
fn resolve_filename(_app: &AppHandle, path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

#[cfg(target_os = "android")]
fn resolve_filename(app: &AppHandle, path: &str) -> String {
    use tauri_plugin_android_fs::{AndroidFsExt, FileUri};

    let uri = FileUri::from_uri(path);
    app.android_fs().get_name(&uri).unwrap_or_else(|_| path.to_string())
}

/// Read the header row + a few sample data rows of a picked file, for the column-mapping step.
#[tauri::command]
pub fn import_read_headers(
    app: AppHandle,
    path: String,
    format: ImportFormat,
) -> Result<ImportHeaders, AppError> {
    require_csv(format)?;
    let content = read_file(&app, &path)?;
    let h = csv::read_headers(&content);
    Ok(ImportHeaders { headers: h.headers, sample_rows: h.sample_rows })
}

/// Input for `import_preview` (mirrors TS `ImportPreviewInput`). `mapping` is required for CSV
/// (the file's column layout is not self-describing) and ignored for OFX/QFX (the file already
/// names its own fields).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewInput {
    pub path: String,
    pub format: ImportFormat,
    pub account_id: i64,
    pub mapping: Option<ColumnMappingInput>,
}

/// Parse the file (against `mapping` for CSV), apply the active rules + dedup, and return the
/// rows for review. Writes nothing - the user confirms on the reviewing step before
/// `import_commit`.
#[tauri::command]
pub fn import_preview(
    app: AppHandle,
    state: State<'_, DbState>,
    input: ImportPreviewInput,
) -> Result<ImportPreviewData, AppError> {
    match input.format {
        ImportFormat::Csv => {
            let mapping_input = input.mapping.ok_or_else(|| {
                AppError::Validation("a column mapping is required to import a CSV".to_string())
            })?;
            let content = read_file(&app, &input.path)?;
            let mapping = ColumnMapping::from(&mapping_input);
            state.with(|c| imports::preview(c, &content, &mapping, input.account_id, None))
        }
        ImportFormat::Ofx | ImportFormat::Qfx => {
            let bytes = read_file_bytes(&app, &input.path)?;
            state.with(|c| imports::preview_ofx(c, &bytes, input.account_id, None))
        }
    }
}

/// Input for `import_commit` (mirrors TS `ImportCommitInput`). `skip_rows` are the 0-based row
/// ordinals the user chose not to import (e.g. a flagged duplicate) - a data-row index for CSV, a
/// transaction-block index for OFX/QFX. `mapping` is required for CSV, ignored for OFX/QFX.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommitInput {
    pub path: String,
    pub format: ImportFormat,
    pub account_id: i64,
    pub mapping: Option<ColumnMappingInput>,
    pub skip_rows: Vec<usize>,
}

/// Commit the import as one ACID batch (re-parses the file deterministically; the file is the
/// source of truth), skipping `skip_rows`, and records the `imports` audit row.
#[tauri::command]
pub fn import_commit(
    app: AppHandle,
    state: State<'_, DbState>,
    input: ImportCommitInput,
) -> Result<ImportResultData, AppError> {
    let filename = resolve_filename(&app, &input.path);
    let now = chrono::Utc::now().to_rfc3339();
    match input.format {
        ImportFormat::Csv => {
            let mapping_input = input.mapping.ok_or_else(|| {
                AppError::Validation("a column mapping is required to import a CSV".to_string())
            })?;
            let content = read_file(&app, &input.path)?;
            let mapping = ColumnMapping::from(&mapping_input);
            state.with(|c| {
                imports::commit(
                    c,
                    CommitInput {
                        content: &content,
                        mapping: &mapping,
                        account_id: input.account_id,
                        filename: &filename,
                        format: input.format.as_str(),
                        skip_rows: &input.skip_rows,
                        window_days: None,
                    },
                    &now,
                )
            })
        }
        ImportFormat::Ofx | ImportFormat::Qfx => {
            let bytes = read_file_bytes(&app, &input.path)?;
            state.with(|c| {
                imports::commit_ofx(
                    c,
                    &bytes,
                    input.account_id,
                    &filename,
                    input.format.as_str(),
                    &input.skip_rows,
                    None,
                    &now,
                )
            })
        }
    }
}
