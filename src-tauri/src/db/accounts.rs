//! Account queries. Archiving sets a flag (never deletes); archived rows are excluded from
//! pickers but retained for history.

use chrono::NaiveDate;
use rusqlite::{params, Connection};

use super::DbError;
use crate::domain::account::{validate_account, Account, AccountKind};

fn row_to_account(row: &rusqlite::Row<'_>) -> rusqlite::Result<Account> {
    let type_str: String = row.get("type")?;
    Ok(Account {
        id: row.get("id")?,
        name: row.get("name")?,
        account_type: AccountKind::parse(&type_str).unwrap_or(AccountKind::Other),
        currency: row.get("currency")?,
        opening_balance_minor: row.get("opening_balance_minor")?,
        archived: row.get::<_, i64>("archived")? != 0,
        balance_minor: row.get("balance_minor")?,
    })
}

/// The derived `balance_minor` column: the account's opening balance plus its own confirmed,
/// not-future-dated ledger, summed at the SQL layer.
///
/// Sums `amount_minor` (the transaction's OWN currency), NOT `base_amount_minor`: this figure is
/// displayed in the account's own currency, and a transaction is always recorded in its account's
/// currency (a mismatch is rejected at import - ADR 0011). That is the one deliberate difference
/// from `db::dashboard::total_balance_minor`, which sums base amounts because it reports one
/// vault-wide base-currency total.
///
/// The future-date filter compares ISO `YYYY-MM-DD` strings, which orders identically to the dates
/// themselves, so it needs no per-row parse (the same rule `dashboard` applies in Rust).
const BALANCE_SELECT: &str = "opening_balance_minor + COALESCE((
        SELECT SUM(t.amount_minor) FROM transactions t
        WHERE t.account_id = accounts.id AND t.pending_review = 0 AND t.posted_date <= ?
    ), 0) AS balance_minor";

pub fn list(
    conn: &Connection,
    include_archived: bool,
    today: NaiveDate,
) -> Result<Vec<Account>, DbError> {
    let sql = format!(
        "SELECT id, name, type, currency, opening_balance_minor, archived, {BALANCE_SELECT}
               FROM accounts
               WHERE (?2 = 1 OR archived = 0)
               ORDER BY archived ASC, name COLLATE NOCASE ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        params![today.to_string(), include_archived as i64],
        row_to_account,
    )?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn get(conn: &Connection, id: i64, today: NaiveDate) -> Result<Account, DbError> {
    let sql = format!(
        "SELECT id, name, type, currency, opening_balance_minor, archived, {BALANCE_SELECT}
         FROM accounts WHERE id = ?2"
    );
    conn.query_row(&sql, params![today.to_string(), id], row_to_account)
        .map_err(Into::into)
}

pub fn create(
    conn: &Connection,
    name: &str,
    kind: AccountKind,
    currency: &str,
    opening_balance_minor: i64,
    today: NaiveDate,
) -> Result<Account, DbError> {
    validate_account(name, currency).map_err(|e| DbError::Invalid(e.to_string()))?;
    conn.execute(
        "INSERT INTO accounts (name, type, currency, opening_balance_minor, archived)
         VALUES (?1, ?2, ?3, ?4, 0)",
        params![name.trim(), kind.as_str(), currency, opening_balance_minor],
    )?;
    get(conn, conn.last_insert_rowid(), today)
}

pub fn update(
    conn: &Connection,
    id: i64,
    name: &str,
    kind: AccountKind,
    currency: &str,
    opening_balance_minor: i64,
    today: NaiveDate,
) -> Result<Account, DbError> {
    validate_account(name, currency).map_err(|e| DbError::Invalid(e.to_string()))?;
    let changed = conn.execute(
        "UPDATE accounts SET name = ?2, type = ?3, currency = ?4, opening_balance_minor = ?5
         WHERE id = ?1",
        params![id, name.trim(), kind.as_str(), currency, opening_balance_minor],
    )?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("account {id} not found")));
    }
    get(conn, id, today)
}

pub fn archive(conn: &Connection, id: i64) -> Result<(), DbError> {
    let changed = conn.execute("UPDATE accounts SET archived = 1 WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("account {id} not found")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        super::super::run_migrations(&conn, "2026-06-05T00:00:00Z").unwrap();
        super::super::seed_defaults(&conn).unwrap();
        conn
    }

    fn date(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn create_list_update_archive() {
        let conn = db();
        let today = date("2026-06-05");
        let a = create(&conn, "Savings", AccountKind::Bank, "MUR", 10_000, today).unwrap();
        assert_eq!(a.name, "Savings");
        assert_eq!(a.opening_balance_minor, 10_000);

        let updated = update(&conn, a.id, "Main Savings", AccountKind::Bank, "USD", 500, today).unwrap();
        assert_eq!(updated.name, "Main Savings");
        assert_eq!(updated.currency, "USD");

        archive(&conn, a.id).unwrap();
        assert!(list(&conn, false, today).unwrap().iter().all(|x| x.id != a.id));
        assert!(list(&conn, true, today).unwrap().iter().any(|x| x.id == a.id && x.archived));
    }

    /// The Accounts screen shows `balance_minor`, so it MUST track the account's own ledger rather
    /// than sitting at the opening balance forever (which read as a permanent "Rs 0" for any account
    /// opened at zero - the defect this covers).
    #[test]
    fn balance_tracks_the_accounts_own_confirmed_ledger() {
        let conn = db();
        let today = date("2026-07-30");
        // Seeded: category 1 = Groceries (expense), 9 = Salary (income).
        let a = create(&conn, "Cash", AccountKind::Cash, "MUR", 0, today).unwrap();
        assert_eq!(a.balance_minor, 0, "no ledger yet, so it starts at the opening balance");

        let tx = |amount: &str, category_id: i64, posted_date: &str| {
            crate::db::transactions::create(
                &conn,
                crate::db::transactions::TxInput {
                    account_id: a.id,
                    posted_date,
                    amount,
                    currency: None,
                    fx_rate: None,
                    splits: &[crate::db::transactions::SplitInput { category_id, amount }],
                    payee: None,
                    note: None,
                    allowance_id: None,
                },
                "2026-07-05T00:00:00Z",
            )
            .unwrap()
        };

        tx("30000.00", 9, "2026-07-05"); // income  -> +3_000_000
        tx("200.00", 1, "2026-07-06"); // expense ->    -20_000

        let only = |accs: Vec<Account>| accs.into_iter().find(|x| x.id == a.id).unwrap();
        assert_eq!(only(list(&conn, false, today).unwrap()).balance_minor, 2_980_000);
        // The opening balance itself is untouched - the two are different figures.
        assert_eq!(only(list(&conn, false, today).unwrap()).opening_balance_minor, 0);

        // A future-dated transaction has not happened yet, so it must not count until its date.
        tx("500.00", 1, "2026-08-15");
        assert_eq!(only(list(&conn, false, today).unwrap()).balance_minor, 2_980_000);
        assert_eq!(
            only(list(&conn, false, date("2026-08-15")).unwrap()).balance_minor,
            2_930_000,
            "counted once today reaches its posted date"
        );
    }

    #[test]
    fn rejects_invalid() {
        let conn = db();
        assert!(create(&conn, "", AccountKind::Cash, "MUR", 0, date("2026-06-05")).is_err());
        assert!(create(&conn, "X", AccountKind::Cash, "mur", 0, date("2026-06-05")).is_err());
    }
}
