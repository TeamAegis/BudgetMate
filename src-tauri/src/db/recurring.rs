//! Recurring rules + lazy, idempotent materialisation (FR-1.3). A rule stores a transaction
//! template (JSON) and a schedule; on app open `materialise_due` inserts any occurrences due up to
//! today inside ONE transaction, advancing the rule's pointers. Re-running is a no-op: each
//! occurrence is keyed by `source_ref = recur:<rule>:<date>` and skipped if it already exists.
//! There is NO background scheduler (battery rule, NFR-Perf3).

use chrono::NaiveDate;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::transactions::{self, SplitInput, TxInput};
use super::DbError;
use crate::domain::recurring::{plan, Schedule};

/// The fixed transaction a rule stamps out (mirrors TS `RecurringTemplate`). A single category for
/// now (one split per occurrence); `amount` is a non-negative major-unit string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringTemplate {
    pub account_id: i64,
    pub category_id: i64,
    pub amount: String,
    pub payee: Option<String>,
    pub note: Option<String>,
}

/// A recurring rule (mirrors TS `RecurringRule`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringRule {
    pub id: i64,
    pub schedule: String,
    pub next_run_date: String,
    pub last_materialised_date: Option<String>,
    pub active: bool,
    pub template: RecurringTemplate,
}

fn parse_date(s: &str) -> Result<NaiveDate, DbError> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map_err(|_| DbError::Invalid(format!("invalid date '{s}' (expected YYYY-MM-DD)")))
}

fn row_to_rule(row: &rusqlite::Row<'_>) -> rusqlite::Result<RecurringRule> {
    let template_json: String = row.get("template_json")?;
    let template: RecurringTemplate = serde_json::from_str(&template_json).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    Ok(RecurringRule {
        id: row.get("id")?,
        schedule: row.get("schedule")?,
        next_run_date: row.get("next_run_date")?,
        last_materialised_date: row.get("last_materialised_date")?,
        active: row.get::<_, i64>("active")? != 0,
        template,
    })
}

const RULE_COLUMNS: &str =
    "id, template_json, schedule, next_run_date, last_materialised_date, active";

fn get(conn: &Connection, id: i64) -> Result<RecurringRule, DbError> {
    let sql = format!("SELECT {RULE_COLUMNS} FROM recurring_rules WHERE id = ?1");
    conn.query_row(&sql, params![id], row_to_rule).map_err(Into::into)
}

pub fn list(conn: &Connection) -> Result<Vec<RecurringRule>, DbError> {
    let sql = format!("SELECT {RULE_COLUMNS} FROM recurring_rules ORDER BY active DESC, id DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_rule)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Validate inputs (schedule + date + that the template parses) before persisting.
fn validate(schedule: &str, next_run_date: &str) -> Result<(), DbError> {
    Schedule::parse(schedule)
        .ok_or_else(|| DbError::Invalid(format!("unknown schedule '{schedule}'")))?;
    parse_date(next_run_date)?;
    Ok(())
}

pub fn create(
    conn: &Connection,
    schedule: &str,
    next_run_date: &str,
    template: &RecurringTemplate,
) -> Result<RecurringRule, DbError> {
    validate(schedule, next_run_date)?;
    let template_json =
        serde_json::to_string(template).map_err(|e| DbError::Invalid(e.to_string()))?;
    conn.execute(
        "INSERT INTO recurring_rules (template_json, schedule, next_run_date, last_materialised_date, active)
         VALUES (?1, ?2, ?3, NULL, 1)",
        params![template_json, schedule, next_run_date.trim()],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(
    conn: &Connection,
    id: i64,
    schedule: &str,
    next_run_date: &str,
    template: &RecurringTemplate,
) -> Result<RecurringRule, DbError> {
    validate(schedule, next_run_date)?;
    let template_json =
        serde_json::to_string(template).map_err(|e| DbError::Invalid(e.to_string()))?;
    let changed = conn.execute(
        "UPDATE recurring_rules SET template_json = ?2, schedule = ?3, next_run_date = ?4 WHERE id = ?1",
        params![id, template_json, schedule, next_run_date.trim()],
    )?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("recurring rule {id} not found")));
    }
    get(conn, id)
}

pub fn set_active(conn: &Connection, id: i64, active: bool) -> Result<RecurringRule, DbError> {
    let changed = conn.execute(
        "UPDATE recurring_rules SET active = ?2 WHERE id = ?1",
        params![id, active as i64],
    )?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("recurring rule {id} not found")));
    }
    get(conn, id)
}

/// Materialise every active rule's occurrences due up to `today`, idempotently, in ONE
/// transaction. Returns how many transactions were inserted. Safe to call on every app open.
pub fn materialise_due(conn: &Connection, today: NaiveDate) -> Result<usize, DbError> {
    let now_iso = chrono::Utc::now().to_rfc3339();
    let tx = conn.unchecked_transaction()?;

    let rules: Vec<RecurringRule> = {
        let sql = format!("SELECT {RULE_COLUMNS} FROM recurring_rules WHERE active = 1");
        let mut stmt = tx.prepare(&sql)?;
        let rows = stmt.query_map([], row_to_rule)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    let mut inserted = 0usize;
    for rule in &rules {
        let schedule = match Schedule::parse(&rule.schedule) {
            Some(s) => s,
            None => continue, // skip malformed rather than abort the whole batch
        };
        let next_run = parse_date(&rule.next_run_date)?;
        let last = rule.last_materialised_date.as_deref().map(parse_date).transpose()?;
        let p = plan(schedule, next_run, last, today);

        for date in &p.due {
            let key = format!("recur:{}:{}", rule.id, date);
            if transactions::exists_with_source_ref(&tx, &key)? {
                continue;
            }
            let posted = date.to_string();
            let amount = &rule.template.amount;
            let input = TxInput {
                account_id: rule.template.account_id,
                posted_date: &posted,
                amount,
                currency: None,
                fx_rate: None,
                splits: &[SplitInput { category_id: rule.template.category_id, amount }],
                payee: rule.template.payee.as_deref(),
                note: rule.template.note.as_deref(),
                allowance_id: None,
            };
            transactions::insert_in_tx(&tx, &input, Some(&key), &now_iso)?;
            inserted += 1;
        }

        let new_last = p.due.last().map(NaiveDate::to_string).or_else(|| rule.last_materialised_date.clone());
        tx.execute(
            "UPDATE recurring_rules SET next_run_date = ?2, last_materialised_date = ?3 WHERE id = ?1",
            params![rule.id, p.next_run.to_string(), new_last],
        )?;
    }

    tx.commit()?;
    Ok(inserted)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        super::super::run_migrations(&conn, "2026-06-06T00:00:00Z").unwrap();
        super::super::seed_defaults(&conn).unwrap();
        conn
    }

    fn template() -> RecurringTemplate {
        // Seeded: account 1 = Cash (MUR), category 4 = Rent (expense).
        RecurringTemplate {
            account_id: 1,
            category_id: 4,
            amount: "1500.00".to_string(),
            payee: Some("Landlord".to_string()),
            note: None,
        }
    }

    fn date(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn tx_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT count(*) FROM transactions", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn materialises_due_and_is_idempotent_same_day() {
        let conn = db();
        create(&conn, "monthly", "2026-01-01", &template()).unwrap();

        // Three monthly occurrences due by mid-March.
        let n = materialise_due(&conn, date("2026-03-15")).unwrap();
        assert_eq!(n, 3);
        assert_eq!(tx_count(&conn), 3);

        // Running again the same day inserts nothing (idempotent).
        let again = materialise_due(&conn, date("2026-03-15")).unwrap();
        assert_eq!(again, 0);
        assert_eq!(tx_count(&conn), 3);

        // Each occurrence is a real, signed transaction (Rent is an expense → negative).
        let sum: i64 = conn
            .query_row("SELECT COALESCE(SUM(amount_minor),0) FROM transactions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(sum, -450_000);
    }

    #[test]
    fn advances_and_continues_next_period() {
        let conn = db();
        create(&conn, "monthly", "2026-01-01", &template()).unwrap();
        materialise_due(&conn, date("2026-01-15")).unwrap(); // Jan only
        assert_eq!(tx_count(&conn), 1);

        // A month later, the next occurrence materialises (no duplicate of January).
        let n = materialise_due(&conn, date("2026-02-10")).unwrap();
        assert_eq!(n, 1);
        assert_eq!(tx_count(&conn), 2);
    }

    #[test]
    fn inactive_rules_do_not_materialise() {
        let conn = db();
        let rule = create(&conn, "daily", "2026-01-01", &template()).unwrap();
        set_active(&conn, rule.id, false).unwrap();
        let n = materialise_due(&conn, date("2026-01-10")).unwrap();
        assert_eq!(n, 0);
        assert_eq!(tx_count(&conn), 0);
    }

    #[test]
    fn crud_roundtrip() {
        let conn = db();
        let r = create(&conn, "weekly", "2026-06-01", &template()).unwrap();
        assert_eq!(r.schedule, "weekly");
        assert!(r.active);
        assert_eq!(r.template.payee.as_deref(), Some("Landlord"));

        let off = set_active(&conn, r.id, false).unwrap();
        assert!(!off.active);
        assert_eq!(list(&conn).unwrap().len(), 1);

        assert!(create(&conn, "yearly", "2026-06-01", &template()).is_err());
    }
}
