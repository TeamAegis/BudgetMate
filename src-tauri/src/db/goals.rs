//! Savings-goal queries (FR-3.2). Goals can be hard-deleted (unlike accounts/categories, which
//! archive) — they carry no ledger history. `completed` is derived on read, never stored. The
//! `goals` table is from migration 0001 (+ `currency` from 0003); `current_minor` is the saved-so-far.

use rusqlite::{params, Connection};

use super::DbError;
use crate::domain::goal::{is_completed, validate_goal, Goal};

fn row_to_goal(row: &rusqlite::Row<'_>) -> rusqlite::Result<Goal> {
    let target_minor: i64 = row.get("target_minor")?;
    let current_minor: i64 = row.get("current_minor")?;
    Ok(Goal {
        id: row.get("id")?,
        name: row.get("name")?,
        target_minor,
        current_minor,
        currency: row.get("currency")?,
        target_date: row.get("target_date")?,
        completed: is_completed(target_minor, current_minor),
    })
}

pub fn list(conn: &Connection) -> Result<Vec<Goal>, DbError> {
    // Active goals first, then completed; alphabetical within each group.
    let sql = "SELECT id, name, target_minor, current_minor, currency, target_date
               FROM goals
               ORDER BY (current_minor >= target_minor) ASC, name COLLATE NOCASE ASC";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], row_to_goal)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn get(conn: &Connection, id: i64) -> Result<Goal, DbError> {
    conn.query_row(
        "SELECT id, name, target_minor, current_minor, currency, target_date FROM goals WHERE id = ?1",
        params![id],
        row_to_goal,
    )
    .map_err(Into::into)
}

pub fn create(
    conn: &Connection,
    name: &str,
    target_minor: i64,
    current_minor: i64,
    currency: &str,
    target_date: Option<&str>,
) -> Result<Goal, DbError> {
    validate_goal(name, target_minor, current_minor, currency)
        .map_err(|e| DbError::Invalid(e.to_string()))?;
    conn.execute(
        "INSERT INTO goals (name, target_minor, current_minor, currency, target_date)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![name.trim(), target_minor, current_minor, currency, target_date],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(
    conn: &Connection,
    id: i64,
    name: &str,
    target_minor: i64,
    current_minor: i64,
    currency: &str,
    target_date: Option<&str>,
) -> Result<Goal, DbError> {
    validate_goal(name, target_minor, current_minor, currency)
        .map_err(|e| DbError::Invalid(e.to_string()))?;
    let changed = conn.execute(
        "UPDATE goals SET name = ?2, target_minor = ?3, current_minor = ?4, currency = ?5, target_date = ?6
         WHERE id = ?1",
        params![id, name.trim(), target_minor, current_minor, currency, target_date],
    )?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("goal {id} not found")));
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    let changed = conn.execute("DELETE FROM goals WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("goal {id} not found")));
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
    fn create_list_update_delete() {
        let conn = db();
        let g = create(&conn, "Vacation", 1_000_000, 500_000, "MUR", Some("2026-12-01")).unwrap();
        assert_eq!(g.name, "Vacation");
        assert!(!g.completed);

        // Reaching the target flips `completed` (derived).
        let done = update(&conn, g.id, "Vacation", 1_000_000, 1_000_000, "MUR", None).unwrap();
        assert!(done.completed);
        assert_eq!(done.target_date, None);

        delete(&conn, g.id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn list_orders_active_before_completed() {
        let conn = db();
        create(&conn, "Done", 100, 100, "MUR", None).unwrap();
        create(&conn, "Active", 100, 10, "MUR", None).unwrap();
        let goals = list(&conn).unwrap();
        assert_eq!(goals[0].name, "Active");
        assert_eq!(goals[1].name, "Done");
    }

    #[test]
    fn rejects_invalid() {
        let conn = db();
        assert!(create(&conn, "", 100, 0, "MUR", None).is_err());
        assert!(create(&conn, "X", 0, 0, "MUR", None).is_err());
        assert!(update(&conn, 999, "X", 100, 0, "MUR", None).is_err());
    }
}
