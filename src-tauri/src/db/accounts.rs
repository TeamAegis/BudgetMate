//! Account queries. Archiving sets a flag (never deletes); archived rows are excluded from
//! pickers but retained for history.

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
    })
}

pub fn list(conn: &Connection, include_archived: bool) -> Result<Vec<Account>, DbError> {
    let sql = "SELECT id, name, type, currency, opening_balance_minor, archived
               FROM accounts
               WHERE (?1 = 1 OR archived = 0)
               ORDER BY archived ASC, name COLLATE NOCASE ASC";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![include_archived as i64], row_to_account)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn get(conn: &Connection, id: i64) -> Result<Account, DbError> {
    conn.query_row(
        "SELECT id, name, type, currency, opening_balance_minor, archived FROM accounts WHERE id = ?1",
        params![id],
        row_to_account,
    )
    .map_err(Into::into)
}

pub fn create(
    conn: &Connection,
    name: &str,
    kind: AccountKind,
    currency: &str,
    opening_balance_minor: i64,
) -> Result<Account, DbError> {
    validate_account(name, currency).map_err(|e| DbError::Invalid(e.to_string()))?;
    conn.execute(
        "INSERT INTO accounts (name, type, currency, opening_balance_minor, archived)
         VALUES (?1, ?2, ?3, ?4, 0)",
        params![name.trim(), kind.as_str(), currency, opening_balance_minor],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(
    conn: &Connection,
    id: i64,
    name: &str,
    kind: AccountKind,
    currency: &str,
    opening_balance_minor: i64,
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
    get(conn, id)
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
        super::super::run_migrations(&conn, "2026-06-05T00:00:00Z").unwrap();
        conn
    }

    #[test]
    fn create_list_update_archive() {
        let conn = db();
        let a = create(&conn, "Savings", AccountKind::Bank, "MUR", 10_000).unwrap();
        assert_eq!(a.name, "Savings");
        assert_eq!(a.opening_balance_minor, 10_000);

        let updated = update(&conn, a.id, "Main Savings", AccountKind::Bank, "USD", 500).unwrap();
        assert_eq!(updated.name, "Main Savings");
        assert_eq!(updated.currency, "USD");

        archive(&conn, a.id).unwrap();
        assert!(list(&conn, false).unwrap().iter().all(|x| x.id != a.id));
        assert!(list(&conn, true).unwrap().iter().any(|x| x.id == a.id && x.archived));
    }

    #[test]
    fn rejects_invalid() {
        let conn = db();
        assert!(create(&conn, "", AccountKind::Cash, "MUR", 0).is_err());
        assert!(create(&conn, "X", AccountKind::Cash, "mur", 0).is_err());
    }
}
