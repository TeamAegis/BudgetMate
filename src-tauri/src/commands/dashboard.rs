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
    let base_currency = vault::read_meta(&dir).map(|m| m.settings).unwrap_or_default().base_currency;
    let today = chrono::Utc::now().date_naive();
    state.with(|conn| crate::db::dashboard::dashboard(conn, &base_currency, today))
}
