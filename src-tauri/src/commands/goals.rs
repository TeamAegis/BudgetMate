//! Savings-goal commands (FR-3.2) - thin wrappers over `db::goals`, using the managed `DbState`.
//! `target`/`saved` are the user's major-unit input (e.g. "10000.00"); Rust parses them to integer
//! minor units. No money math happens in TypeScript.

use serde::Deserialize;
use tauri::State;

use crate::db::goals;
use crate::domain::goal::Goal;
use crate::domain::money::parse_minor;
use crate::error::AppError;
use crate::state::DbState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewGoal {
    pub name: String,
    /// Non-negative major-unit target, e.g. "10000.00". Rust parses → minor units.
    pub target: String,
    /// Amount saved so far; defaults to "0" when omitted.
    pub current: Option<String>,
    pub currency: String,
    pub target_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGoal {
    pub id: i64,
    pub name: String,
    pub target: String,
    pub current: Option<String>,
    pub currency: String,
    pub target_date: Option<String>,
}

/// Parse a major-unit amount to minor units for the goal currency (error → AppError::Validation).
fn to_minor(amount: &str, currency: &str) -> Result<i64, AppError> {
    parse_minor(amount, currency).map_err(|e| AppError::Validation(e.to_string()))
}

#[tauri::command]
pub fn list_goals(state: State<'_, DbState>) -> Result<Vec<Goal>, AppError> {
    state.with(goals::list)
}

#[tauri::command]
pub fn create_goal(state: State<'_, DbState>, goal: NewGoal) -> Result<Goal, AppError> {
    let target_minor = to_minor(&goal.target, &goal.currency)?;
    let current_minor = to_minor(goal.current.as_deref().unwrap_or("0"), &goal.currency)?;
    state.with(|c| {
        goals::create(
            c,
            &goal.name,
            target_minor,
            current_minor,
            &goal.currency,
            goal.target_date.as_deref(),
        )
    })
}

#[tauri::command]
pub fn update_goal(state: State<'_, DbState>, goal: UpdateGoal) -> Result<Goal, AppError> {
    let target_minor = to_minor(&goal.target, &goal.currency)?;
    let current_minor = to_minor(goal.current.as_deref().unwrap_or("0"), &goal.currency)?;
    state.with(|c| {
        goals::update(
            c,
            goal.id,
            &goal.name,
            target_minor,
            current_minor,
            &goal.currency,
            goal.target_date.as_deref(),
        )
    })
}

#[tauri::command]
pub fn delete_goal(state: State<'_, DbState>, id: i64) -> Result<(), AppError> {
    state.with(|c| goals::delete(c, id))
}
