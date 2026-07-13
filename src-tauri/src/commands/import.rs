//! Bank-file import commands (FR-2.2). Thin wrappers: read the picked file from its local path via
//! `std::fs::read_to_string` - no new `fs:` ACL permission needed, since the dialog already returns
//! a path. This works on the Windows desktop dev/test target; on ANDROID the file picker returns a
//! `content://` URI that `std::fs` cannot open, so a content-URI-aware read
//! (`tauri-plugin-android-fs`, already a dependency) is a tracked follow-up (see
//! `docs/adr/0006-csv-import-model.md`) - unlike `extract_receipt`, which forwards its path to the
//! native OCR plugin and never touches `std::fs` in Rust at all. Delegates to the pure CSV parser
//! (`import::csv`) for the header preview and to the DB-aware pipeline (`db::imports`) for
//! preview/commit. Nothing is written until `import_commit`, and even then only the rows the user
//! did not skip; malformed rows are reported (never silently dropped). Only CSV is wired - OFX/QFX
//! are issue #13.

use serde::{Deserialize, Serialize};
use tauri::State;

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

fn read_file(path: &str) -> Result<String, AppError> {
    std::fs::read_to_string(path)
        .map_err(|e| AppError::Internal(format!("could not read that file: {e}")))
}

/// Read the header row + a few sample data rows of a picked file, for the column-mapping step.
#[tauri::command]
pub fn import_read_headers(path: String, format: ImportFormat) -> Result<ImportHeaders, AppError> {
    require_csv(format)?;
    let content = read_file(&path)?;
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
    state: State<'_, DbState>,
    input: ImportPreviewInput,
) -> Result<ImportPreviewData, AppError> {
    require_csv(input.format)?;
    let content = read_file(&input.path)?;
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
    state: State<'_, DbState>,
    input: ImportCommitInput,
) -> Result<ImportResultData, AppError> {
    require_csv(input.format)?;
    let content = read_file(&input.path)?;
    let mapping = ColumnMapping::from(&input.mapping);
    let filename = std::path::Path::new(&input.path)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| input.path.clone());
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
