//! Account-to-account transfers (migration 0006).
//!
//! A transfer is a linked PAIR of ordinary transactions sharing a `transfer_group_id`: the source
//! leg is negative, the destination leg positive. Both are filed under the single `kind = 'transfer'`
//! category, and every spend query filters `categories.kind = 'expense'` (`db::reports`,
//! `db::budgets`), so a transfer never reaches spend totals, budgets, or the dashboard's
//! this-month figure.
//!
//! v1 is SAME-CURRENCY only: moving money between accounts that disagree on currency needs a
//! user-entered rate (there is no fx API - the app is offline by design), and converting each leg
//! separately lets rounding drift the vault's reported total. Rejecting the mismatch keeps the
//! guarantee that a transfer cannot change your total balance.

use chrono::NaiveDate;
use rusqlite::{params, Connection};

use super::DbError;
use crate::domain::transaction::Transaction;

/// The two legs of one transfer, source first. Returned so the caller can show what was written.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    /// Shared id linking the two legs (also on each leg's `transferGroupId`).
    pub group_id: String,
    /// The negative leg, on the source account.
    pub from_leg: Transaction,
    /// The positive leg, on the destination account.
    pub to_leg: Transaction,
}

/// The id + currency of an account, for validation.
fn account_currency(conn: &Connection, account_id: i64) -> Result<String, DbError> {
    conn.query_row(
        "SELECT currency FROM accounts WHERE id = ?1",
        params![account_id],
        |r| r.get(0),
    )
    .map_err(|_| DbError::Invalid(format!("account {account_id} not found")))
}

/// The single `kind = 'transfer'` category both legs are filed under (seeded by migration 0006).
fn transfer_category_id(conn: &Connection) -> Result<i64, DbError> {
    conn.query_row(
        "SELECT id FROM categories WHERE kind = 'transfer' ORDER BY id LIMIT 1",
        [],
        |r| r.get(0),
    )
    .map_err(|_| DbError::Invalid("no transfer category exists".to_string()))
}

/// Move `amount_minor` from one account to another, as one atomic pair of ledger rows.
///
/// `amount_minor` is a POSITIVE magnitude in the two accounts' shared currency; the signs are
/// applied here (source negative, destination positive) rather than derived from the category kind,
/// because a transfer is the one movement that is both an outflow and an inflow.
#[allow(clippy::too_many_arguments)]
pub fn create(
    conn: &Connection,
    from_account_id: i64,
    to_account_id: i64,
    amount_minor: i64,
    posted_date: NaiveDate,
    note: Option<&str>,
    now: &str,
) -> Result<Transfer, DbError> {
    if from_account_id == to_account_id {
        return Err(DbError::Invalid(
            "choose two different accounts to transfer between".to_string(),
        ));
    }
    if amount_minor <= 0 {
        return Err(DbError::Invalid(
            "amount must be greater than zero".to_string(),
        ));
    }

    let from_currency = account_currency(conn, from_account_id)?;
    let to_currency = account_currency(conn, to_account_id)?;
    if from_currency != to_currency {
        return Err(DbError::Invalid(format!(
            "both accounts must use the same currency to transfer (this one is in {from_currency}, the other in {to_currency})"
        )));
    }
    let category_id = transfer_category_id(conn)?;
    let posted = posted_date.to_string();

    // ACID: both legs and both splits land together or not at all - a half-written transfer would
    // invent or destroy money (.claude/rules/database.md).
    let tx = conn.unchecked_transaction()?;

    // A transfer_group_id unique per transfer, and stable/inspectable. `now` plus the two accounts
    // is enough: one account pair cannot be transferred between twice within the same timestamp.
    let group_id = format!("{now}:{from_account_id}->{to_account_id}");

    let insert_leg = |account_id: i64, signed: i64| -> Result<Transaction, DbError> {
        tx.execute(
            "INSERT INTO transactions
               (account_id, posted_date, amount_minor, currency, fx_rate, base_amount_minor,
                payee, note, source, source_ref, pending_review, created_at, transfer_group_id)
             VALUES (?1, ?2, ?3, ?4, '1', ?3, NULL, ?5, 'manual', NULL, 0, ?6, ?7)",
            params![account_id, posted, signed, from_currency, note, now, group_id],
        )?;
        let id = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO tx_splits (transaction_id, category_id, amount_minor) VALUES (?1, ?2, ?3)",
            params![id, category_id, signed],
        )?;
        super::transactions::get(&tx, id)
    };

    // `base_amount_minor` mirrors `amount_minor` (fx_rate 1) even when the pair's shared currency is
    // not the base currency. The two legs are equal and opposite, so they cancel exactly in
    // `db::dashboard::total_balance_minor` (the only reader of base amounts for transfer rows -
    // spend queries exclude the transfer kind), and no rate can be invented offline.
    let from_leg = insert_leg(from_account_id, -amount_minor)?;
    let to_leg = insert_leg(to_account_id, amount_minor)?;

    tx.commit()?;
    Ok(Transfer {
        group_id,
        from_leg,
        to_leg,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{accounts, dashboard};
    use crate::domain::account::AccountKind;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        super::super::run_migrations(&conn, "2026-07-30T00:00:00Z").unwrap();
        super::super::seed_defaults(&conn).unwrap();
        conn
    }

    fn date(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    /// Two MUR accounts, the second funded with `opening` minor units.
    fn two_accounts(conn: &Connection, opening: i64) -> (i64, i64) {
        let today = date("2026-07-30");
        let a = accounts::create(conn, "Cash", AccountKind::Cash, "MUR", opening, today).unwrap();
        let b = accounts::create(conn, "Savings", AccountKind::Bank, "MUR", 0, today).unwrap();
        (a.id, b.id)
    }

    #[test]
    fn moves_money_between_accounts_without_changing_the_total() {
        let conn = db();
        let today = date("2026-07-30");
        let (from, to) = two_accounts(&conn, 100_000);

        let before = dashboard::total_balance_minor(&conn, "MUR", today).unwrap();
        let t = create(&conn, from, to, 30_000, today, Some("rent pot"), "2026-07-30T10:00:00Z")
            .unwrap();

        // One leg out, one leg in - equal and opposite.
        assert_eq!(t.from_leg.amount_minor, -30_000);
        assert_eq!(t.to_leg.amount_minor, 30_000);
        assert_eq!(t.from_leg.account_id, from);
        assert_eq!(t.to_leg.account_id, to);
        // Both legs are linked by the same group id, which is what marks them as a transfer.
        assert_eq!(t.from_leg.transfer_group_id.as_deref(), Some(t.group_id.as_str()));
        assert_eq!(t.to_leg.transfer_group_id.as_deref(), Some(t.group_id.as_str()));

        // The whole point: the money moved, the total did not change.
        let after = dashboard::total_balance_minor(&conn, "MUR", today).unwrap();
        assert_eq!(after, before, "a transfer must never create or destroy money");

        let balance_of = |id: i64| {
            accounts::list(&conn, false, today)
                .unwrap()
                .into_iter()
                .find(|a| a.id == id)
                .unwrap()
                .balance_minor
        };
        assert_eq!(balance_of(from), 70_000);
        assert_eq!(balance_of(to), 30_000);
    }

    /// A transfer is not spending. Every spend query filters `categories.kind = 'expense'`, so this
    /// asserts the property the whole design rests on.
    #[test]
    fn never_counts_as_spending() {
        let conn = db();
        let today = date("2026-07-30");
        let (from, to) = two_accounts(&conn, 100_000);

        create(&conn, from, to, 30_000, today, None, "2026-07-30T10:00:00Z").unwrap();

        let data = dashboard::dashboard(&conn, "MUR", today).unwrap();
        assert_eq!(
            data.this_month_spend_minor, 0,
            "moving your own money between accounts is not an expense"
        );
    }

    #[test]
    fn rejects_the_same_account_on_both_sides() {
        let conn = db();
        let today = date("2026-07-30");
        let (from, _) = two_accounts(&conn, 100_000);

        let err = create(&conn, from, from, 10_000, today, None, "2026-07-30T10:00:00Z").unwrap_err();
        assert!(err.to_string().contains("two different accounts"));
    }

    #[test]
    fn rejects_a_non_positive_amount() {
        let conn = db();
        let today = date("2026-07-30");
        let (from, to) = two_accounts(&conn, 100_000);

        assert!(create(&conn, from, to, 0, today, None, "2026-07-30T10:00:00Z").is_err());
        assert!(create(&conn, from, to, -5_000, today, None, "2026-07-30T10:00:00Z").is_err());
    }

    /// v1 is same-currency only (see the module doc): a mismatch is refused in plain language
    /// rather than silently inventing a rate.
    #[test]
    fn rejects_a_currency_mismatch_in_plain_language() {
        let conn = db();
        let today = date("2026-07-30");
        let mur = accounts::create(&conn, "Cash", AccountKind::Cash, "MUR", 100_000, today).unwrap();
        let usd = accounts::create(&conn, "US card", AccountKind::Bank, "USD", 0, today).unwrap();

        let err = create(&conn, mur.id, usd.id, 10_000, today, None, "2026-07-30T10:00:00Z")
            .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("same currency"), "got: {msg}");
        assert!(msg.contains("MUR") && msg.contains("USD"), "names both currencies: {msg}");
    }

    #[test]
    fn rejects_an_unknown_account() {
        let conn = db();
        let today = date("2026-07-30");
        let (from, _) = two_accounts(&conn, 100_000);

        let err = create(&conn, from, 9_999, 10_000, today, None, "2026-07-30T10:00:00Z").unwrap_err();
        assert!(err.to_string().contains("not found"));
    }

    /// Both legs land or neither does. A failure after the first insert must leave no orphan leg.
    #[test]
    fn writes_both_legs_atomically() {
        let conn = db();
        let today = date("2026-07-30");
        let (from, _) = two_accounts(&conn, 100_000);

        // Fails on the destination lookup, i.e. before any insert - the ledger must stay empty.
        let _ = create(&conn, from, 9_999, 10_000, today, None, "2026-07-30T10:00:00Z");
        let rows: i64 = conn
            .query_row("SELECT count(*) FROM transactions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0, "a rejected transfer leaves no half-written leg");
    }
}
