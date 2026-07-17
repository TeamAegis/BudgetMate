//! Bank-file import commands (FR-2.2). Thin wrappers: read the picked file from the path/URI the
//! dialog plugin returned. On the Windows desktop dev/test target that is a real filesystem path,
//! read via `std::fs::read_to_string`. On ANDROID the file picker returns a `content://` URI, which
//! `std::fs` cannot open - so on that target the read goes through `tauri-plugin-android-fs`
//! (`AndroidFsExt::android_fs().open_file(..., FileAccessMode::Read)`, a content-URI-aware
//! `std::fs::File`), still no new ACL permission needed since the call is Rust-side, not a
//! JS-invoked plugin command (see `docs/adr/0006-csv-import-model.md`) - unlike `extract_receipt`,
//! which forwards its path to the native OCR plugin and never touches `std::fs` in Rust at all.
//! Delegates to the pure CSV parser (`import::csv`) for the header preview and to the DB-aware
//! pipeline (`db::imports`) for preview/commit. Nothing is written until `import_commit`, and even
//! then only the rows the user did not skip; malformed rows are reported (never silently dropped).
//! Only CSV is wired - OFX/QFX are issue #13.

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

fn require_csv(format: ImportFormat) -> Result<(), AppError> {
    if format != ImportFormat::Csv {
        return Err(AppError::Validation(
            "only CSV bank-file import is supported right now - OFX/QFX are coming later"
                .to_string(),
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

/// Input for `import_preview` (mirrors TS `ImportPreviewInput`).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewInput {
    pub path: String,
    pub format: ImportFormat,
    pub account_id: i64,
    pub mapping: ColumnMappingInput,
}

/// Parse the file against `mapping`, apply the active rules + dedup, and return the rows for
/// review. Writes nothing - the user confirms on the reviewing step before `import_commit`.
#[tauri::command]
pub fn import_preview(
    app: AppHandle,
    state: State<'_, DbState>,
    input: ImportPreviewInput,
) -> Result<ImportPreviewData, AppError> {
    require_csv(input.format)?;
    let content = read_file(&app, &input.path)?;
    let mapping = ColumnMapping::from(&input.mapping);
    state.with(|c| imports::preview(c, &content, &mapping, input.account_id, None))
}

/// Input for `import_commit` (mirrors TS `ImportCommitInput`). `skip_rows` are the 0-based
/// data-row indices the user chose not to import (e.g. a flagged duplicate).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommitInput {
    pub path: String,
    pub format: ImportFormat,
    pub account_id: i64,
    pub mapping: ColumnMappingInput,
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
    require_csv(input.format)?;
    let content = read_file(&app, &input.path)?;
    let mapping = ColumnMapping::from(&input.mapping);
    let filename = resolve_filename(&app, &input.path);
    let now = chrono::Utc::now().to_rfc3339();
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
