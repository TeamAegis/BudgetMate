//! Rule-engine commands (FR-2.3) - thin wrappers over `db::rules`. The evaluation core lives in
//! `rules::engine`; these manage persistence + expose an inspectable preview ("which rule fired").

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::rules::{self, ImportRule, RuleInput};
use crate::error::AppError;
use crate::rules::engine::RuleFields;
use crate::state::DbState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewRule {
    pub match_field: String,
    pub match_op: String,
    pub match_value: String,
    pub set_field: String,
    pub set_value: String,
    pub active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRule {
    pub id: i64,
    pub match_field: String,
    pub match_op: String,
    pub match_value: String,
    pub set_field: String,
    pub set_value: String,
    pub active: bool,
}

fn as_input(r: &NewRule) -> RuleInput<'_> {
    RuleInput {
        match_field: &r.match_field,
        match_op: &r.match_op,
        match_value: &r.match_value,
        set_field: &r.set_field,
        set_value: &r.set_value,
        active: r.active,
    }
}

#[tauri::command]
pub fn list_rules(state: State<'_, DbState>) -> Result<Vec<ImportRule>, AppError> {
    state.with(rules::list)
}

#[tauri::command]
pub fn create_rule(state: State<'_, DbState>, rule: NewRule) -> Result<ImportRule, AppError> {
    state.with(|c| rules::create(c, as_input(&rule)))
}

#[tauri::command]
pub fn update_rule(state: State<'_, DbState>, rule: UpdateRule) -> Result<ImportRule, AppError> {
    let input = RuleInput {
        match_field: &rule.match_field,
        match_op: &rule.match_op,
        match_value: &rule.match_value,
        set_field: &rule.set_field,
        set_value: &rule.set_value,
        active: rule.active,
    };
    state.with(|c| rules::update(c, rule.id, input))
}

#[tauri::command]
pub fn set_rule_active(
    state: State<'_, DbState>,
    id: i64,
    active: bool,
) -> Result<ImportRule, AppError> {
    state.with(|c| rules::set_active(c, id, active))
}

#[tauri::command]
pub fn delete_rule(state: State<'_, DbState>, id: i64) -> Result<(), AppError> {
    state.with(|c| rules::delete(c, id))
}

#[tauri::command]
pub fn reorder_rules(state: State<'_, DbState>, ids: Vec<i64>) -> Result<Vec<ImportRule>, AppError> {
    state.with(|c| rules::reorder(c, &ids))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewInput {
    pub merchant: Option<String>,
    pub category: Option<String>,
    pub account: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedRule {
    pub ordinal: i64,
    pub set_field: String,
    pub set_value: String,
}

/// The result of running the active rules over sample fields: the resulting values plus the trace
/// of which rules fired (in order) so the user can see exactly what happened.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RulePreview {
    pub merchant: Option<String>,
    pub category: Option<String>,
    pub account: Option<String>,
    pub applied: Vec<AppliedRule>,
}

#[tauri::command]
pub fn preview_rules(state: State<'_, DbState>, input: PreviewInput) -> Result<RulePreview, AppError> {
    state.with(|c| {
        let (fields, applied) = rules::apply(
            c,
            RuleFields { merchant: input.merchant, category: input.category, account: input.account },
        )?;
        Ok(RulePreview {
            merchant: fields.merchant,
            category: fields.category,
            account: fields.account,
            applied: applied
                .into_iter()
                .map(|a| AppliedRule { ordinal: a.ordinal, set_field: a.set_field, set_value: a.set_value })
                .collect(),
        })
    })
}
