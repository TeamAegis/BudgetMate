//! Account commands - thin wrappers over `db::accounts`, using the managed `DbState`.

use serde::Deserialize;
use tauri::State;

use crate::db::accounts;
use crate::domain::account::{Account, AccountKind};
use crate::error::AppError;
use crate::state::DbState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAccount {
    pub name: String,
    pub account_type: AccountKind,
    pub currency: String,
    pub opening_balance_minor: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAccount {
    pub id: i64,
    pub name: String,
    pub account_type: AccountKind,
    pub currency: String,
    pub opening_balance_minor: i64,
}

#[tauri::command]
pub fn list_accounts(
    state: State<'_, DbState>,
    include_archived: Option<bool>,
) -> Result<Vec<Account>, AppError> {
    // `today` gates the derived per-account balance: a future-dated transaction has not happened
    // yet, so it must not count (same rule as `db::dashboard`).
    let today = chrono::Utc::now().date_naive();
    state.with(|c| accounts::list(c, include_archived.unwrap_or(false), today))
}

#[tauri::command]
pub fn create_account(state: State<'_, DbState>, account: NewAccount) -> Result<Account, AppError> {
    let today = chrono::Utc::now().date_naive();
    state.with(|c| {
        accounts::create(
            c,
            &account.name,
            account.account_type,
            &account.currency,
            account.opening_balance_minor,
            today,
        )
    })
}

#[tauri::command]
pub fn update_account(state: State<'_, DbState>, account: UpdateAccount) -> Result<Account, AppError> {
    let today = chrono::Utc::now().date_naive();
    state.with(|c| {
        accounts::update(
            c,
            account.id,
            &account.name,
            account.account_type,
            &account.currency,
            account.opening_balance_minor,
            today,
        )
    })
}

#[tauri::command]
pub fn archive_account(state: State<'_, DbState>, id: i64) -> Result<(), AppError> {
    state.with(|c| accounts::archive(c, id))
}
