//! Transaction queries (FR-1.1). A manual transaction is persisted as the `transactions` row plus
//! a single `tx_splits` row for its category - both inside ONE DB transaction (ACID). Money is
//! stored signed (see `domain::transaction`); `base_amount_minor` is recomputed on every write.
//! The transaction currency is the account's currency and `fx_rate` is "1" for now; the
//! foreign-currency path (a user-entered rate) arrives with FR-1.4.

use rusqlite::{params, Connection};

use super::DbError;
use crate::domain::category::CategoryKind;
use crate::domain::money::{base_amount_minor, parse_minor};
use crate::domain::transaction::{
    signed_amount, validate_split_set, validate_transaction, Transaction, TxSplit,
};

/// One category line of a manual transaction. `amount` is the user's non-negative major-unit input.
pub struct SplitInput<'a> {
    pub category_id: i64,
    pub amount: &'a str,
}

/// Fields for creating/replacing a manual transaction. `amount` is the total (non-negative
/// major-unit input); `splits` allocate that total across categories (one split = a simple entry,
/// ≥2 = a split transaction). Amounts are parsed to minor units in the transaction `currency` and
/// signed from the (shared) category kind. The split magnitudes must sum to the total.
///
/// `currency` defaults to the account's currency when `None`; `fx_rate` (a decimal string)
/// converts the amount to the base currency and defaults to "1" - together they implement FR-1.4
/// foreign-currency entry. `base_amount_minor = round(amount_minor * fx_rate)`.
pub struct TxInput<'a> {
    pub account_id: i64,
    pub posted_date: &'a str,
    pub amount: &'a str,
    pub currency: Option<&'a str>,
    pub fx_rate: Option<&'a str>,
    pub splits: &'a [SplitInput<'a>],
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

/// Everything needed to persist a transaction + its splits, validated and signed. Shared by
/// create/update so they stay consistent.
struct Prepared {
    currency: String,
    /// Signed parent amount (sum of signed splits).
    amount: i64,
    fx_text: String,
    base: i64,
    /// (category_id, signed amount) per split.
    splits: Vec<(i64, i64)>,
}

/// Parse + validate the total and splits, then sign every amount from the (shared) category kind.
fn prepare(conn: &Connection, input: &TxInput) -> Result<Prepared, DbError> {
    // Transaction currency: caller-supplied (FR-1.4) or the account's by default.
    let currency = match input.currency.map(str::trim).filter(|c| !c.is_empty()) {
        Some(c) => c.to_uppercase(),
        None => account_currency(conn, input.account_id)?,
    };
    let fx_rate = input.fx_rate.map(str::trim).filter(|s| !s.is_empty()).unwrap_or("1");
    let total = parse_minor(input.amount, &currency).map_err(|e| DbError::Invalid(e.to_string()))?;
    // base_amount_minor = round(amount_minor * fx_rate); rate "1" for a same-currency entry.
    let rate = validate_transaction(input.posted_date, total, &currency, fx_rate)
        .map_err(|e| DbError::Invalid(e.to_string()))?;

    let mut magnitudes = Vec::with_capacity(input.splits.len());
    let mut kinds = Vec::with_capacity(input.splits.len());
    for s in input.splits {
        magnitudes.push(parse_minor(s.amount, &currency).map_err(|e| DbError::Invalid(e.to_string()))?);
        kinds.push(category_kind(conn, s.category_id)?);
    }
    validate_split_set(total, &magnitudes, &kinds).map_err(|e| DbError::Invalid(e.to_string()))?;

    // All splits share one kind (validated above), so the whole transaction has one direction.
    let kind = kinds[0];
    let splits = input
        .splits
        .iter()
        .zip(&magnitudes)
        .map(|(s, &m)| (s.category_id, signed_amount(m, kind)))
        .collect::<Vec<_>>();
    let amount = signed_amount(total, kind);
    let base = base_amount_minor(amount, rate);
    Ok(Prepared { currency, amount, fx_text: rate.to_string(), base, splits })
}

fn insert_splits(tx: &Connection, transaction_id: i64, splits: &[(i64, i64)]) -> Result<(), DbError> {
    for (category_id, amount) in splits {
        tx.execute(
            "INSERT INTO tx_splits (transaction_id, category_id, amount_minor) VALUES (?1, ?2, ?3)",
            params![transaction_id, category_id, amount],
        )?;
    }
    Ok(())
}

fn clean(opt: Option<&str>) -> Option<String> {
    opt.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// Insert a manual transaction + its splits on `conn` WITHOUT managing a transaction - the caller
/// owns the surrounding `BEGIN`/`COMMIT`. `source_ref` carries provenance (e.g. a recurring-rule
/// occurrence key); it is `NULL` for a plain manual entry. Returns the new row id.
pub(crate) fn insert_in_tx(
    conn: &Connection,
    input: &TxInput,
    source_ref: Option<&str>,
    now_iso: &str,
) -> Result<i64, DbError> {
    let p = prepare(conn, input)?;
    conn.execute(
        "INSERT INTO transactions
           (account_id, posted_date, amount_minor, currency, fx_rate, base_amount_minor,
            payee, note, source, source_ref, pending_review, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'manual', ?9, 0, ?10)",
        params![
            input.account_id,
            input.posted_date.trim(),
            p.amount,
            p.currency,
            p.fx_text,
            p.base,
            clean(input.payee),
            clean(input.note),
            source_ref,
            now_iso,
        ],
    )?;
    let id = conn.last_insert_rowid();
    insert_splits(conn, id, &p.splits)?;
    Ok(id)
}

/// True if a transaction with this `source_ref` already exists (recurring idempotency key).
pub(crate) fn exists_with_source_ref(conn: &Connection, source_ref: &str) -> Result<bool, DbError> {
    let n: i64 = conn.query_row(
        "SELECT count(*) FROM transactions WHERE source_ref = ?1",
        params![source_ref],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// Insert a manual transaction + its category splits, atomically. The split magnitudes must sum to
/// the total (enforced in `prepare`).
pub fn create(conn: &Connection, input: TxInput, now_iso: &str) -> Result<Transaction, DbError> {
    let tx = conn.unchecked_transaction()?;
    let id = insert_in_tx(&tx, &input, None, now_iso)?;
    tx.commit()?;
    get(conn, id)
}

/// Update a manual transaction, replacing its splits wholesale. `source`/`created_at` are
/// preserved. All writes are in one transaction.
pub fn update(conn: &Connection, id: i64, input: TxInput) -> Result<Transaction, DbError> {
    let p = prepare(conn, &input)?;

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
            p.amount,
            p.currency,
            p.fx_text,
            p.base,
            clean(input.payee),
            clean(input.note),
        ],
    )?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("transaction {id} not found")));
    }
    tx.execute("DELETE FROM tx_splits WHERE transaction_id = ?1", params![id])?;
    insert_splits(&tx, id, &p.splits)?;
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

    /// A single-category transaction: one split for the whole total (the FR-1.1 simple case).
    fn single<'a>(amount: &'a str, category_id: i64) -> TxInput<'a> {
        TxInput {
            account_id: 1,
            posted_date: "2026-06-06",
            amount,
            currency: None,
            fx_rate: None,
            splits: Box::leak(Box::new([SplitInput { category_id, amount }])),
            payee: None,
            note: None,
        }
    }

    #[test]
    fn create_signs_by_kind_and_persists_one_split() {
        let conn = db();
        let expense = create(&conn, single("15.00", 1), "2026-06-06T10:00:00Z").unwrap();
        assert_eq!(expense.amount_minor, -1_500, "expense is negative");
        assert_eq!(expense.currency, "MUR");
        assert_eq!(expense.fx_rate, "1");
        assert_eq!(expense.base_amount_minor, -1_500, "base == amount at rate 1");
        assert_eq!(expense.source, "manual");
        assert_eq!(expense.splits.len(), 1);
        assert_eq!(expense.splits[0].amount_minor, -1_500);
        assert_eq!(expense.splits[0].category_name, "Groceries");

        let income = create(&conn, single("2000", 9), "2026-06-06T10:00:00Z").unwrap();
        assert_eq!(income.amount_minor, 200_000, "income is positive");
    }

    #[test]
    fn create_persists_multiple_splits_summing_to_total() {
        let conn = db();
        // 50.00 total split across Groceries (30) + Dining (20) - both expense (cat 1 and 2).
        let tx = TxInput {
            account_id: 1,
            posted_date: "2026-06-06",
            amount: "50.00",
            currency: None,
            fx_rate: None,
            splits: &[
                SplitInput { category_id: 1, amount: "30.00" },
                SplitInput { category_id: 2, amount: "20.00" },
            ],
            payee: Some("Market"),
            note: None,
        };
        let created = create(&conn, tx, "2026-06-06T10:00:00Z").unwrap();
        assert_eq!(created.amount_minor, -5_000, "parent is the signed sum");
        assert_eq!(created.splits.len(), 2);
        assert_eq!(created.splits.iter().map(|s| s.amount_minor).sum::<i64>(), -5_000);
    }

    #[test]
    fn rejects_splits_that_dont_sum_or_mix_kinds() {
        let conn = db();
        // Magnitudes don't add up to the total.
        let bad_sum = TxInput {
            account_id: 1,
            posted_date: "2026-06-06",
            amount: "50.00",
            currency: None,
            fx_rate: None,
            splits: &[
                SplitInput { category_id: 1, amount: "30.00" },
                SplitInput { category_id: 2, amount: "10.00" },
            ],
            payee: None,
            note: None,
        };
        assert!(create(&conn, bad_sum, "2026-06-06T10:00:00Z").is_err());

        // Mixed kinds (expense + income) in one transaction.
        let mixed = TxInput {
            account_id: 1,
            posted_date: "2026-06-06",
            amount: "50.00",
            currency: None,
            fx_rate: None,
            splits: &[
                SplitInput { category_id: 1, amount: "30.00" }, // Groceries (expense)
                SplitInput { category_id: 9, amount: "20.00" }, // Salary (income)
            ],
            payee: None,
            note: None,
        };
        assert!(create(&conn, mixed, "2026-06-06T10:00:00Z").is_err());
    }

    #[test]
    fn foreign_currency_derives_base_from_rate() {
        let conn = db();
        // 100.00 USD at rate 45.5 → base 455000 minor. Expense (Groceries) → negative.
        let tx = TxInput {
            account_id: 1,
            posted_date: "2026-06-06",
            amount: "100.00",
            currency: Some("USD"),
            fx_rate: Some("45.5"),
            splits: &[SplitInput { category_id: 1, amount: "100.00" }],
            payee: None,
            note: None,
        };
        let created = create(&conn, tx, "2026-06-06T10:00:00Z").unwrap();
        assert_eq!(created.currency, "USD");
        assert_eq!(created.fx_rate, "45.5");
        assert_eq!(created.amount_minor, -10_000);
        assert_eq!(created.base_amount_minor, -455_000);
    }

    #[test]
    fn list_is_newest_first_with_splits() {
        let conn = db();
        let mut older = single("10.00", 1);
        older.posted_date = "2026-06-01";
        create(&conn, older, "2026-06-01T10:00:00Z").unwrap();
        let mut newer = single("20.00", 1);
        newer.posted_date = "2026-06-05";
        create(&conn, newer, "2026-06-05T10:00:00Z").unwrap();

        let all = list(&conn).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].posted_date, "2026-06-05");
        assert!(all.iter().all(|t| t.splits.len() == 1));
    }

    #[test]
    fn update_changes_fields_and_replaces_splits() {
        let conn = db();
        let t = create(&conn, single("15.00", 1), "2026-06-06T10:00:00Z").unwrap();
        let mut edit = single("25.00", 9); // now income, different amount
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
        let t = create(&conn, single("15.00", 1), "2026-06-06T10:00:00Z").unwrap();
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
        let mut bad_account = single("15.00", 1);
        bad_account.account_id = 999;
        assert!(create(&conn, bad_account, "2026-06-06T10:00:00Z").is_err());

        assert!(create(&conn, single("15.00", 999), "2026-06-06T10:00:00Z").is_err());
        assert!(create(&conn, single("0", 1), "2026-06-06T10:00:00Z").is_err());
        assert!(create(&conn, single("1.005", 1), "2026-06-06T10:00:00Z").is_err());
        assert!(update(&conn, 4242, single("15.00", 1)).is_err());
    }
}
