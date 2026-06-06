//! Transaction queries (FR-1.1). A manual transaction is persisted as the `transactions` row plus
//! a single `tx_splits` row for its category — both inside ONE DB transaction (ACID). Money is
//! stored signed (see `domain::transaction`); `base_amount_minor` is recomputed on every write.
//! The transaction currency is the account's currency and `fx_rate` is "1" for now; the
//! foreign-currency path (a user-entered rate) arrives with FR-1.4.

use rusqlite::{params, Connection};

use super::DbError;
use crate::domain::category::CategoryKind;
use crate::domain::money::{base_amount_minor, parse_minor};
use crate::domain::transaction::{signed_amount, validate_transaction, Transaction, TxSplit};

/// Fields for creating/replacing a manual transaction. `amount` is the user's non-negative
/// major-unit input (e.g. "15.00"); it is parsed to minor units in the account's currency, then
/// signed from the category's kind.
pub struct TxInput<'a> {
    pub account_id: i64,
    pub posted_date: &'a str,
    pub amount: &'a str,
    pub category_id: i64,
    pub payee: Option<&'a str>,
    pub note: Option<&'a str>,
}

const TX_COLUMNS: &str = "id, account_id, posted_date, amount_minor, currency, fx_rate, \
    base_amount_minor, payee, note, source, source_ref, pending_review, created_at";

fn row_to_tx(row: &rusqlite::Row<'_>) -> rusqlite::Result<Transaction> {
    Ok(Transaction {
        id: row.get("id")?,
        account_id: row.get("account_id")?,
        posted_date: row.get("posted_date")?,
        amount_minor: row.get("amount_minor")?,
        currency: row.get("currency")?,
        fx_rate: row.get("fx_rate")?,
        base_amount_minor: row.get("base_amount_minor")?,
        payee: row.get("payee")?,
        note: row.get("note")?,
        source: row.get("source")?,
        source_ref: row.get("source_ref")?,
        pending_review: row.get::<_, i64>("pending_review")? != 0,
        created_at: row.get("created_at")?,
        splits: Vec::new(),
    })
}

fn account_currency(conn: &Connection, account_id: i64) -> Result<String, DbError> {
    conn.query_row("SELECT currency FROM accounts WHERE id = ?1", params![account_id], |r| {
        r.get(0)
    })
    .map_err(|_| DbError::Invalid(format!("account {account_id} not found")))
}

fn category_kind(conn: &Connection, category_id: i64) -> Result<CategoryKind, DbError> {
    let kind_str: String = conn
        .query_row("SELECT kind FROM categories WHERE id = ?1", params![category_id], |r| r.get(0))
        .map_err(|_| DbError::Invalid(format!("category {category_id} not found")))?;
    CategoryKind::parse(&kind_str)
        .ok_or_else(|| DbError::Invalid(format!("category {category_id} has an invalid kind")))
}

fn splits_for(conn: &Connection, tx_id: i64) -> Result<Vec<TxSplit>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.category_id, c.name AS category_name, s.amount_minor
         FROM tx_splits s JOIN categories c ON c.id = s.category_id
         WHERE s.transaction_id = ?1
         ORDER BY s.id ASC",
    )?;
    let rows = stmt.query_map(params![tx_id], |row| {
        Ok(TxSplit {
            id: row.get("id")?,
            category_id: row.get("category_id")?,
            category_name: row.get("category_name")?,
            amount_minor: row.get("amount_minor")?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn get(conn: &Connection, id: i64) -> Result<Transaction, DbError> {
    let sql = format!("SELECT {TX_COLUMNS} FROM transactions WHERE id = ?1");
    let mut tx = conn.query_row(&sql, params![id], row_to_tx)?;
    tx.splits = splits_for(conn, id)?;
    Ok(tx)
}

/// All transactions, newest first (by posted date then insertion order). Each carries its splits.
pub fn list(conn: &Connection) -> Result<Vec<Transaction>, DbError> {
    let sql =
        format!("SELECT {TX_COLUMNS} FROM transactions ORDER BY posted_date DESC, id DESC");
    let mut stmt = conn.prepare(&sql)?;
    let mut txs = stmt.query_map([], row_to_tx)?.collect::<rusqlite::Result<Vec<_>>>()?;
    for tx in &mut txs {
        tx.splits = splits_for(conn, tx.id)?;
    }
    Ok(txs)
}

/// Compute the signed amount + base amount for an input, validating along the way. Shared by
/// create/update so they stay consistent.
fn prepare_amounts(conn: &Connection, input: &TxInput) -> Result<(String, i64, String, i64), DbError> {
    let currency = account_currency(conn, input.account_id)?;
    let magnitude = parse_minor(input.amount, &currency).map_err(|e| DbError::Invalid(e.to_string()))?;
    // Same-currency entry for now (FR-1.4 adds a user-entered rate); base == amount at rate 1.
    let rate = validate_transaction(input.posted_date, magnitude, &currency, "1")
        .map_err(|e| DbError::Invalid(e.to_string()))?;
    let kind = category_kind(conn, input.category_id)?;
    let amount = signed_amount(magnitude, kind);
    let base = base_amount_minor(amount, rate);
    Ok((currency, amount, rate.to_string(), base))
}

fn clean(opt: Option<&str>) -> Option<String> {
    opt.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// Insert a manual transaction + its single category split, atomically.
pub fn create(conn: &Connection, input: TxInput, now_iso: &str) -> Result<Transaction, DbError> {
    let (currency, amount, fx_text, base) = prepare_amounts(conn, &input)?;

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO transactions
           (account_id, posted_date, amount_minor, currency, fx_rate, base_amount_minor,
            payee, note, source, source_ref, pending_review, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'manual', NULL, 0, ?9)",
        params![
            input.account_id,
            input.posted_date.trim(),
            amount,
            currency,
            fx_text,
            base,
            clean(input.payee),
            clean(input.note),
            now_iso,
        ],
    )?;
    let id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO tx_splits (transaction_id, category_id, amount_minor) VALUES (?1, ?2, ?3)",
        params![id, input.category_id, amount],
    )?;
    tx.commit()?;
    get(conn, id)
}

/// Update a manual transaction. Replaces its single split (the multi-split editor is FR-1.2).
/// `source`/`created_at` are preserved. All writes are in one transaction.
pub fn update(conn: &Connection, id: i64, input: TxInput) -> Result<Transaction, DbError> {
    let (currency, amount, fx_text, base) = prepare_amounts(conn, &input)?;

    let tx = conn.unchecked_transaction()?;
    let changed = tx.execute(
        "UPDATE transactions
           SET account_id = ?2, posted_date = ?3, amount_minor = ?4, currency = ?5,
               fx_rate = ?6, base_amount_minor = ?7, payee = ?8, note = ?9
         WHERE id = ?1",
        params![
            id,
            input.account_id,
            input.posted_date.trim(),
            amount,
            currency,
            fx_text,
            base,
            clean(input.payee),
            clean(input.note),
        ],
    )?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("transaction {id} not found")));
    }
    tx.execute("DELETE FROM tx_splits WHERE transaction_id = ?1", params![id])?;
    tx.execute(
        "INSERT INTO tx_splits (transaction_id, category_id, amount_minor) VALUES (?1, ?2, ?3)",
        params![id, input.category_id, amount],
    )?;
    tx.commit()?;
    get(conn, id)
}

/// Delete a transaction; its splits cascade (FK `ON DELETE CASCADE`, foreign_keys ON).
pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    let changed = conn.execute("DELETE FROM transactions WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("transaction {id} not found")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        // Cascade deletes rely on FK enforcement (set on the real encrypted connection).
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        super::super::run_migrations(&conn, "2026-06-06T00:00:00Z").unwrap();
        super::super::seed_defaults(&conn).unwrap();
        conn
    }

    // Seeded defaults: account id 1 = Cash (MUR); category 1 = Groceries (expense), 9 = Salary (income).
    fn input<'a>(amount: &'a str, category_id: i64) -> TxInput<'a> {
        TxInput { account_id: 1, posted_date: "2026-06-06", amount, category_id, payee: None, note: None }
    }

    #[test]
    fn create_signs_by_kind_and_persists_one_split() {
        let conn = db();
        let expense = create(&conn, input("15.00", 1), "2026-06-06T10:00:00Z").unwrap();
        assert_eq!(expense.amount_minor, -1_500, "expense is negative");
        assert_eq!(expense.currency, "MUR");
        assert_eq!(expense.fx_rate, "1");
        assert_eq!(expense.base_amount_minor, -1_500, "base == amount at rate 1");
        assert_eq!(expense.source, "manual");
        assert_eq!(expense.splits.len(), 1);
        assert_eq!(expense.splits[0].amount_minor, -1_500);
        assert_eq!(expense.splits[0].category_name, "Groceries");

        let income = create(&conn, input("2000", 9), "2026-06-06T10:00:00Z").unwrap();
        assert_eq!(income.amount_minor, 200_000, "income is positive");
    }

    #[test]
    fn list_is_newest_first_with_splits() {
        let conn = db();
        let mut older = input("10.00", 1);
        older.posted_date = "2026-06-01";
        create(&conn, older, "2026-06-01T10:00:00Z").unwrap();
        let mut newer = input("20.00", 1);
        newer.posted_date = "2026-06-05";
        create(&conn, newer, "2026-06-05T10:00:00Z").unwrap();

        let all = list(&conn).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].posted_date, "2026-06-05");
        assert!(all.iter().all(|t| t.splits.len() == 1));
    }

    #[test]
    fn update_changes_fields_and_split() {
        let conn = db();
        let t = create(&conn, input("15.00", 1), "2026-06-06T10:00:00Z").unwrap();
        let mut edit = input("25.00", 9); // now income, different amount
        edit.payee = Some("Employer");
        let updated = update(&conn, t.id, edit).unwrap();
        assert_eq!(updated.amount_minor, 2_500);
        assert_eq!(updated.payee.as_deref(), Some("Employer"));
        assert_eq!(updated.splits.len(), 1);
        assert_eq!(updated.splits[0].category_name, "Salary");
    }

    #[test]
    fn delete_cascades_to_splits() {
        let conn = db();
        let t = create(&conn, input("15.00", 1), "2026-06-06T10:00:00Z").unwrap();
        delete(&conn, t.id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
        let split_count: i64 = conn
            .query_row("SELECT count(*) FROM tx_splits WHERE transaction_id = ?1", params![t.id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(split_count, 0, "splits cascade-deleted");
    }

    #[test]
    fn rejects_unknown_refs_and_bad_amounts() {
        let conn = db();
        let mut bad_account = input("15.00", 1);
        bad_account.account_id = 999;
        assert!(create(&conn, bad_account, "2026-06-06T10:00:00Z").is_err());

        assert!(create(&conn, input("15.00", 999), "2026-06-06T10:00:00Z").is_err());
        assert!(create(&conn, input("0", 1), "2026-06-06T10:00:00Z").is_err());
        assert!(create(&conn, input("1.005", 1), "2026-06-06T10:00:00Z").is_err());
        assert!(update(&conn, 4242, input("15.00", 1)).is_err());
    }
}
