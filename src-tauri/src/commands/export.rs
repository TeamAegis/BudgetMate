//! Transaction export command (FR-4.2) - desktop-first slice (see the export ADR): the frontend
//! picks `dest_path` via the `dialog` plugin's save picker (`core/bridge::pickExportDestination`);
//! this command reads the DB, assembles export rows, renders them to bytes, and writes them with
//! `std::fs::write`. Android's SAF-backed save is a separate, device-verified change - the export
//! screen shows an info banner on Android instead of calling this command.
//!
//! Read-only (no DB transaction needed), but the `std::sync::Mutex` guard is dropped BEFORE the
//! blocking render/write so it is never held across an `.await` (`.claude/rules/rust.md`).

use std::collections::HashMap;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::db;
use crate::error::AppError;
use crate::export::{self, ExportFormat};
use crate::state::DbState;
use crate::vault;

fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, AppError> {
    app.path().app_data_dir().map_err(|e| AppError::Internal(e.to_string()))
}

/// Result of a successful export (mirrors TS `ExportSummary`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub path: String,
    pub format: ExportFormat,
    pub row_count: u32,
    pub byte_len: u64,
}

/// Export every transaction to `format` at `dest_path` (already chosen by the user via the save
/// dialog on the frontend). Locked surfaces `AppError::Locked` cleanly.
#[tauri::command]
pub async fn export_transactions<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
    format: ExportFormat,
    dest_path: String,
) -> Result<ExportSummary, AppError> {
    let dir = app_data_dir(&app)?;

    // Read everything needed inside a scope so the Mutex guard drops before the blocking render +
    // write below - never hold a std::sync::Mutex guard across an await. `base_currency` is read
    // here too (rather than inside spawn_blocking below) so it comes from the SAME guarded scope
    // as the DB read: a concurrent `restore_backup` writes the new meta AND swaps the DB file
    // while holding this same DbState mutex (ADR 0008 point 4 / issue #116), so reading meta
    // under the guard guarantees a consistent (meta, DB) pair - never a stale label paired with
    // freshly-restored rows (or vice versa). `vault::read_meta` is blocking file I/O, but that is
    // fine here since it runs before the `spawn_blocking(...).await` below, not across it.
    let (txs, account_name, category_kind, base_currency) = {
        let guard = state.guard()?;
        let conn = guard.as_ref().ok_or(AppError::Locked)?;
        let txs = db::transactions::list(conn)?;
        let account_name: HashMap<i64, String> =
            // Only id -> name is used here, so the balance date is immaterial; pass today for a
            // consistent, honest read rather than an arbitrary date.
            db::accounts::list(conn, true, chrono::Utc::now().date_naive())?
                .into_iter()
                .map(|a| (a.id, a.name))
                .collect();
        let category_kind: HashMap<i64, _> =
            db::categories::list(conn, true)?.into_iter().map(|c| (c.id, c.kind)).collect();
        let base_currency = vault::read_meta(&dir).map(|m| m.settings).unwrap_or_default().base_currency;
        (txs, account_name, category_kind, base_currency)
    };

    let path = dest_path.clone();
    let (bytes, row_count) = tauri::async_runtime::spawn_blocking(move || {
        let rows = export::build_rows(&txs, &account_name, &category_kind, &base_currency);
        let row_count = rows.len() as u32;
        let bytes = export::write_bytes(format, &rows)?;
        std::fs::write(&path, &bytes).map_err(|e| AppError::Internal(e.to_string()))?;
        Ok::<(Vec<u8>, u32), AppError>((bytes, row_count))
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))??;

    log::info!("exported {row_count} transaction row(s) to {dest_path}");
    Ok(ExportSummary { path: dest_path, format, row_count, byte_len: bytes.len() as u64 })
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::*;
    use crate::db::transactions::{self, SplitInput, TxInput};

    /// Mirrors the in-memory DB harness in `db::transactions::tests`: migrations + seed. Seeded
    /// defaults: account id 1 = Cash (MUR); category 1 = Groceries (expense), 9 = Salary (income).
    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::db::run_migrations(&conn, "2026-06-06T00:00:00Z").unwrap();
        crate::db::seed_defaults(&conn).unwrap();
        conn
    }

    /// End-to-end (minus the Tauri command wrapper, which needs a live `AppHandle`): a real
    /// in-memory DB -> `db::transactions::list` -> `export::build_rows` -> `export::write_bytes`
    /// for both offered formats, exercising the same pipeline `export_transactions` drives.
    #[test]
    fn db_backed_pipeline_produces_bytes_for_every_offered_format() {
        let conn = db();
        // A simple expense and a split expense across two categories.
        transactions::create(
            &conn,
            TxInput {
                account_id: 1,
                posted_date: "2026-06-01",
                amount: "15.00",
                currency: None,
                fx_rate: None,
                splits: &[SplitInput { category_id: 1, amount: "15.00" }],
                payee: Some("Corner Shop"),
                note: None,
                allowance_id: None,
            },
            "2026-06-01T09:00:00Z",
        )
        .unwrap();
        transactions::create(
            &conn,
            TxInput {
                account_id: 1,
                posted_date: "2026-06-05",
                amount: "50.00",
                currency: None,
                fx_rate: None,
                splits: &[
                    SplitInput { category_id: 1, amount: "30.00" },
                    SplitInput { category_id: 2, amount: "20.00" },
                ],
                payee: Some("Market"),
                note: Some("weekly"),
                allowance_id: None,
            },
            "2026-06-05T09:00:00Z",
        )
        .unwrap();

        let txs = transactions::list(&conn).unwrap();
        let account_name: HashMap<i64, String> =
            crate::db::accounts::list(&conn, true, chrono::Utc::now().date_naive())
                .unwrap()
                .into_iter()
                .map(|a| (a.id, a.name))
                .collect();
        let category_kind: HashMap<i64, _> = crate::db::categories::list(&conn, true)
            .unwrap()
            .into_iter()
            .map(|c| (c.id, c.kind))
            .collect();

        let rows = crate::export::build_rows(&txs, &account_name, &category_kind, "MUR");
        // 1 row for the simple tx + 2 rows for the 2-category split = 3 rows total.
        assert_eq!(rows.len(), 3);

        let csv_bytes = crate::export::write_bytes(ExportFormat::Csv, &rows).unwrap();
        assert!(!csv_bytes.is_empty());
        let xlsx_bytes = crate::export::write_bytes(ExportFormat::Xlsx, &rows).unwrap();
        assert_eq!(&xlsx_bytes[0..4], b"PK\x03\x04");
    }

    #[test]
    fn export_summary_and_format_round_trip_over_serde() {
        for (format, expected) in [
            (ExportFormat::Csv, "\"csv\""),
            (ExportFormat::Xlsx, "\"xlsx\""),
            (ExportFormat::Json, "\"json\""),
        ] {
            assert_eq!(serde_json::to_string(&format).unwrap(), expected);
        }

        let summary = ExportSummary {
            path: "/tmp/budgetmate-export-2026-06-06.csv".into(),
            format: ExportFormat::Csv,
            row_count: 3,
            byte_len: 512,
        };
        let json = serde_json::to_string(&summary).unwrap();
        assert!(json.contains("\"path\":\"/tmp/budgetmate-export-2026-06-06.csv\""));
        assert!(json.contains("\"format\":\"csv\""));
        assert!(json.contains("\"rowCount\":3"));
        assert!(json.contains("\"byteLen\":512"));
    }
}
