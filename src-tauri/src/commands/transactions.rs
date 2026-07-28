//! Transaction commands (FR-1.1) - thin wrappers over `db::transactions`, using the managed
//! `DbState`. `amount` is the user's major-unit input (parsed to minor units in Rust); the sign is
//! derived from the category kind. No money math happens in TypeScript.

use serde::Deserialize;
use tauri::State;

use crate::db::transactions::{self, SplitInput, TxInput};
use crate::domain::transaction::Transaction;
use crate::error::AppError;
use crate::state::DbState;

/// One category line (mirrors TS `NewSplit`). `amount` is the user's non-negative major-unit input.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSplit {
    pub category_id: i64,
    pub amount: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTransaction {
    pub account_id: i64,
    pub posted_date: String,
    /// Total (non-negative major-unit) amount; the splits must add up to it. Rust parses + signs.
    pub amount: String,
    /// Transaction currency (defaults to the account's when omitted) + rate to base (FR-1.4).
    pub currency: Option<String>,
    pub fx_rate: Option<String>,
    pub splits: Vec<NewSplit>,
    pub payee: Option<String>,
    pub note: Option<String>,
    /// Optional allowance tag (FR-3.4) - the id of an existing allowance to draw down. Tagging
    /// only sets this column; it never mutates the allowance itself (ADR 0012).
    pub allowance_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTransaction {
    pub id: i64,
    pub account_id: i64,
    pub posted_date: String,
    pub amount: String,
    pub currency: Option<String>,
    pub fx_rate: Option<String>,
    pub splits: Vec<NewSplit>,
    pub payee: Option<String>,
    pub note: Option<String>,
    /// Replaces the allowance tag wholesale (like splits) - `null`/omitted clears it.
    pub allowance_id: Option<i64>,
}

fn split_inputs(splits: &[NewSplit]) -> Vec<SplitInput<'_>> {
    splits
        .iter()
        .map(|s| SplitInput { category_id: s.category_id, amount: &s.amount })
        .collect()
}

#[tauri::command]
pub fn list_transactions(state: State<'_, DbState>) -> Result<Vec<Transaction>, AppError> {
    state.with(transactions::list)
}

#[tauri::command]
pub fn create_transaction(
    state: State<'_, DbState>,
    tx: NewTransaction,
) -> Result<Transaction, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let splits = split_inputs(&tx.splits);
    state.with(|c| {
        transactions::create_tagged(
            c,
            TxInput {
                account_id: tx.account_id,
                posted_date: &tx.posted_date,
                amount: &tx.amount,
                currency: tx.currency.as_deref(),
                fx_rate: tx.fx_rate.as_deref(),
                splits: &splits,
                payee: tx.payee.as_deref(),
                note: tx.note.as_deref(),
            },
            tx.allowance_id,
            &now,
        )
    })
}

#[tauri::command]
pub fn update_transaction(
    state: State<'_, DbState>,
    tx: UpdateTransaction,
) -> Result<Transaction, AppError> {
    let splits = split_inputs(&tx.splits);
    state.with(|c| {
        transactions::update_tagged(
            c,
            tx.id,
            TxInput {
                account_id: tx.account_id,
                posted_date: &tx.posted_date,
                amount: &tx.amount,
                currency: tx.currency.as_deref(),
                fx_rate: tx.fx_rate.as_deref(),
                splits: &splits,
                payee: tx.payee.as_deref(),
                note: tx.note.as_deref(),
            },
            tx.allowance_id,
        )
    })
}

#[tauri::command]
pub fn delete_transaction(state: State<'_, DbState>, id: i64) -> Result<(), AppError> {
    state.with(|c| transactions::delete(c, id))
}
