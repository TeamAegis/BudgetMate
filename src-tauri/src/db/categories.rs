//! Category queries. Tree via `parent_id`; inserts/updates reject parents that would create a
//! cycle. Archiving sets a flag (never deletes).

use rusqlite::{params, Connection};

use super::DbError;
use crate::domain::category::{creates_cycle, validate_name, Category, CategoryKind};

fn row_to_category(row: &rusqlite::Row<'_>) -> rusqlite::Result<Category> {
    let kind_str: String = row.get("kind")?;
    Ok(Category {
        id: row.get("id")?,
        name: row.get("name")?,
        parent_id: row.get("parent_id")?,
        kind: CategoryKind::parse(&kind_str).unwrap_or(CategoryKind::Expense),
        archived: row.get::<_, i64>("archived")? != 0,
    })
}

pub fn list(conn: &Connection, include_archived: bool) -> Result<Vec<Category>, DbError> {
    let sql = "SELECT id, name, parent_id, kind, archived
               FROM categories
               WHERE (?1 = 1 OR archived = 0)
               ORDER BY archived ASC, name COLLATE NOCASE ASC";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![include_archived as i64], row_to_category)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn get(conn: &Connection, id: i64) -> Result<Category, DbError> {
    conn.query_row(
        "SELECT id, name, parent_id, kind, archived FROM categories WHERE id = ?1",
        params![id],
        row_to_category,
    )
    .map_err(Into::into)
}

/// Closure over the DB for cycle detection: returns a node's parent_id.
fn parent_lookup(conn: &Connection) -> impl Fn(i64) -> Option<i64> + '_ {
    move |id: i64| {
        conn.query_row("SELECT parent_id FROM categories WHERE id = ?1", params![id], |r| {
            r.get::<_, Option<i64>>(0)
        })
        .ok()
        .flatten()
    }
}

fn check_parent(conn: &Connection, id: i64, parent_id: Option<i64>) -> Result<(), DbError> {
    if let Some(p) = parent_id {
        if p == id {
            return Err(DbError::Invalid("a category cannot be its own parent".into()));
        }
        // Parent must exist.
        let exists: i64 =
            conn.query_row("SELECT count(*) FROM categories WHERE id = ?1", params![p], |r| {
                r.get(0)
            })?;
        if exists == 0 {
            return Err(DbError::Invalid(format!("parent category {p} not found")));
        }
        if creates_cycle(id, Some(p), &parent_lookup(conn)) {
            return Err(DbError::Invalid(
                "this parent would create a cycle in the category tree".into(),
            ));
        }
    }
    Ok(())
}

pub fn create(
    conn: &Connection,
    name: &str,
    parent_id: Option<i64>,
    kind: CategoryKind,
) -> Result<Category, DbError> {
    validate_name(name).map_err(|e| DbError::Invalid(e.to_string()))?;
    // New row has no id yet; only parent existence/self-parent matter here (id=0 can't cycle).
    check_parent(conn, 0, parent_id)?;
    conn.execute(
        "INSERT INTO categories (name, parent_id, kind, archived) VALUES (?1, ?2, ?3, 0)",
        params![name.trim(), parent_id, kind.as_str()],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(
    conn: &Connection,
    id: i64,
    name: &str,
    parent_id: Option<i64>,
    kind: CategoryKind,
) -> Result<Category, DbError> {
    validate_name(name).map_err(|e| DbError::Invalid(e.to_string()))?;
    check_parent(conn, id, parent_id)?;
    let changed = conn.execute(
        "UPDATE categories SET name = ?2, parent_id = ?3, kind = ?4 WHERE id = ?1",
        params![id, name.trim(), parent_id, kind.as_str()],
    )?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("category {id} not found")));
    }
    get(conn, id)
}

pub fn archive(conn: &Connection, id: i64) -> Result<(), DbError> {
    let changed = conn.execute("UPDATE categories SET archived = 1 WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("category {id} not found")));
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
    fn create_nested_and_reject_cycle() {
        let conn = db();
        let parent = create(&conn, "Food", None, CategoryKind::Expense).unwrap();
        let child = create(&conn, "Groceries", Some(parent.id), CategoryKind::Expense).unwrap();
        assert_eq!(child.parent_id, Some(parent.id));

        // Re-parenting Food under Groceries would cycle → rejected.
        let err = update(&conn, parent.id, "Food", Some(child.id), CategoryKind::Expense);
        assert!(err.is_err());

        // Self-parent rejected.
        assert!(update(&conn, child.id, "Groceries", Some(child.id), CategoryKind::Expense).is_err());
    }

    #[test]
    fn archive_hides_from_default_list() {
        let conn = db();
        let c = create(&conn, "Temp", None, CategoryKind::Expense).unwrap();
        archive(&conn, c.id).unwrap();
        assert!(list(&conn, false).unwrap().iter().all(|x| x.id != c.id));
        assert!(list(&conn, true).unwrap().iter().any(|x| x.id == c.id));
    }
}
