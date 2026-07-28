//! Allowance (imprest envelope) commands (FR-3.4) - thin wrappers over `db::allowances`, using the
//! managed `DbState` for the DB and the vault-meta sidecar for the base (reporting) currency
//! allowances are denominated in (mirrors `commands::budgets`/`commands::dashboard`). `target` is
//! entered as the user's major-unit input (e.g. "1000.00") - Rust parses it to integer minor units,
//! matching the goal/budget/transaction pattern (no money math in TypeScript). Lazy refresh itself
//! runs on unlock (see `commands::vault::open_and_unlock`), not here.

use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::db::allowances;
use crate::domain::allowance::{Allowance, AllowanceKind, AllowancePeriod, AllowanceSummary};
use crate::domain::money::parse_minor;
use crate::error::AppError;
use crate::state::DbState;
use crate::vault;

/// Fields for `create_allowance` (mirrors TS `NewAllowance`). `target` is a non-negative
/// major-unit string; Rust parses it to minor units in `currency`, which MUST equal the vault's
/// current base currency (ADR 0012 decision 4 - enforced in `domain::allowance::validate_allowance`).
/// `period` is required for `kind: 'recurring'` and must be omitted for `kind: 'one_time'`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAllowance {
    pub name: String,
    pub currency: String,
    pub target: String,
    pub kind: AllowanceKind,
    pub period: Option<AllowancePeriod>,
    /// ISO-8601 weekday name ("monday".."sunday"); defaults to "monday" when omitted.
    pub week_start: Option<String>,
}

/// Fields for `update_allowance` (mirrors TS `UpdateAllowance`). Only name + target are editable in
/// v1 - currency, kind, period, and week_start are fixed at creation (pause/delete + recreate for
/// those). The target edit is delta-applied to the anchor (§8), gated only on an increase.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAllowance {
    pub id: i64,
    pub name: String,
    pub currency: String,
    pub target: String,
}

fn base_currency<R: Runtime>(app: &AppHandle<R>) -> Result<String, AppError> {
    let dir = app.path().app_data_dir().map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(vault::read_meta(&dir)
        .map(|m| m.settings.base_currency)
        .unwrap_or_else(|_| vault::DEFAULT_BASE_CURRENCY.to_string()))
}

/// All allowances (raw rows), active first - for management/edit-form preload. Current balance is
/// NOT on this row (it is derived, never stored - ADR 0012); read it via `get_allowance_summary`.
#[tauri::command]
pub fn list_allowances(state: State<'_, DbState>) -> Result<Vec<Allowance>, AppError> {
    state.with(allowances::list)
}

/// The allowances-screen read model: vault-level Total/Reserved/Available plus every allowance's
/// derived balance/status, as of today.
#[tauri::command]
pub fn get_allowance_summary<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
) -> Result<AllowanceSummary, AppError> {
    let currency = base_currency(&app)?;
    let today = chrono::Utc::now().date_naive();
    state.with(|c| allowances::allowance_summary(c, &currency, today))
}

#[tauri::command]
pub fn create_allowance<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
    allowance: NewAllowance,
) -> Result<Allowance, AppError> {
    let base = base_currency(&app)?;
    let target_minor = parse_minor(&allowance.target, &allowance.currency)
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let today = chrono::Utc::now().date_naive();
    let now_iso = chrono::Utc::now().to_rfc3339();
    let week_start = allowance.week_start.as_deref().unwrap_or("monday");
    state.with(|c| {
        allowances::create(
            c,
            &base,
            today,
            &allowance.name,
            &allowance.currency,
            target_minor,
            allowance.kind,
            allowance.period,
            week_start,
            &now_iso,
        )
    })
}

#[tauri::command]
pub fn update_allowance<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
    allowance: UpdateAllowance,
) -> Result<Allowance, AppError> {
    let base = base_currency(&app)?;
    let target_minor = parse_minor(&allowance.target, &allowance.currency)
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let today = chrono::Utc::now().date_naive();
    state.with(|c| {
        allowances::update(c, &base, today, allowance.id, &allowance.name, &allowance.currency, target_minor)
    })
}

/// Pause (`active: false`, never gated) or resume (`active: true`, re-allocates to target, GATED
/// by Available at resume time - §11/§13.8).
#[tauri::command]
pub fn set_allowance_active<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
    id: i64,
    active: bool,
) -> Result<Allowance, AppError> {
    let base = base_currency(&app)?;
    let today = chrono::Utc::now().date_naive();
    state.with(|c| allowances::set_active(c, &base, today, id, active))
}

/// Hard delete - never gated; tagged historical transactions keep their now-dangling
/// `allowance_id` for reporting (§11).
#[tauri::command]
pub fn delete_allowance(state: State<'_, DbState>, id: i64) -> Result<(), AppError> {
    state.with(|c| allowances::delete(c, id))
}
