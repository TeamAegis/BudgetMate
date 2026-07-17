//! Analytics command (FR-3.3) - thin wrapper: resolve the period to a date range, read the base
//! (reporting) currency from vault settings (not the DB), delegate to `db::reports::report`, and
//! return the `ReportData` DTO. One command covers both charts (spend-by-category, spend-over-time)
//! plus the total, so the command surface stays small (category filter options reuse the existing
//! `list_categories` command).

use tauri::{AppHandle, Manager, Runtime, State};

use crate::domain::report::{resolve_period, ReportData, ReportPeriod};
use crate::error::AppError;
use crate::state::DbState;
use crate::vault;

fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, AppError> {
    app.path().app_data_dir().map_err(|e| AppError::Internal(e.to_string()))
}

#[tauri::command]
pub fn get_report<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
    period: ReportPeriod,
    category_id: Option<i64>,
) -> Result<ReportData, AppError> {
    let dir = app_data_dir(&app)?;
    let base_currency = vault::read_meta(&dir).map(|m| m.settings).unwrap_or_default().base_currency;
    let today = chrono::Utc::now().date_naive();
    let bounds = resolve_period(period, today);
    state.with(|conn| crate::db::reports::report(conn, period, bounds, category_id, &base_currency))
}
