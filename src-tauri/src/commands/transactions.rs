//! Transaction commands (FR-1.1) — thin wrappers over `db::transactions`, using the managed
//! `DbState`. `amount` is the user's major-unit input (parsed to minor units in Rust); the sign is
//! derived from the category kind. No money math happens in TypeScript.

use serde::Deserialize;
use tauri::State;

use crate::db::transactions::{self, TxInput};
use crate::domain::transaction::Transaction;
use crate::state::DbState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTransaction {
    pub account_id: i64,
    pub posted_date: String,
    /// Non-negative major-unit amount as entered (e.g. "15.00"); Rust parses + signs it.
    pub amount: String,
    pub category_id: i64,
    pub payee: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTransaction {
    pub id: i64,
    pub account_id: i64,
    pub posted_date: String,
    pub amount: String,
    pub category_id: i64,
    pub payee: Option<String>,
    pub note: Option<String>,
}

#[tauri::command]
pub fn list_transactions(state: State<'_, DbState>) -> Result<Vec<Transaction>, String> {
    state.with(transactions::list)
}

#[tauri::command]
pub fn create_transaction(
    state: State<'_, DbState>,
    tx: NewTransaction,
) -> Result<Transaction, String> {
    let now = chrono::Utc::now().to_rfc3339();
    state.with(|c| {
        transactions::create(
            c,
            TxInput {
                account_id: tx.account_id,
                posted_date: &tx.posted_date,
                amount: &tx.amount,
                category_id: tx.category_id,
                payee: tx.payee.as_deref(),
                note: tx.note.as_deref(),
            },
            &now,
        )
    })
}

#[tauri::command]
pub fn update_transaction(
    state: State<'_, DbState>,
    tx: UpdateTransaction,
) -> Result<Transaction, String> {
    state.with(|c| {
        transactions::update(
            c,
            tx.id,
            TxInput {
                account_id: tx.account_id,
                posted_date: &tx.posted_date,
                amount: &tx.amount,
                category_id: tx.category_id,
                payee: tx.payee.as_deref(),
                note: tx.note.as_deref(),
            },
        )
    })
}

#[tauri::command]
pub fn delete_transaction(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    state.with(|c| transactions::delete(c, id))
}
