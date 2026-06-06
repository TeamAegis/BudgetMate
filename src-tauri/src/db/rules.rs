//! Persistence + management for the if-then rule engine (FR-2.3). Rules live in `import_rules`,
//! ordered by `ordinal` and evaluated top-down by `rules::engine`. The same rules apply at import
//! and on manual entry; everything is inspectable (no hidden ML).

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::DbError;
use crate::rules::engine::{self, Applied, MatchOp, Rule, RuleFields, RULE_FIELDS};

/// A persisted rule (mirrors TS `ImportRule`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRule {
    pub id: i64,
    pub ordinal: i64,
    pub match_field: String,
    pub match_op: MatchOp,
    pub match_value: String,
    pub set_field: String,
    pub set_value: String,
    pub active: bool,
}

/// User-supplied rule fields (no id/ordinal — those are assigned/managed by the store).
pub struct RuleInput<'a> {
    pub match_field: &'a str,
    pub match_op: &'a str,
    pub match_value: &'a str,
    pub set_field: &'a str,
    pub set_value: &'a str,
    pub active: bool,
}

fn validate(input: &RuleInput) -> Result<MatchOp, DbError> {
    let op = MatchOp::parse(input.match_op)
        .ok_or_else(|| DbError::Invalid(format!("unknown match operator '{}'", input.match_op)))?;
    if !RULE_FIELDS.contains(&input.match_field) {
        return Err(DbError::Invalid(format!("unknown match field '{}'", input.match_field)));
    }
    if !RULE_FIELDS.contains(&input.set_field) {
        return Err(DbError::Invalid(format!("unknown set field '{}'", input.set_field)));
    }
    if input.match_value.trim().is_empty() || input.set_value.trim().is_empty() {
        return Err(DbError::Invalid("match and set values must not be empty".to_string()));
    }
    Ok(op)
}

fn row_to_rule(row: &rusqlite::Row<'_>) -> rusqlite::Result<ImportRule> {
    let op_str: String = row.get("match_op")?;
    Ok(ImportRule {
        id: row.get("id")?,
        ordinal: row.get("ordinal")?,
        match_field: row.get("match_field")?,
        match_op: MatchOp::parse(&op_str).unwrap_or(MatchOp::Contains),
        match_value: row.get("match_value")?,
        set_field: row.get("set_field")?,
        set_value: row.get("set_value")?,
        active: row.get::<_, i64>("active")? != 0,
    })
}

const COLUMNS: &str =
    "id, ordinal, match_field, match_op, match_value, set_field, set_value, active";

fn get(conn: &Connection, id: i64) -> Result<ImportRule, DbError> {
    let sql = format!("SELECT {COLUMNS} FROM import_rules WHERE id = ?1");
    conn.query_row(&sql, params![id], row_to_rule).map_err(Into::into)
}

pub fn list(conn: &Connection) -> Result<Vec<ImportRule>, DbError> {
    let sql = format!("SELECT {COLUMNS} FROM import_rules ORDER BY ordinal ASC, id ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_rule)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn create(conn: &Connection, input: RuleInput) -> Result<ImportRule, DbError> {
    let op = validate(&input)?;
    let next: i64 =
        conn.query_row("SELECT COALESCE(MAX(ordinal), 0) + 1 FROM import_rules", [], |r| r.get(0))?;
    conn.execute(
        "INSERT INTO import_rules
           (ordinal, match_field, match_op, match_value, set_field, set_value, active)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            next,
            input.match_field,
            op.as_str(),
            input.match_value.trim(),
            input.set_field,
            input.set_value.trim(),
            input.active as i64,
        ],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: RuleInput) -> Result<ImportRule, DbError> {
    let op = validate(&input)?;
    let changed = conn.execute(
        "UPDATE import_rules
           SET match_field = ?2, match_op = ?3, match_value = ?4, set_field = ?5,
               set_value = ?6, active = ?7
         WHERE id = ?1",
        params![
            id,
            input.match_field,
            op.as_str(),
            input.match_value.trim(),
            input.set_field,
            input.set_value.trim(),
            input.active as i64,
        ],
    )?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("rule {id} not found")));
    }
    get(conn, id)
}

pub fn set_active(conn: &Connection, id: i64, active: bool) -> Result<ImportRule, DbError> {
    let changed =
        conn.execute("UPDATE import_rules SET active = ?2 WHERE id = ?1", params![id, active as i64])?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("rule {id} not found")));
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    let changed = conn.execute("DELETE FROM import_rules WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("rule {id} not found")));
    }
    Ok(())
}

/// Reassign ordinals to match the given id order (1-based), in one transaction. Precedence is the
/// list order: a later rule can override an earlier one.
pub fn reorder(conn: &Connection, ordered_ids: &[i64]) -> Result<Vec<ImportRule>, DbError> {
    let tx = conn.unchecked_transaction()?;
    for (i, id) in ordered_ids.iter().enumerate() {
        let changed = tx.execute(
            "UPDATE import_rules SET ordinal = ?2 WHERE id = ?1",
            params![id, (i as i64) + 1],
        )?;
        if changed == 0 {
            return Err(DbError::Invalid(format!("rule {id} not found")));
        }
    }
    tx.commit()?;
    list(conn)
}

fn to_engine(rule: &ImportRule) -> Rule {
    Rule {
        ordinal: rule.ordinal,
        match_field: rule.match_field.clone(),
        match_op: rule.match_op,
        match_value: rule.match_value.clone(),
        set_field: rule.set_field.clone(),
        set_value: rule.set_value.clone(),
        active: rule.active,
    }
}

/// Load the active rules as engine rules (used to apply during import / manual entry).
pub fn active_engine_rules(conn: &Connection) -> Result<Vec<Rule>, DbError> {
    Ok(list(conn)?.iter().filter(|r| r.active).map(to_engine).collect())
}

/// Apply the active rules to a set of input fields, returning the resulting fields and the trace of
/// which rules fired (the "why"). Used by the preview and the manual-entry suggestion.
pub fn apply(conn: &Connection, fields: RuleFields) -> Result<(RuleFields, Vec<Applied>), DbError> {
    Ok(engine::apply_rules_traced(&active_engine_rules(conn)?, fields))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        super::super::run_migrations(&conn, "2026-06-06T00:00:00Z").unwrap();
        conn
    }

    fn input<'a>(mv: &'a str, sv: &'a str) -> RuleInput<'a> {
        RuleInput {
            match_field: "merchant",
            match_op: "contains",
            match_value: mv,
            set_field: "category",
            set_value: sv,
            active: true,
        }
    }

    #[test]
    fn crud_assigns_ordinals_and_lists_in_order() {
        let conn = db();
        let a = create(&conn, input("uber", "Transport")).unwrap();
        let b = create(&conn, input("coffee", "Cafe")).unwrap();
        assert_eq!(a.ordinal, 1);
        assert_eq!(b.ordinal, 2);
        assert_eq!(list(&conn).unwrap().len(), 2);

        let edited = update(&conn, a.id, input("uber", "Rideshare")).unwrap();
        assert_eq!(edited.set_value, "Rideshare");

        delete(&conn, b.id).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn reorder_changes_precedence() {
        let conn = db();
        // Two rules that both match "Coffee Shop"; whichever is later (higher ordinal) wins.
        let a = create(&conn, input("shop", "General")).unwrap();
        let b = create(&conn, input("coffee", "Cafe")).unwrap();

        let (fields, _) = apply(
            &conn,
            RuleFields { merchant: Some("Coffee Shop".into()), ..Default::default() },
        )
        .unwrap();
        assert_eq!(fields.category.as_deref(), Some("Cafe"), "b (later) wins initially");

        // Put `a` last → it now overrides.
        reorder(&conn, &[b.id, a.id]).unwrap();
        let (fields, applied) = apply(
            &conn,
            RuleFields { merchant: Some("Coffee Shop".into()), ..Default::default() },
        )
        .unwrap();
        assert_eq!(fields.category.as_deref(), Some("General"));
        assert_eq!(applied.last().unwrap().set_value, "General");
    }

    #[test]
    fn inactive_rules_do_not_apply() {
        let conn = db();
        let r = create(&conn, input("uber", "Transport")).unwrap();
        set_active(&conn, r.id, false).unwrap();
        let (fields, applied) =
            apply(&conn, RuleFields { merchant: Some("UBER".into()), ..Default::default() }).unwrap();
        assert!(fields.category.is_none());
        assert!(applied.is_empty());
    }

    #[test]
    fn rejects_unknown_fields_or_ops() {
        let conn = db();
        let mut bad = input("x", "y");
        bad.match_field = "phase_of_moon";
        assert!(create(&conn, bad).is_err());

        let mut bad_op = input("x", "y");
        bad_op.match_op = "regex";
        assert!(create(&conn, bad_op).is_err());
    }
}
