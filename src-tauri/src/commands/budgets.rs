//! Envelope-budget commands (FR-3.1) - thin wrappers over `db::budgets`, using the managed
//! `DbState` for the DB and the vault-meta sidecar for the base (reporting) currency budgets are
//! expressed in (budgets have no per-row currency of their own). Caps are entered as the user's
//! major-unit input (e.g. "100.00") - Rust parses to integer minor units, matching the
//! goal/transaction pattern (no money math in TypeScript). "Now" -> the current calendar month's
//! date bounds is computed here (`chrono`) and handed to the pure `domain::budget::month_bounds` +
//! the `db::budgets::list_envelopes` query.

use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::db::budgets;
use crate::domain::budget::{month_bounds, Budget, EnvelopeSummary, MONTHLY_PERIOD};
use crate::domain::money::parse_minor;
use crate::error::AppError;
use crate::state::DbState;
use crate::vault;

/// NOTE on field naming: the cap is accepted as a major-unit STRING (`cap`, e.g. "100.00"), not a
/// pre-computed minor-unit integer - mirroring `NewGoal.target`/`NewTransaction.amount`. Sending a
/// minor-unit integer from TypeScript would require the frontend to do the major->minor
/// conversion itself, which is money math in TS (forbidden - CLAUDE.md / .claude/rules/frontend.md).
/// Rust remains the only place that parses/scales money.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewBudget {
    pub category_id: i64,
    pub period: String,
    /// Non-negative major-unit cap, e.g. "100.00", in the vault's base currency.
    pub cap: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBudget {
    pub id: i64,
    /// Category and period are not editable in v1 - delete and recreate instead.
    pub cap: String,
}

fn base_currency<R: Runtime>(app: &AppHandle<R>) -> Result<String, AppError> {
    let dir = app.path().app_data_dir().map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(vault::read_meta(&dir)
        .map(|m| m.settings.base_currency)
        .unwrap_or_else(|_| vault::DEFAULT_BASE_CURRENCY.to_string()))
}

/// The budgets-screen read model for the CURRENT month: every budgeted category's cap, spend
/// (aggregated from expense splits in base currency), and status.
#[tauri::command]
pub fn list_envelopes<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
) -> Result<Vec<EnvelopeSummary>, AppError> {
    let currency = base_currency(&app)?;
    let (start, end) = month_bounds(chrono::Utc::now().date_naive());
    state.with(|c| budgets::list_envelopes(c, &start, &end, &currency))
}

#[tauri::command]
pub fn get_budget(state: State<'_, DbState>, id: i64) -> Result<Budget, AppError> {
    state.with(|c| budgets::get(c, id))
}

#[tauri::command]
pub fn create_budget<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
    budget: NewBudget,
) -> Result<Budget, AppError> {
    if budget.period != MONTHLY_PERIOD {
        return Err(AppError::Validation("only monthly budgets are supported".to_string()));
    }
    let currency = base_currency(&app)?;
    let cap_minor =
        parse_minor(&budget.cap, &currency).map_err(|e| AppError::Validation(e.to_string()))?;
    state.with(|c| budgets::create(c, budget.category_id, cap_minor))
}

#[tauri::command]
pub fn update_budget<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
    budget: UpdateBudget,
) -> Result<Budget, AppError> {
    let currency = base_currency(&app)?;
    let cap_minor =
        parse_minor(&budget.cap, &currency).map_err(|e| AppError::Validation(e.to_string()))?;
    state.with(|c| budgets::update(c, budget.id, cap_minor))
}

#[tauri::command]
pub fn delete_budget(state: State<'_, DbState>, id: i64) -> Result<(), AppError> {
    state.with(|c| budgets::delete(c, id))
}
