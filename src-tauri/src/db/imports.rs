//! Bank-file import persistence (FR-2.2/2.3/2.4): preview a parsed CSV against the active rule
//! engine + dedup, then commit it as ONE ACID batch. Money stays integer minor units throughout;
//! amounts are the file's SIGNED value (sign from the data, NOT derived from a category kind -
//! the one place imports differ from manual entry - see `docs/adr/0005-csv-import-model.md`).
//! Commands are stateless: both `preview` and `commit` re-parse the file (it is the source of
//! truth) - `commit` additionally honours `skip_rows`, identified by the parsed row's stable
//! 0-based data-row index.

use std::collections::HashSet;

use chrono::NaiveDate;
use rusqlite::{params, Connection};
use serde::Serialize;

use super::DbError;
use crate::import::csv::{self, ColumnMapping, RowError};
use crate::rules::dedup::{is_likely_duplicate, DedupKey};
use crate::rules::engine::{apply_rules_traced, RuleFields};

/// Default dedup window (FR-2.4): flag rows within this many days of an existing/earlier-in-batch
/// row at the same account and exact amount as a possible duplicate.
const DEFAULT_WINDOW_DAYS: i64 = 3;

/// One parsed row annotated for the review screen (mirrors TS `PreviewRow`). `amount_minor` is the
/// file's SIGNED amount.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRow {
    pub row: usize,
    pub posted_date: String,
    pub amount_minor: i64,
    pub currency: String,
    pub payee: Option<String>,
    pub note: Option<String>,
    pub source_ref: Option<String>,
    /// A fired rule's category name, if any (not yet resolved to an id - `commit` does that, so a
    /// preview never depends on a category existing).
    pub suggested_category: Option<String>,
    /// True if this row looks like a duplicate of an existing transaction (or an earlier row in
    /// this same batch). Advisory only - dedup never deletes; the user chooses keep/skip.
    pub duplicate: bool,
}

/// Preview of an import (mirrors TS `ImportPreviewData`). Writes nothing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewData {
    pub rows: Vec<PreviewRow>,
    pub errors: Vec<RowError>,
    pub duplicate_count: i64,
    pub currency: String,
}

/// Result of committing an import (mirrors TS `ImportResultData`).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResultData {
    pub inserted: i64,
    pub skipped: i64,
    pub malformed: i64,
}

/// Bundled arguments for `commit` (kept under clippy's too-many-arguments threshold, mirrors the
/// `TxInput` grouping convention in `db::transactions`).
pub struct CommitInput<'a> {
    pub content: &'a str,
    pub mapping: &'a ColumnMapping,
    pub account_id: i64,
    pub filename: &'a str,
    pub format: &'a str,
    /// 0-based data-row indices the user chose not to import (e.g. a flagged duplicate).
    pub skip_rows: &'a [usize],
    /// Dedup window in days; `None` uses `DEFAULT_WINDOW_DAYS`.
    pub window_days: Option<i64>,
}

fn account_currency(conn: &Connection, account_id: i64) -> Result<String, DbError> {
    conn.query_row("SELECT currency FROM accounts WHERE id = ?1", params![account_id], |r| r.get(0))
        .map_err(|_| DbError::Invalid(format!("account {account_id} not found")))
}

/// `DedupKey`s for every existing transaction in this account. Rows whose stored date does not
/// parse as ISO `yyyy-mm-dd` (should not happen - the DB only ever stores that shape) are skipped
/// defensively rather than panicking.
fn existing_keys(conn: &Connection, account_id: i64) -> Result<Vec<DedupKey>, DbError> {
    let mut stmt =
        conn.prepare("SELECT posted_date, amount_minor FROM transactions WHERE account_id = ?1")?;
    let rows = stmt.query_map(params![account_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    })?;
    let mut keys = Vec::new();
    for row in rows {
        let (date, amount_minor) = row?;
        if let Ok(posted_date) = NaiveDate::parse_from_str(&date, "%Y-%m-%d") {
            keys.push(DedupKey { account_id, amount_minor, posted_date });
        }
    }
    Ok(keys)
}

/// Whether `staged` (already converted to a `DedupKey`, if its date parsed) looks like a duplicate
/// of any existing row or any earlier row already seen in this batch.
fn flag_duplicate(key: Option<&DedupKey>, existing: &[DedupKey], seen: &[DedupKey], window_days: i64) -> bool {
    key.is_some_and(|k| {
        existing.iter().any(|e| is_likely_duplicate(k, e, window_days))
            || seen.iter().any(|e| is_likely_duplicate(k, e, window_days))
    })
}

/// Get the id of the "Uncategorized" expense category, creating it if missing. The caller owns
/// the surrounding transaction (called only from `commit`, inside its ACID batch).
fn ensure_uncategorized(conn: &Connection) -> Result<i64, DbError> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM categories WHERE name = 'Uncategorized' AND kind = 'expense'",
            [],
            |r| r.get(0),
        )
        .ok();
    if let Some(id) = existing {
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO categories (name, parent_id, kind, archived)
         VALUES ('Uncategorized', NULL, 'expense', 0)",
        [],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Resolve a category NAME (from a fired rule) to an existing category id sharing that name,
/// case-insensitively. A rule only sets a label - it never creates a category.
fn category_id_by_name(conn: &Connection, name: &str) -> Result<Option<i64>, DbError> {
    Ok(conn
        .query_row("SELECT id FROM categories WHERE name = ?1 COLLATE NOCASE", params![name], |r| {
            r.get(0)
        })
        .ok())
}

/// Preview a CSV file against `mapping`: parse it, suggest a category per row from the active
/// rules (merchant = payee), and flag likely duplicates against existing rows in this account (and
/// earlier rows in the same batch). Writes nothing.
pub fn preview(
    conn: &Connection,
    content: &str,
    mapping: &ColumnMapping,
    account_id: i64,
    window_days: Option<i64>,
) -> Result<ImportPreviewData, DbError> {
    let currency = account_currency(conn, account_id)?;
    let window_days = window_days.unwrap_or(DEFAULT_WINDOW_DAYS);
    let parsed = csv::parse_rows(content, mapping, &currency);
    let rules = crate::db::rules::active_engine_rules(conn)?;
    let existing = existing_keys(conn, account_id)?;

    let mut rows = Vec::with_capacity(parsed.rows.len());
    let mut seen: Vec<DedupKey> = Vec::new();
    let mut duplicate_count = 0i64;

    for staged in &parsed.rows {
        let tx = &staged.staged;
        let (fields, _) = apply_rules_traced(
            &rules,
            RuleFields { merchant: tx.payee.clone(), ..Default::default() },
        );

        let key = NaiveDate::parse_from_str(&tx.posted_date, "%Y-%m-%d")
            .ok()
            .map(|posted_date| DedupKey { account_id, amount_minor: tx.amount_minor, posted_date });
        let duplicate = flag_duplicate(key.as_ref(), &existing, &seen, window_days);
        if duplicate {
            duplicate_count += 1;
        }
        if let Some(k) = key {
            seen.push(k);
        }

        rows.push(PreviewRow {
            row: staged.row,
            posted_date: tx.posted_date.clone(),
            amount_minor: tx.amount_minor,
            currency: tx.currency.clone(),
            payee: tx.payee.clone(),
            note: tx.note.clone(),
            source_ref: tx.source_ref.clone(),
            suggested_category: fields.category,
            duplicate,
        });
    }

    Ok(ImportPreviewData { rows, errors: parsed.errors, duplicate_count, currency })
}

/// Commit a CSV import as ONE ACID transaction: re-parse the file (deterministic; the file is the
/// source of truth), skip `input.skip_rows`, resolve each remaining row's category (a fired
/// rule's category name if it matches an existing category, else "Uncategorized", created if
/// missing), insert the transaction + exactly one split (the split amount == the parent, so the
/// split-sum invariant holds trivially), flag `pending_review` on rows that look like a
/// duplicate, then record the `imports` audit row. Rolls back on any error (all-or-nothing).
pub fn commit(conn: &Connection, input: CommitInput, now_iso: &str) -> Result<ImportResultData, DbError> {
    let currency = account_currency(conn, input.account_id)?;
    let window_days = input.window_days.unwrap_or(DEFAULT_WINDOW_DAYS);
    let parsed = csv::parse_rows(input.content, input.mapping, &currency);
    let rules = crate::db::rules::active_engine_rules(conn)?;
    let existing = existing_keys(conn, input.account_id)?;
    let skip: HashSet<usize> = input.skip_rows.iter().copied().collect();

    let tx = conn.unchecked_transaction()?;
    let uncategorized = ensure_uncategorized(&tx)?;
    let mut seen: Vec<DedupKey> = Vec::new();
    let mut inserted = 0i64;
    let mut skipped = 0i64;

    for staged in &parsed.rows {
        if skip.contains(&staged.row) {
            skipped += 1;
            continue;
        }
        let row = &staged.staged;
        let (fields, _) = apply_rules_traced(
            &rules,
            RuleFields { merchant: row.payee.clone(), ..Default::default() },
        );
        let category_id = match fields.category.as_deref() {
            Some(name) => category_id_by_name(&tx, name)?.unwrap_or(uncategorized),
            None => uncategorized,
        };

        let key = NaiveDate::parse_from_str(&row.posted_date, "%Y-%m-%d")
            .ok()
            .map(|posted_date| DedupKey { account_id: input.account_id, amount_minor: row.amount_minor, posted_date });
        let duplicate = flag_duplicate(key.as_ref(), &existing, &seen, window_days);
        if let Some(k) = key {
            seen.push(k);
        }

        tx.execute(
            "INSERT INTO transactions
               (account_id, posted_date, amount_minor, currency, fx_rate, base_amount_minor,
                payee, note, source, source_ref, pending_review, created_at)
             VALUES (?1, ?2, ?3, ?4, '1', ?5, ?6, ?7, 'import', ?8, ?9, ?10)",
            params![
                input.account_id,
                row.posted_date,
                row.amount_minor,
                row.currency,
                row.amount_minor, // base_amount_minor at rate 1 (imports carry no fx rate yet)
                row.payee,
                row.note,
                row.source_ref,
                duplicate as i64,
                now_iso,
            ],
        )?;
        let tx_id = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO tx_splits (transaction_id, category_id, amount_minor) VALUES (?1, ?2, ?3)",
            params![tx_id, category_id, row.amount_minor],
        )?;
        inserted += 1;
    }

    tx.execute(
        "INSERT INTO imports (filename, format, imported_at, row_count) VALUES (?1, ?2, ?3, ?4)",
        params![input.filename, input.format, now_iso, inserted],
    )?;
    tx.commit()?;

    Ok(ImportResultData { inserted, skipped, malformed: parsed.errors.len() as i64 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::rules::{self, RuleInput};

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        super::super::run_migrations(&conn, "2026-06-06T00:00:00Z").unwrap();
        super::super::seed_defaults(&conn).unwrap();
        conn
    }

    // Seeded defaults: account id 1 = Cash (MUR); category 1 = Groceries (expense).

    fn mapping() -> ColumnMapping {
        ColumnMapping { date: 0, amount: 2, payee: Some(1), note: None, source_ref: None }
    }

    const CONTENT: &str = "Date,Description,Amount\n\
                            2026-06-01,Winners,-450.00\n\
                            2026-06-02,Salary,20000.00\n";

    #[test]
    fn preview_writes_nothing_and_suggests_categories() {
        let conn = db();
        rules::create(
            &conn,
            RuleInput {
                match_field: "merchant",
                match_op: "contains",
                match_value: "winners",
                set_field: "category",
                set_value: "Groceries",
                active: true,
            },
        )
        .unwrap();

        let data = preview(&conn, CONTENT, &mapping(), 1, None).unwrap();
        assert_eq!(data.rows.len(), 2);
        assert_eq!(data.currency, "MUR");
        assert_eq!(data.rows[0].suggested_category.as_deref(), Some("Groceries"));
        assert_eq!(data.rows[0].amount_minor, -45_000);
        assert!(!data.rows[0].duplicate);

        let count: i64 = conn.query_row("SELECT count(*) FROM transactions", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0, "preview must never write");
    }

    #[test]
    fn commit_inserts_one_split_per_row_and_one_audit_row() {
        let conn = db();
        let now = "2026-06-06T10:00:00Z";
        let result = commit(
            &conn,
            CommitInput {
                content: CONTENT,
                mapping: &mapping(),
                account_id: 1,
                filename: "statement.csv",
                format: "csv",
                skip_rows: &[],
                window_days: None,
            },
            now,
        )
        .unwrap();
        assert_eq!(result.inserted, 2);
        assert_eq!(result.skipped, 0);
        assert_eq!(result.malformed, 0);

        let txs: Vec<(i64, String, i64)> = {
            let mut stmt = conn
                .prepare("SELECT id, source, amount_minor FROM transactions ORDER BY id ASC")
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        };
        assert_eq!(txs.len(), 2);
        assert_eq!(txs[0].1, "import");
        assert_eq!(txs[0].2, -45_000, "the file's sign is preserved as-is");
        assert_eq!(txs[1].2, 2_000_000);

        for (tx_id, _, amount) in &txs {
            let split_amount: i64 = conn
                .query_row(
                    "SELECT amount_minor FROM tx_splits WHERE transaction_id = ?1",
                    params![tx_id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(split_amount, *amount, "one split whose amount == the parent");
        }

        let audit: (String, String, i64) = conn
            .query_row("SELECT filename, format, row_count FROM imports", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(audit, ("statement.csv".to_string(), "csv".to_string(), 2));
    }

    #[test]
    fn commit_falls_back_to_uncategorized_and_is_idempotent_to_create() {
        let conn = db();
        commit(
            &conn,
            CommitInput {
                content: CONTENT,
                mapping: &mapping(),
                account_id: 1,
                filename: "a.csv",
                format: "csv",
                skip_rows: &[],
                window_days: None,
            },
            "2026-06-06T10:00:00Z",
        )
        .unwrap();
        // Second import: "Uncategorized" must not be created twice.
        commit(
            &conn,
            CommitInput {
                content: CONTENT,
                mapping: &mapping(),
                account_id: 1,
                filename: "b.csv",
                format: "csv",
                skip_rows: &[],
                window_days: None,
            },
            "2026-06-06T10:01:00Z",
        )
        .unwrap();

        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM categories WHERE name = 'Uncategorized'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "Uncategorized is created once, then reused");

        let categorised: i64 = conn
            .query_row(
                "SELECT count(*) FROM tx_splits s JOIN categories c ON c.id = s.category_id
                 WHERE c.name = 'Uncategorized'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(categorised, 4, "all 4 rows (2 files x 2 rows) fall back to Uncategorized");
    }

    #[test]
    fn commit_honours_skip_rows_and_counts_malformed() {
        let conn = db();
        let content = "Date,Description,Amount\n\
                        2026-06-01,Winners,-450.00\n\
                        2026-06-02,Salary,20000.00\n\
                        bad-date,Oops,-1.00\n";
        let result = commit(
            &conn,
            CommitInput {
                content,
                mapping: &mapping(),
                account_id: 1,
                filename: "c.csv",
                format: "csv",
                skip_rows: &[1], // skip the Salary row
                window_days: None,
            },
            "2026-06-06T10:00:00Z",
        )
        .unwrap();
        assert_eq!(result.inserted, 1);
        assert_eq!(result.skipped, 1);
        assert_eq!(result.malformed, 1);

        let count: i64 = conn.query_row("SELECT count(*) FROM transactions", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn preview_flags_duplicates_against_existing_and_within_batch() {
        let conn = db();
        // Seed an existing transaction that the first CSV row duplicates (same account, amount,
        // and a date within the default 3-day window).
        commit(
            &conn,
            CommitInput {
                content: "Date,Description,Amount\n2026-06-01,Winners,-450.00\n",
                mapping: &mapping(),
                account_id: 1,
                filename: "seed.csv",
                format: "csv",
                skip_rows: &[],
                window_days: None,
            },
            "2026-06-01T10:00:00Z",
        )
        .unwrap();

        // Batch: row 0 duplicates the existing row; row 1 and row 2 duplicate EACH OTHER
        // (within-batch dedup), row 3 is distinct.
        let content = "Date,Description,Amount\n\
                        2026-06-02,Winners,-450.00\n\
                        2026-06-10,Cafe,-120.00\n\
                        2026-06-11,Cafe,-120.00\n\
                        2026-06-20,Rent,-15000.00\n";
        let data = preview(&conn, content, &mapping(), 1, None).unwrap();
        assert_eq!(data.duplicate_count, 2, "the existing-row dup + the second within-batch dup");
        assert!(data.rows[0].duplicate, "matches the existing seeded row");
        assert!(!data.rows[1].duplicate, "first occurrence is not itself flagged");
        assert!(data.rows[2].duplicate, "second occurrence within the batch is flagged");
        assert!(!data.rows[3].duplicate);
    }

    #[test]
    fn commit_is_one_transaction_rolled_back_on_a_bad_account() {
        let conn = db();
        let err = commit(
            &conn,
            CommitInput {
                content: CONTENT,
                mapping: &mapping(),
                account_id: 999,
                filename: "x.csv",
                format: "csv",
                skip_rows: &[],
                window_days: None,
            },
            "2026-06-06T10:00:00Z",
        );
        assert!(err.is_err());
        let count: i64 = conn.query_row("SELECT count(*) FROM transactions", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }
}
