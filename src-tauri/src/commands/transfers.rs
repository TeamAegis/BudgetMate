//! Transfer commands - thin wrappers over `db::transfers`, using the managed `DbState`.

use serde::Deserialize;
use tauri::State;

use crate::db::transfers::{self, Transfer};
use crate::domain::money::parse_minor;
use crate::error::AppError;
use crate::state::DbState;

/// Input for `create_transfer`. Same-currency only in v1 - the currency is taken from the accounts
/// themselves (and a mismatch is rejected in Rust), so the caller never supplies one.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTransfer {
    pub from_account_id: i64,
    pub to_account_id: i64,
    /// Positive major-unit amount, e.g. "5000.00". Rust parses -> minor units (never TS math).
    pub amount: String,
    /// ISO `yyyy-mm-dd`.
    pub posted_date: String,
    pub note: Option<String>,
}

#[tauri::command]
pub fn create_transfer(
    state: State<'_, DbState>,
    transfer: NewTransfer,
) -> Result<Transfer, AppError> {
    let posted_date = chrono::NaiveDate::parse_from_str(&transfer.posted_date, "%Y-%m-%d")
        .map_err(|_| AppError::Validation("date must be yyyy-mm-dd".to_string()))?;
    let now = chrono::Utc::now().to_rfc3339();

    state.with(|c| {
        // The amount is parsed against the SOURCE account's currency, so a currency with a
        // different minor-unit scale (e.g. JPY's zero decimals) is honoured. `db::transfers`
        // re-checks that both accounts agree on the currency before writing either leg.
        let currency: String = c
            .query_row(
                "SELECT currency FROM accounts WHERE id = ?1",
                rusqlite::params![transfer.from_account_id],
                |r| r.get(0),
            )
            .map_err(|_| {
                crate::db::DbError::Invalid(format!(
                    "account {} not found",
                    transfer.from_account_id
                ))
            })?;
        let amount_minor = parse_minor(&transfer.amount, &currency)
            .map_err(|e| crate::db::DbError::Invalid(e.to_string()))?;

        transfers::create(
            c,
            transfer.from_account_id,
            transfer.to_account_id,
            amount_minor,
            posted_date,
            transfer.note.as_deref(),
            &now,
        )
    })
}
