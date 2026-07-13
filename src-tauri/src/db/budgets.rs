//! Envelope-budget queries (FR-3.1). One budget row per (category, period); `period` is always
//! `'monthly'` in v1. `list_envelopes` is the budgets-screen read model: for every budgeted
//! category it aggregates that category's expense splits within the caller-supplied period
//! bounds, converts each split to base currency exactly like `transactions.base_amount_minor`, and
//! classifies the result against the cap. The date bounds and "now" are computed by the caller
//! (`commands::budgets`) so this stays a pure function of its inputs and testable without a clock.

use rust_decimal::Decimal;
use rusqlite::{params, Connection};
use std::str::FromStr;

use super::DbError;
use crate::domain::budget::{
    envelope_status, spend_from_splits, validate_cap, Budget, EnvelopeSummary, MONTHLY_PERIOD,
};
use crate::domain::category::CategoryKind;

fn row_to_budget(row: &rusqlite::Row<'_>) -> rusqlite::Result<Budget> {
    Ok(Budget {
        id: row.get("id")?,
        category_id: row.get("category_id")?,
        period: row.get("period")?,
        cap_minor: row.get("cap_minor")?,
    })
}

pub fn get(conn: &Connection, id: i64) -> Result<Budget, DbError> {
    conn.query_row(
        "SELECT id, category_id, period, cap_minor FROM budgets WHERE id = ?1",
        params![id],
        row_to_budget,
    )
    .map_err(Into::into)
}

fn category_kind(conn: &Connection, category_id: i64) -> Result<CategoryKind, DbError> {
    let kind_str: String = conn
        .query_row("SELECT kind FROM categories WHERE id = ?1", params![category_id], |r| r.get(0))
        .map_err(|_| DbError::Invalid(format!("category {category_id} not found")))?;
    CategoryKind::parse(&kind_str)
        .ok_or_else(|| DbError::Invalid(format!("category {category_id} has an invalid kind")))
}

/// One cap per (category, period) - checked here (clear message) and enforced at the DB layer by
/// `idx_budgets_category_period` (migration 0004) as the last line of defense.
fn has_budget(conn: &Connection, category_id: i64, period: &str, exclude_id: Option<i64>) -> Result<bool, DbError> {
    let n: i64 = conn.query_row(
        "SELECT count(*) FROM budgets WHERE category_id = ?1 AND period = ?2 AND id != ?3",
        params![category_id, period, exclude_id.unwrap_or(0)],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// Create a monthly cap for a category. The category must be expense-kind (income/transfer have
/// no spend to cap) and must not already have a budget for this period.
pub fn create(conn: &Connection, category_id: i64, cap_minor: i64) -> Result<Budget, DbError> {
    validate_cap(cap_minor).map_err(|e| DbError::Invalid(e.to_string()))?;
    if category_kind(conn, category_id)? != CategoryKind::Expense {
        return Err(DbError::Invalid("only expense categories can have a budget".into()));
    }
    if has_budget(conn, category_id, MONTHLY_PERIOD, None)? {
        return Err(DbError::Invalid("this category already has a budget for this period".into()));
    }
    conn.execute(
        "INSERT INTO budgets (category_id, period, cap_minor) VALUES (?1, ?2, ?3)",
        params![category_id, MONTHLY_PERIOD, cap_minor],
    )?;
    get(conn, conn.last_insert_rowid())
}

/// Update a budget's cap. Category and period are not editable in v1 (delete + recreate instead).
pub fn update(conn: &Connection, id: i64, cap_minor: i64) -> Result<Budget, DbError> {
    validate_cap(cap_minor).map_err(|e| DbError::Invalid(e.to_string()))?;
    let changed =
        conn.execute("UPDATE budgets SET cap_minor = ?2 WHERE id = ?1", params![id, cap_minor])?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("budget {id} not found")));
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    let changed = conn.execute("DELETE FROM budgets WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("budget {id} not found")));
    }
    Ok(())
}

/// Sum one category's expense splits (base currency) posted within `[start_date, end_date]`
/// (inclusive, ISO `yyyy-mm-dd` strings). Only `categories.kind = 'expense'` splits count -
/// income/transfer splits never contribute to spend. Splits whose parent transaction is flagged
/// `pending_review` (dedup, FR-2.4) are excluded too: a probable duplicate awaiting the user's
/// confirmation must never inflate envelope spend. Nothing sets that flag yet (dedup wiring is
/// still ahead), so this filter is currently inert but keeps the read model forward-correct.
fn spend_for_category(
    conn: &Connection,
    category_id: i64,
    start_date: &str,
    end_date: &str,
) -> Result<i64, DbError> {
    let sql = "SELECT s.amount_minor, t.fx_rate
               FROM tx_splits s
               JOIN transactions t ON t.id = s.transaction_id
               JOIN categories c ON c.id = s.category_id
               WHERE s.category_id = ?1
                 AND c.kind = 'expense'
                 AND t.pending_review = 0
                 AND t.posted_date >= ?2
                 AND t.posted_date <= ?3";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map(params![category_id, start_date, end_date], |row| {
            let amount_minor: i64 = row.get("amount_minor")?;
            let fx_rate: String = row.get("fx_rate")?;
            Ok((amount_minor, fx_rate))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let splits: Vec<(i64, Decimal)> = rows
        .into_iter()
        .map(|(amount_minor, fx_rate)| {
            // Malformed fx_rate text should never happen (Rust always writes a valid Decimal
            // string), but fall back to identity rather than fail the whole envelope screen.
            (amount_minor, Decimal::from_str(&fx_rate).unwrap_or(Decimal::ONE))
        })
        .collect();
    Ok(spend_from_splits(&splits))
}

/// The budgets-screen read model: every budgeted category's cap, spend, and status for the period
/// bounded by `[start_date, end_date]` (inclusive). Only categories that have a budget appear.
pub fn list_envelopes(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
    base_currency: &str,
) -> Result<Vec<EnvelopeSummary>, DbError> {
    let sql = "SELECT b.id, b.category_id, c.name AS category_name, b.period, b.cap_minor
               FROM budgets b
               JOIN categories c ON c.id = b.category_id
               WHERE b.period = ?1
               ORDER BY c.name COLLATE NOCASE ASC";
    let mut stmt = conn.prepare(sql)?;
    struct Row {
        id: i64,
        category_id: i64,
        category_name: String,
        period: String,
        cap_minor: i64,
    }
    let rows = stmt
        .query_map(params![MONTHLY_PERIOD], |row| {
            Ok(Row {
                id: row.get("id")?,
                category_id: row.get("category_id")?,
                category_name: row.get("category_name")?,
                period: row.get("period")?,
                cap_minor: row.get("cap_minor")?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let spent_minor = spend_for_category(conn, row.category_id, start_date, end_date)?;
        out.push(EnvelopeSummary {
            id: row.id,
            category_id: row.category_id,
            category_name: row.category_name,
            period: row.period,
            cap_minor: row.cap_minor,
            spent_minor,
            remaining_minor: row.cap_minor - spent_minor,
            currency: base_currency.to_string(),
            status: envelope_status(row.cap_minor, spent_minor),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::transactions::{create as create_tx, SplitInput, TxInput};

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        super::super::run_migrations(&conn, "2026-06-05T00:00:00Z").unwrap();
        super::super::seed_defaults(&conn).unwrap();
        conn
    }

    // Seeded: account 1 = Cash (MUR); category 1 = Groceries (expense), 2 = Dining (expense),
    // 9 = Salary (income).

    /// Insert a single-category expense; returns the new transaction id (used by tests that need
    /// to target one row, e.g. flipping `pending_review`).
    fn expense(conn: &Connection, category_id: i64, amount: &str, date: &str) -> i64 {
        create_tx(
            conn,
            TxInput {
                account_id: 1,
                posted_date: date,
                amount,
                currency: None,
                fx_rate: None,
                splits: &[SplitInput { category_id, amount }],
                payee: None,
                note: None,
            },
            "2026-06-06T10:00:00Z",
        )
        .unwrap()
        .id
    }

    #[test]
    fn create_update_delete_roundtrip() {
        let conn = db();
        let b = create(&conn, 1, 10_000).unwrap();
        assert_eq!(b.period, "monthly");
        assert_eq!(b.cap_minor, 10_000);

        let updated = update(&conn, b.id, 20_000).unwrap();
        assert_eq!(updated.cap_minor, 20_000);

        delete(&conn, b.id).unwrap();
        assert!(get(&conn, b.id).is_err());
    }

    #[test]
    fn rejects_non_positive_cap_and_duplicate_and_non_expense() {
        let conn = db();
        assert!(create(&conn, 1, 0).is_err());
        assert!(create(&conn, 1, -1).is_err());
        create(&conn, 1, 10_000).unwrap();
        assert!(create(&conn, 1, 5_000).is_err(), "one budget per category+period");
        assert!(create(&conn, 9, 10_000).is_err(), "income category cannot be budgeted");
    }

    #[test]
    fn unique_index_is_the_last_line_of_defense() {
        let conn = db();
        conn.execute(
            "INSERT INTO budgets (category_id, period, cap_minor) VALUES (1, 'monthly', 100)",
            [],
        )
        .unwrap();
        let err = conn.execute(
            "INSERT INTO budgets (category_id, period, cap_minor) VALUES (1, 'monthly', 200)",
            [],
        );
        assert!(err.is_err(), "DB unique index rejects a second cap for the same category+period");
    }

    #[test]
    fn list_envelopes_aggregates_splits_and_classifies_status() {
        let conn = db();
        create(&conn, 1, 10_000).unwrap(); // Groceries cap 100.00
        expense(&conn, 1, "50.00", "2026-06-10");
        expense(&conn, 1, "30.00", "2026-06-15");

        let envelopes = list_envelopes(&conn, "2026-06-01", "2026-06-30", "MUR").unwrap();
        assert_eq!(envelopes.len(), 1);
        let e = &envelopes[0];
        assert_eq!(e.category_name, "Groceries");
        assert_eq!(e.spent_minor, 8_000, "spend is positive despite negative expense rows");
        assert_eq!(e.remaining_minor, 2_000);
        assert_eq!(e.currency, "MUR");
        assert_eq!(e.status, crate::domain::budget::EnvelopeStatus::Approaching);
    }

    #[test]
    fn list_envelopes_excludes_transactions_outside_the_period() {
        let conn = db();
        create(&conn, 1, 10_000).unwrap();
        expense(&conn, 1, "20.00", "2026-05-31"); // just before the window
        expense(&conn, 1, "10.00", "2026-06-01"); // exactly on the start boundary
        expense(&conn, 1, "10.00", "2026-06-30"); // exactly on the end boundary
        expense(&conn, 1, "20.00", "2026-07-01"); // just after the window

        let envelopes = list_envelopes(&conn, "2026-06-01", "2026-06-30", "MUR").unwrap();
        assert_eq!(envelopes[0].spent_minor, 2_000, "only the two in-window transactions count");
    }

    #[test]
    fn list_envelopes_only_counts_expense_splits() {
        let conn = db();
        create(&conn, 1, 10_000).unwrap();
        expense(&conn, 1, "40.00", "2026-06-10");
        // An income transaction never contributes even though it posts in-window.
        create_tx(
            &conn,
            TxInput {
                account_id: 1,
                posted_date: "2026-06-12",
                amount: "500.00",
                currency: None,
                fx_rate: None,
                splits: &[SplitInput { category_id: 9, amount: "500.00" }],
                payee: None,
                note: None,
            },
            "2026-06-06T10:00:00Z",
        )
        .unwrap();

        let envelopes = list_envelopes(&conn, "2026-06-01", "2026-06-30", "MUR").unwrap();
        assert_eq!(envelopes[0].spent_minor, 4_000);
    }

    #[test]
    fn list_envelopes_converts_split_currency_using_the_transactions_fx_rate() {
        let conn = db();
        create(&conn, 1, 1_000_000).unwrap();
        create_tx(
            &conn,
            TxInput {
                account_id: 1,
                posted_date: "2026-06-10",
                amount: "100.00",
                currency: Some("USD"),
                fx_rate: Some("45.5"),
                splits: &[SplitInput { category_id: 1, amount: "100.00" }],
                payee: None,
                note: None,
            },
            "2026-06-06T10:00:00Z",
        )
        .unwrap();

        let envelopes = list_envelopes(&conn, "2026-06-01", "2026-06-30", "MUR").unwrap();
        // 100.00 USD @ 45.5 -> base 4550.00 MUR -> 455000 minor.
        assert_eq!(envelopes[0].spent_minor, 455_000);
    }

    #[test]
    fn spend_never_counts_a_pending_review_transaction() {
        let conn = db();
        create(&conn, 1, 10_000).unwrap(); // Groceries cap 100.00
        expense(&conn, 1, "20.00", "2026-06-10"); // pending_review sibling (not counted)
        let counted = expense(&conn, 1, "30.00", "2026-06-12"); // counted normally

        conn.execute(
            "UPDATE transactions SET pending_review = 1 WHERE id != ?1",
            params![counted],
        )
        .unwrap();

        let envelopes = list_envelopes(&conn, "2026-06-01", "2026-06-30", "MUR").unwrap();
        assert_eq!(
            envelopes[0].spent_minor, 3_000,
            "only the non-pending_review transaction counts toward envelope spend"
        );
    }

    /// `spend_from_splits` converts each split to base currency independently and rounds each
    /// conversion on its own, whereas `transactions.base_amount_minor` rounds ONCE over the whole
    /// parent amount. For a transaction that is BOTH split across categories AND in a foreign
    /// currency, those two roundings can legitimately disagree by a minor unit or two - this is
    /// accepted v1 behaviour (see the doc-comment on `domain::budget::spend_from_splits`), not a
    /// bug. This test locks in a concrete case so the gap can't silently change size.
    #[test]
    fn split_plus_fx_transaction_spend_can_differ_from_the_parents_own_base_amount_by_rounding() {
        let conn = db();
        create(&conn, 1, 1_000_000).unwrap(); // Groceries
        create(&conn, 2, 1_000_000).unwrap(); // Dining

        // $2.00 USD @ 0.005, split evenly $1.00 / $1.00 across the two categories.
        // Each split converts as round(100 * 0.005) = round(0.5) = 0 (round-half-to-even), so the
        // two envelopes' combined spend is 0 - but the parent's own base_amount_minor rounds the
        // whole $2.00 at once: round(200 * 0.005) = round(1.0) = 1. The per-split view (0) and the
        // parent's single-rounded view (1) disagree by one minor unit.
        let tx = create_tx(
            &conn,
            TxInput {
                account_id: 1,
                posted_date: "2026-06-10",
                amount: "2.00",
                currency: Some("USD"),
                fx_rate: Some("0.005"),
                splits: &[
                    SplitInput { category_id: 1, amount: "1.00" },
                    SplitInput { category_id: 2, amount: "1.00" },
                ],
                payee: None,
                note: None,
            },
            "2026-06-06T10:00:00Z",
        )
        .unwrap();
        assert_eq!(tx.base_amount_minor, -1, "parent rounds the whole amount once");

        let envelopes = list_envelopes(&conn, "2026-06-01", "2026-06-30", "MUR").unwrap();
        let groceries = envelopes.iter().find(|e| e.category_name == "Groceries").unwrap();
        let dining = envelopes.iter().find(|e| e.category_name == "Dining").unwrap();
        assert_eq!(groceries.spent_minor, 0);
        assert_eq!(dining.spent_minor, 0);
        assert_ne!(
            groceries.spent_minor + dining.spent_minor,
            tx.base_amount_minor.unsigned_abs() as i64,
            "documented rounding-allocation gap between per-split spend and the parent's own base_amount_minor"
        );
    }

    #[test]
    fn list_envelopes_only_includes_budgeted_categories() {
        let conn = db();
        // Dining (category 2) has no budget: it must not appear even with spend.
        expense(&conn, 2, "15.00", "2026-06-10");
        assert!(list_envelopes(&conn, "2026-06-01", "2026-06-30", "MUR").unwrap().is_empty());
    }
}
