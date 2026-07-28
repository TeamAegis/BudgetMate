//! Allowance commands (FR-3.4) - thin wrappers over `db::allowances`, using the managed `DbState`.
//! `target` is the user's major-unit input (e.g. "1500.00"); Rust parses it to integer minor units.
//! The base (reporting) currency is read from vault settings (not the DB) INSIDE the same `DbState`
//! guard as the query/write, mirroring `commands::dashboard::get_dashboard`: a concurrent
//! `restore_backup` swaps meta and the DB file together while holding this same mutex (see ADR 0008
//! point 4 / issue #116), so reading meta under the guard guarantees a consistent (meta, DB) pair -
//! never a stale label paired with freshly-restored rows or vice versa. No money math in TypeScript.

use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::db::allowances::{self, AllowanceSummary};
use crate::domain::allowance::Allowance;
use crate::domain::money::parse_minor;
use crate::error::AppError;
use crate::state::DbState;
use crate::vault;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAllowance {
    pub name: String,
    /// Non-negative major-unit target, e.g. "1500.00". Rust parses -> minor units.
    pub target: String,
    /// Must equal the vault's base currency (allowances are base-currency only).
    pub currency: String,
    /// `"recurring"` or `"one_time"`.
    pub kind: String,
    /// `"weekly"` / `"monthly"`; required for `"recurring"`, omitted for `"one_time"`.
    pub period: Option<String>,
    /// ISO weekday (Mon=1..Sun=7); required for `"weekly"`, omitted otherwise.
    pub week_start: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAllowance {
    pub id: i64,
    pub name: String,
    pub target: String,
    pub active: bool,
}

fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Read the base-currency label from the given app-data dir. Callers MUST invoke this from inside
/// the `state.with(...)` closure (see the module doc comment) so the read is guarded by the same
/// `DbState` mutex a concurrent `restore_backup` holds while swapping meta + the DB file.
fn base_currency_guarded(dir: &std::path::Path) -> String {
    vault::read_meta(dir).map(|m| m.settings).unwrap_or_default().base_currency
}

#[tauri::command]
pub fn list_allowances<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
) -> Result<AllowanceSummary, AppError> {
    let dir = app_data_dir(&app)?;
    let today = chrono::Utc::now().date_naive();
    state.with(|c| {
        let base_currency = base_currency_guarded(&dir);
        allowances::summary(c, &base_currency, today)
    })
}

/// Alias for the same aggregate, named for the read a screen does after a mutating call (mirrors
/// `list_allowances`; both return `AllowanceSummary`).
#[tauri::command]
pub fn get_allowance_summary<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
) -> Result<AllowanceSummary, AppError> {
    let dir = app_data_dir(&app)?;
    let today = chrono::Utc::now().date_naive();
    state.with(|c| {
        let base_currency = base_currency_guarded(&dir);
        allowances::summary(c, &base_currency, today)
    })
}

#[tauri::command]
pub fn create_allowance<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
    allowance: NewAllowance,
) -> Result<Allowance, AppError> {
    let dir = app_data_dir(&app)?;
    let target_minor = parse_minor(&allowance.target, &allowance.currency)
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let today = chrono::Utc::now().date_naive();
    state.with(|c| {
        let base_currency = base_currency_guarded(&dir);
        allowances::create(
            c,
            &base_currency,
            today,
            &allowance.name,
            &allowance.currency,
            target_minor,
            &allowance.kind,
            allowance.period.as_deref(),
            allowance.week_start,
        )
    })
}

#[tauri::command]
pub fn update_allowance<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
    allowance: UpdateAllowance,
) -> Result<Allowance, AppError> {
    let dir = app_data_dir(&app)?;
    let today = chrono::Utc::now().date_naive();
    state.with(|c| {
        let base_currency = base_currency_guarded(&dir);
        // The stored currency never changes on update (fixed at creation) - `parse_minor` needs it
        // only to know the minor-unit scale, so parse against the base currency it must already be
        // denominated in (validated at creation; a non-base row is never editable here).
        let target_minor = parse_minor(&allowance.target, &base_currency)
            .map_err(|e| crate::db::DbError::Invalid(e.to_string()))?;
        allowances::update(
            c,
            allowance.id,
            &allowance.name,
            target_minor,
            allowance.active,
            &base_currency,
            today,
        )
    })
}

#[tauri::command]
pub fn delete_allowance(state: State<'_, DbState>, id: i64) -> Result<(), AppError> {
    state.with(|c| allowances::delete(c, id))
}
