//! Data export (FR-4.2): transaction history to CSV and Excel (.xlsx) via `rust_xlsxwriter`, to a
//! user-chosen location. Export is plaintext by design (for external use); the UI warns the user.
//!
//! **Desktop-first slice** (see `docs/adr/0006-export-desktop-first-android-saf-deferred.md`): the
//! writers here are platform-agnostic pure functions; the command that calls them writes bytes with
//! `std::fs::write` to a path chosen via the `dialog` plugin's save picker. Android's SAF-backed
//! save (`tauri-plugin-android-fs`) is a separate, device-verified change - the export screen shows
//! an info banner on Android instead of a broken button until then.
//!
//! (Encrypted backups - FR-4.1 - copy the already-encrypted SQLCipher file via the save dialog and
//! live with the backup/restore flow, not here.)

mod csv;
mod rows;
mod xlsx;

pub use rows::{build_rows, ExportRow};

use serde::{Deserialize, Serialize};

/// Which file format to export to (mirrors TS `ExportFormat`). The UI only ever offers `Csv` /
/// `Xlsx`; `Json` exists in the type for completeness but `write_bytes` rejects it (no writer
/// wired) so a stray call fails loudly rather than silently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    Csv,
    Xlsx,
    Json,
}

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("this export format isn't available yet")]
    Unsupported,
    #[error("could not write the CSV file: {0}")]
    Csv(#[from] ::csv::Error),
    #[error("could not write the Excel file: {0}")]
    Xlsx(#[from] rust_xlsxwriter::XlsxError),
}

/// Render `rows` to bytes in `format`. Pure (no I/O) - the caller (the `export_transactions`
/// command) writes the returned bytes to the user-chosen destination.
pub fn write_bytes(format: ExportFormat, rows: &[ExportRow]) -> Result<Vec<u8>, ExportError> {
    match format {
        ExportFormat::Csv => csv::to_csv(rows),
        ExportFormat::Xlsx => xlsx::to_xlsx(rows),
        // The UI never offers JSON (screens.md §7.4); reject rather than silently no-op.
        ExportFormat::Json => Err(ExportError::Unsupported),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row() -> ExportRow {
        ExportRow {
            date: "2026-06-06".into(),
            account: "Cash".into(),
            payee: "Market".into(),
            category: "Groceries".into(),
            kind: "Expense".into(),
            amount: "-15.00".into(),
            currency: "MUR".into(),
            base_amount: "-15.00".into(),
            base_currency: "MUR".into(),
            note: String::new(),
        }
    }

    #[test]
    fn csv_and_xlsx_dispatch_succeed() {
        let rows = [row()];
        assert!(write_bytes(ExportFormat::Csv, &rows).is_ok());
        assert!(write_bytes(ExportFormat::Xlsx, &rows).is_ok());
    }

    #[test]
    fn json_is_unsupported() {
        let rows = [row()];
        assert!(matches!(write_bytes(ExportFormat::Json, &rows), Err(ExportError::Unsupported)));
    }
}
