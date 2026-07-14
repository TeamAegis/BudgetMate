//! Home dashboard command (issue #50) - thin wrapper: read the base (reporting) currency from
//! vault settings (not the DB), and delegate to `db::dashboard::dashboard` for the aggregate.
//! Money semantics are documented in `domain::dashboard` (validated by `/finance-check`).

use tauri::{AppHandle, Manager, Runtime, State};

use crate::domain::dashboard::DashboardData;
use crate::error::AppError;
use crate::state::DbState;
use crate::vault;

fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, AppError> {
    app.path().app_data_dir().map_err(|e| AppError::Internal(e.to_string()))
}

#[tauri::command]
pub fn get_dashboard<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
) -> Result<DashboardData, AppError> {
    let dir = app_data_dir(&app)?;
    let today = chrono::Utc::now().date_naive();
    // Read the base-currency label inside the same DbState guard as the DB query. A concurrent
    // `restore_backup` writes the new meta AND swaps the DB file while holding this same mutex
    // (see ADR 0008 point 4 / issue #116), so reading meta under the guard guarantees a
    // consistent (meta, DB) pair - fully pre-restore or fully post-restore, never a stale label
    // paired with freshly-restored rows (or vice versa).
    state.with(|conn| {
        let base_currency = vault::read_meta(&dir).map(|m| m.settings).unwrap_or_default().base_currency;
        crate::db::dashboard::dashboard(conn, &base_currency, today)
    })
}
