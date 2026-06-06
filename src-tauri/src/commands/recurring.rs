//! Recurring-rule commands (FR-1.3) — thin wrappers over `db::recurring`. Materialisation itself
//! runs lazily on unlock (see `commands::vault`), not here.

use serde::Deserialize;
use tauri::State;

use crate::db::recurring::{self, RecurringRule, RecurringTemplate};
use crate::state::DbState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewRecurringRule {
    pub schedule: String,
    pub next_run_date: String,
    pub template: RecurringTemplate,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRecurringRule {
    pub id: i64,
    pub schedule: String,
    pub next_run_date: String,
    pub template: RecurringTemplate,
}

#[tauri::command]
pub fn list_recurring_rules(state: State<'_, DbState>) -> Result<Vec<RecurringRule>, String> {
    state.with(recurring::list)
}

#[tauri::command]
pub fn create_recurring_rule(
    state: State<'_, DbState>,
    rule: NewRecurringRule,
) -> Result<RecurringRule, String> {
    state.with(|c| recurring::create(c, &rule.schedule, &rule.next_run_date, &rule.template))
}

#[tauri::command]
pub fn update_recurring_rule(
    state: State<'_, DbState>,
    rule: UpdateRecurringRule,
) -> Result<RecurringRule, String> {
    state.with(|c| recurring::update(c, rule.id, &rule.schedule, &rule.next_run_date, &rule.template))
}

#[tauri::command]
pub fn set_recurring_active(
    state: State<'_, DbState>,
    id: i64,
    active: bool,
) -> Result<RecurringRule, String> {
    state.with(|c| recurring::set_active(c, id, active))
}
