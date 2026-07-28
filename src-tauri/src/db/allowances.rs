//! Savings-backed allowance queries (FR-3.4, docs/allowances.md). `Total` is NEVER stored - it is
//! `db::dashboard::total_balance_minor` computed as of `today` (ADR 0012); `balance_minor` per
//! allowance IS stored (a set-to-target refresh is not invertible from the ledger alone). All
//! reservation math (the savings gate, the imprest top-up, the refresh schedule) lives in the pure
//! `domain::allowance` module - this file only reads/writes rows and wraps multi-statement writes
//! in ONE transaction (ACID).

use chrono::NaiveDate;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::DbError;
use crate::domain::allowance::{
    apply_target_delta, cadence_of, next_boundary_after, one_time_closed, plan_refresh,
    reserved_of, top_up, validate_allowance, Allowance, TopUp,
};

const ALLOWANCE_COLUMNS: &str = "id, name, currency, target_minor, balance_minor, kind, period, \
    week_start, next_refresh_date, active, created_at";

fn row_to_allowance(row: &rusqlite::Row<'_>) -> rusqlite::Result<Allowance> {
    let target_minor: i64 = row.get("target_minor")?;
    let balance_minor: i64 = row.get("balance_minor")?;
    let kind: String = row.get("kind")?;
    let active = row.get::<_, i64>("active")? != 0;
    Ok(Allowance {
        id: row.get("id")?,
        name: row.get("name")?,
        currency: row.get("currency")?,
        target_minor,
        balance_minor,
        reserved_minor: reserved_of(balance_minor, active),
        overspent: balance_minor < 0,
        underfunded: active && kind == "recurring" && balance_minor < target_minor,
        kind,
        period: row.get("period")?,
        week_start: row.get("week_start")?,
        next_refresh_date: row.get("next_refresh_date")?,
        active,
        created_at: row.get("created_at")?,
    })
}

fn parse_date(s: &str) -> Result<NaiveDate, DbError> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map_err(|_| DbError::Invalid(format!("invalid date '{s}' (expected YYYY-MM-DD)")))
}

fn get(conn: &Connection, id: i64) -> Result<Allowance, DbError> {
    let sql = format!("SELECT {ALLOWANCE_COLUMNS} FROM allowances WHERE id = ?1");
    conn.query_row(&sql, params![id], row_to_allowance)
        .map_err(Into::into)
}

/// Every allowance, active first (mirrors `db::goals::list`'s active-before-completed ordering).
pub fn list(conn: &Connection) -> Result<Vec<Allowance>, DbError> {
    let sql = format!("SELECT {ALLOWANCE_COLUMNS} FROM allowances ORDER BY active DESC, id ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_allowance)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// `Reserved` = `sum(max(0, balance_minor))` over ACTIVE, `base_currency` allowances - computed at
/// the SQL layer (a per-row `max(balance_minor, 0)` scalar call, then aggregated) rather than
/// loading every row into Rust.
fn active_base_reserved_sum(conn: &Connection, base_currency: &str) -> Result<i64, DbError> {
    conn.query_row(
        "SELECT COALESCE(SUM(MAX(balance_minor, 0)), 0) FROM allowances \
         WHERE active = 1 AND currency = ?1",
        params![base_currency],
        |r| r.get(0),
    )
    .map_err(Into::into)
}

/// The full allowance-screen aggregate (list + the three balances + the foreign-currency caveat
/// count). `total_minor` is `db::dashboard::total_balance_minor` as of `today` - NEVER stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowanceSummary {
    pub allowances: Vec<Allowance>,
    pub total_minor: i64,
    pub reserved_minor: i64,
    pub available_minor: i64,
    pub base_currency: String,
    /// Count of ACTIVE allowances in a currency other than `base_currency` (allowances are
    /// base-currency only at creation, §6 - this defends against a future base-currency change
    /// leaving stale rows, and is surfaced as a caveat like `DashboardData.excludedAccounts`).
    pub excluded_allowances: i64,
}

pub fn summary(
    conn: &Connection,
    base_currency: &str,
    today: NaiveDate,
) -> Result<AllowanceSummary, DbError> {
    let allowances = list(conn)?;
    let total_minor = super::dashboard::total_balance_minor(conn, base_currency, today)?;
    let reserved_minor = active_base_reserved_sum(conn, base_currency)?;
    let available_minor = total_minor - reserved_minor;
    let excluded_allowances: i64 = conn.query_row(
        "SELECT count(*) FROM allowances WHERE active = 1 AND currency != ?1",
        params![base_currency],
        |r| r.get(0),
    )?;
    Ok(AllowanceSummary {
        allowances,
        total_minor,
        reserved_minor,
        available_minor,
        base_currency: base_currency.to_string(),
        excluded_allowances,
    })
}

/// Create an allowance, allocating its FULL target as the initial balance - gated all-or-nothing
/// against Available (docs/allowances.md §9.1: "the initial allocation happens at creation").
#[allow(clippy::too_many_arguments)]
pub fn create(
    conn: &Connection,
    base_currency: &str,
    today: NaiveDate,
    name: &str,
    currency: &str,
    target_minor: i64,
    kind: &str,
    period: Option<&str>,
    week_start: Option<i64>,
) -> Result<Allowance, DbError> {
    validate_allowance(
        name,
        target_minor,
        currency,
        base_currency,
        kind,
        period,
        week_start,
    )
    .map_err(|e| DbError::Invalid(e.to_string()))?;

    let total = super::dashboard::total_balance_minor(conn, base_currency, today)?;
    let existing_reserved = active_base_reserved_sum(conn, base_currency)?;
    let available = total - existing_reserved;
    // Allocating from a starting balance of 0: reserved_increase = target - max(0, 0) = target.
    if target_minor > available {
        return Err(DbError::Invalid(
            "not enough available savings to allocate this allowance".to_string(),
        ));
    }

    let next_refresh_date = if kind == "recurring" {
        // `period`/`week_start` are already validated above, so this cannot be `None`.
        let cadence = cadence_of(period.unwrap_or_default(), week_start)
            .ok_or_else(|| DbError::Invalid("invalid period/week_start".to_string()))?;
        Some(next_boundary_after(cadence, today).to_string())
    } else {
        None
    };
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO allowances
           (name, currency, target_minor, balance_minor, kind, period, week_start,
            next_refresh_date, active, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9)",
        params![
            name.trim(),
            currency,
            target_minor,
            target_minor, // initial balance == target (docs/allowances.md §9.1 - full allocation)
            kind,
            period,
            week_start,
            next_refresh_date,
            now,
        ],
    )?;
    get(conn, conn.last_insert_rowid())
}

/// Update an allowance's name/target/active flag (currency, kind, period and week_start are fixed
/// at creation - delete and recreate to change them). The target delta and any pause/resume are
/// applied together, gated all-or-nothing against Available when they would RAISE `Reserved`
/// (docs/allowances.md §6.1 points 4 and 6, §6.2); a foreign-currency allowance (defensive - see
/// `AllowanceSummary.excludedAllowances`) never participates in the reserved/available pool, so its
/// balance simply tracks the target delta unconditionally.
pub fn update(
    conn: &Connection,
    id: i64,
    name: &str,
    new_target_minor: i64,
    active: bool,
    base_currency: &str,
    today: NaiveDate,
) -> Result<Allowance, DbError> {
    if name.trim().is_empty() {
        return Err(DbError::Invalid("name must not be empty".to_string()));
    }
    if new_target_minor <= 0 {
        return Err(DbError::Invalid(
            "target must be greater than zero".to_string(),
        ));
    }

    let tx = conn.unchecked_transaction()?;
    let old = get(&tx, id)?;

    let new_balance = if old.currency != base_currency {
        // Defensive: a non-base-currency row (see `AllowanceSummary.excludedAllowances`) never
        // participates in the reserved/available pool - apply the delta unconditionally.
        old.balance_minor + (new_target_minor - old.target_minor)
    } else if old.active == active {
        // The common case: active flag unchanged, only the target (and/or name) may have changed -
        // gated via `apply_target_delta` (docs/allowances.md §8).
        let total = super::dashboard::total_balance_minor(&tx, base_currency, today)?;
        let reserved_all = active_base_reserved_sum(&tx, base_currency)?;
        let available = total - reserved_all;
        if old.active {
            apply_target_delta(
                old.target_minor,
                new_target_minor,
                old.balance_minor,
                available,
            )
            .map_err(|_| {
                DbError::Invalid("not enough available savings to cover this change".to_string())
            })?
        } else {
            // Already inactive and staying inactive: contributes 0 to Reserved either way - never
            // gated.
            old.balance_minor + (new_target_minor - old.target_minor)
        }
    } else if !active {
        // Pause (active true -> false): Reserved returns to Available - never gated
        // (docs/allowances.md §6.1 point 4).
        old.balance_minor + (new_target_minor - old.target_minor)
    } else {
        // Resume (active false -> true): re-gate the FULL resulting reservation against Available
        // (which, since this row was inactive, already excludes it) - docs/allowances.md §11.
        let raw_balance = old.balance_minor + (new_target_minor - old.target_minor);
        let total = super::dashboard::total_balance_minor(&tx, base_currency, today)?;
        let reserved_all = active_base_reserved_sum(&tx, base_currency)?;
        let available = total - reserved_all;
        let increase = reserved_of(raw_balance, true); // old contribution was 0 while inactive
        if increase > 0 && increase > available {
            return Err(DbError::Invalid(
                "not enough available savings to resume this allowance".to_string(),
            ));
        }
        raw_balance
    };

    let changed = tx.execute(
        "UPDATE allowances SET name = ?2, target_minor = ?3, balance_minor = ?4, active = ?5 WHERE id = ?1",
        params![id, name.trim(), new_target_minor, new_balance, active as i64],
    )?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("allowance {id} not found")));
    }
    tx.commit()?;
    get(conn, id)
}

/// Delete an allowance. Tagged transactions keep their ledger history - the FK
/// `ON DELETE SET NULL` simply detaches the tag (`db::transactions`).
pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    let changed = conn.execute("DELETE FROM allowances WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("allowance {id} not found")));
    }
    Ok(())
}

/// Adjust a tagged allowance's balance by `signed_base_delta` (the tagged transaction's own signed
/// `base_amount_minor`). NEVER gated - a spend/refund against an already-reserved envelope is not a
/// NEW reservation (docs/allowances.md §12). A one-time allowance that reaches `<= 0` while still
/// active auto-closes (forward-only - it is never re-opened here even if a later reversal pushes the
/// balance back above zero, docs/allowances.md §10). Assumes the caller holds a surrounding
/// transaction (this may run as one leg of a larger transaction write).
pub(crate) fn apply_tag_delta(
    conn: &Connection,
    allowance_id: i64,
    signed_base_delta: i64,
) -> Result<(), DbError> {
    let (balance_minor, kind, active): (i64, String, i64) = conn.query_row(
        "SELECT balance_minor, kind, active FROM allowances WHERE id = ?1",
        params![allowance_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let new_balance = balance_minor + signed_base_delta;
    let mut new_active = active != 0;
    if new_active && kind == "one_time" && one_time_closed(new_balance) {
        new_active = false;
    }
    conn.execute(
        "UPDATE allowances SET balance_minor = ?2, active = ?3 WHERE id = ?1",
        params![allowance_id, new_balance, new_active as i64],
    )?;
    Ok(())
}

/// Refresh every ACTIVE, RECURRING, `base_currency` allowance due as of `today`, lazily on app open
/// (no background scheduler, NFR-Perf3) - ONE transaction for the whole batch (ACID). One-time
/// allowances never refresh; a due-but-underfunded allowance is skipped (logged) and the batch
/// continues (docs/allowances.md §6.1 point 2 - warn, don't abort the others). Returns how many
/// allowances were actually topped up.
pub fn refresh_due(
    conn: &Connection,
    base_currency: &str,
    today: NaiveDate,
) -> Result<usize, DbError> {
    let tx = conn.unchecked_transaction()?;
    let total = super::dashboard::total_balance_minor(&tx, base_currency, today)?;

    let mut stmt = tx.prepare(
        "SELECT id, target_minor, balance_minor, kind, period, week_start, next_refresh_date
         FROM allowances WHERE active = 1 AND currency = ?1 ORDER BY id ASC",
    )?;
    #[allow(clippy::type_complexity)]
    let rows: Vec<(
        i64,
        i64,
        i64,
        String,
        Option<String>,
        Option<i64>,
        Option<String>,
    )> = stmt
        .query_map(params![base_currency], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);

    // Running Available across the whole batch: starts at Total minus every active base-currency
    // allowance's current reserved contribution (recurring AND one-time both count).
    let reserved_all: i64 = rows
        .iter()
        .map(|(_, _, balance, ..)| (*balance).max(0))
        .sum();
    let mut available = total - reserved_all;

    let mut topped_up = 0usize;
    for (id, target_minor, balance_minor, kind, period, week_start, next_refresh_date) in rows {
        if kind != "recurring" {
            continue; // one-time allowances never refresh
        }
        let period = match period {
            Some(p) => p,
            None => continue, // malformed row - skip rather than abort the batch
        };
        let cadence = match cadence_of(&period, week_start) {
            Some(c) => c,
            None => continue,
        };
        let next_refresh = match next_refresh_date.as_deref().map(parse_date).transpose()? {
            Some(d) => d,
            None => continue,
        };

        let plan = plan_refresh(cadence, next_refresh, today);
        if !plan.should_top_up {
            continue; // pointer unchanged - nothing to write
        }

        match top_up(target_minor, balance_minor, available) {
            TopUp::Apply {
                new_balance,
                reserved_delta,
            } => {
                tx.execute(
                    "UPDATE allowances SET balance_minor = ?2, next_refresh_date = ?3 WHERE id = ?1",
                    params![id, new_balance, plan.next_refresh.to_string()],
                )?;
                available -= reserved_delta;
                topped_up += 1;
            }
            TopUp::Skip => {
                log::warn!(
                    "allowance {id} refresh skipped: not enough available savings to top up"
                );
                tx.execute(
                    "UPDATE allowances SET next_refresh_date = ?2 WHERE id = ?1",
                    params![id, plan.next_refresh.to_string()],
                )?;
            }
        }
    }

    tx.commit()?;
    Ok(topped_up)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        super::super::run_migrations(&conn, "2026-07-01T00:00:00Z").unwrap();
        super::super::seed_defaults(&conn).unwrap();
        conn
    }

    fn date(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    // Seeded: account id 1 = Cash (MUR, opening 0); category 1 = Groceries (expense), 9 = Salary
    // (income). Fund the vault via a Salary transaction so `total_balance_minor` is nonzero.
    fn fund(conn: &Connection, amount: &str) {
        crate::db::transactions::create(
            conn,
            crate::db::transactions::TxInput {
                account_id: 1,
                posted_date: "2026-07-01",
                amount,
                currency: None,
                fx_rate: None,
                splits: &[crate::db::transactions::SplitInput {
                    category_id: 9,
                    amount,
                }],
                payee: None,
                note: None,
                allowance_id: None,
            },
            "2026-07-01T00:00:00Z",
        )
        .unwrap();
    }

    fn spend(conn: &Connection, amount: &str, allowance_id: Option<i64>) -> i64 {
        crate::db::transactions::create(
            conn,
            crate::db::transactions::TxInput {
                account_id: 1,
                posted_date: "2026-07-05",
                amount,
                currency: None,
                fx_rate: None,
                splits: &[crate::db::transactions::SplitInput {
                    category_id: 1,
                    amount,
                }],
                payee: None,
                note: None,
                allowance_id,
            },
            "2026-07-05T00:00:00Z",
        )
        .unwrap()
        .id
    }

    #[test]
    fn create_gates_the_initial_allocation() {
        let conn = db();
        fund(&conn, "1000.00"); // Total = 100_000 minor.
        let today = date("2026-07-13");

        let a = create(
            &conn,
            "MUR",
            today,
            "Groceries",
            "MUR",
            50_000,
            "one_time",
            None,
            None,
        )
        .unwrap();
        assert_eq!(a.balance_minor, 50_000);
        assert_eq!(a.reserved_minor, 50_000);
        assert!(!a.overspent);

        // Only 50_000 remains available; requesting 60_000 more must be rejected, all-or-nothing.
        assert!(create(
            &conn,
            "MUR",
            today,
            "Transport",
            "MUR",
            60_000,
            "one_time",
            None,
            None
        )
        .is_err());
        // Exactly the remainder succeeds.
        let b = create(
            &conn,
            "MUR",
            today,
            "Transport",
            "MUR",
            50_000,
            "one_time",
            None,
            None,
        )
        .unwrap();
        assert_eq!(b.balance_minor, 50_000);
    }

    #[test]
    fn create_rejects_non_base_currency() {
        let conn = db();
        fund(&conn, "1000.00");
        let today = date("2026-07-13");
        assert!(create(
            &conn,
            "MUR",
            today,
            "USD envelope",
            "USD",
            10_000,
            "one_time",
            None,
            None
        )
        .is_err());
    }

    #[test]
    fn create_sets_next_refresh_date_for_recurring_only() {
        let conn = db();
        fund(&conn, "1000.00");
        let today = date("2026-07-13"); // a Monday

        let weekly = create(
            &conn,
            "MUR",
            today,
            "Personal",
            "MUR",
            10_000,
            "recurring",
            Some("weekly"),
            Some(1),
        )
        .unwrap();
        assert_eq!(weekly.next_refresh_date.as_deref(), Some("2026-07-20"));

        let monthly = create(
            &conn,
            "MUR",
            today,
            "Rent float",
            "MUR",
            10_000,
            "recurring",
            Some("monthly"),
            None,
        )
        .unwrap();
        assert_eq!(monthly.next_refresh_date.as_deref(), Some("2026-08-01"));

        let one_time = create(
            &conn, "MUR", today, "Trip", "MUR", 10_000, "one_time", None, None,
        )
        .unwrap();
        assert_eq!(one_time.next_refresh_date, None);
    }

    #[test]
    fn summary_reports_the_three_balances() {
        let conn = db();
        fund(&conn, "1000.00"); // Total = 100_000.
        let today = date("2026-07-13");
        create(
            &conn,
            "MUR",
            today,
            "Groceries",
            "MUR",
            40_000,
            "one_time",
            None,
            None,
        )
        .unwrap();

        let s = summary(&conn, "MUR", today).unwrap();
        assert_eq!(s.total_minor, 100_000);
        assert_eq!(s.reserved_minor, 40_000);
        assert_eq!(s.available_minor, 60_000);
        assert_eq!(s.allowances.len(), 1);
        assert_eq!(s.excluded_allowances, 0);
    }

    #[test]
    fn tagging_a_spend_moves_total_and_balance_together_leaving_available_unchanged() {
        let conn = db();
        fund(&conn, "1000.00"); // Total = 100_000.
        let today = date("2026-07-13");
        let a = create(
            &conn,
            "MUR",
            today,
            "Groceries",
            "MUR",
            30_000,
            "one_time",
            None,
            None,
        )
        .unwrap();

        let before = summary(&conn, "MUR", today).unwrap();
        assert_eq!(before.available_minor, 70_000);

        spend(&conn, "100.00", Some(a.id)); // -10_000 minor, tagged.

        let after = summary(&conn, "MUR", today).unwrap();
        assert_eq!(after.total_minor, 90_000);
        assert_eq!(after.allowances[0].balance_minor, 20_000);
        assert_eq!(
            after.available_minor, 70_000,
            "spend from inside the envelope never touches Available"
        );
    }

    #[test]
    fn overspend_inside_an_allowance_reduces_available_by_the_excess_only() {
        let conn = db();
        fund(&conn, "1000.00"); // Total = 100_000.
        let today = date("2026-07-13");
        let a = create(
            &conn,
            "MUR",
            today,
            "Groceries",
            "MUR",
            10_000,
            "one_time",
            None,
            None,
        )
        .unwrap();

        spend(&conn, "150.00", Some(a.id)); // -15_000: overspend of 5_000 beyond the 10_000 balance.

        let s = summary(&conn, "MUR", today).unwrap();
        assert_eq!(s.total_minor, 85_000);
        assert_eq!(s.allowances[0].balance_minor, -5_000);
        assert!(s.allowances[0].overspent);
        assert_eq!(s.reserved_minor, 0, "a negative balance reserves nothing");
        assert_eq!(s.available_minor, 85_000);
    }

    #[test]
    fn one_time_allowance_auto_closes_at_or_below_zero() {
        let conn = db();
        fund(&conn, "1000.00");
        let today = date("2026-07-13");
        let a = create(
            &conn, "MUR", today, "Trip", "MUR", 10_000, "one_time", None, None,
        )
        .unwrap();
        spend(&conn, "100.00", Some(a.id)); // exactly zeroes the balance.

        let after = list(&conn).unwrap();
        let closed = after.iter().find(|x| x.id == a.id).unwrap();
        assert!(!closed.active, "auto-closed at exactly 0");
        assert_eq!(closed.balance_minor, 0);
    }

    #[test]
    fn update_edits_name_and_target_gated_and_pauses_resumes() {
        let conn = db();
        fund(&conn, "1000.00"); // Total = 100_000.
        let today = date("2026-07-13");
        let a = create(
            &conn,
            "MUR",
            today,
            "Groceries",
            "MUR",
            30_000,
            "one_time",
            None,
            None,
        )
        .unwrap();
        // Available = 70_000 remains.

        // Raise by 50_000 (fits in the 70_000 available).
        let raised = update(&conn, a.id, "Groceries", 80_000, true, "MUR", today).unwrap();
        assert_eq!(raised.target_minor, 80_000);
        assert_eq!(raised.balance_minor, 80_000);

        // Raising far beyond what's available is rejected, all-or-nothing (leaves it unchanged).
        assert!(update(&conn, a.id, "Groceries", 1_000_000, true, "MUR", today).is_err());
        let unchanged = list(&conn)
            .unwrap()
            .into_iter()
            .find(|x| x.id == a.id)
            .unwrap();
        assert_eq!(unchanged.target_minor, 80_000);

        // Pause: reserved returns to Available, never gated.
        let paused = update(&conn, a.id, "Groceries", 80_000, false, "MUR", today).unwrap();
        assert!(!paused.active);
        assert_eq!(
            summary(&conn, "MUR", today).unwrap().available_minor,
            100_000
        );

        // Resume: re-gated against Available (which comfortably covers it here).
        let resumed = update(&conn, a.id, "Groceries", 80_000, true, "MUR", today).unwrap();
        assert!(resumed.active);
        assert_eq!(
            summary(&conn, "MUR", today).unwrap().available_minor,
            20_000
        );
    }

    #[test]
    fn update_resume_rejected_when_available_cannot_cover_it() {
        let conn = db();
        fund(&conn, "500.00"); // Total = 50_000.
        let today = date("2026-07-13");
        let a = create(
            &conn,
            "MUR",
            today,
            "Groceries",
            "MUR",
            30_000,
            "one_time",
            None,
            None,
        )
        .unwrap();
        // Allocate the rest to a second allowance so nothing is left in Available.
        create(
            &conn,
            "MUR",
            today,
            "Transport",
            "MUR",
            20_000,
            "one_time",
            None,
            None,
        )
        .unwrap();
        update(&conn, a.id, "Groceries", 30_000, false, "MUR", today).unwrap(); // pause -> frees 30_000
                                                                                // Spend the freed Available elsewhere is not modelled here; instead allocate a THIRD
                                                                                // allowance to consume the freed Available, then resuming the first must fail.
        create(
            &conn,
            "MUR",
            today,
            "Emergency",
            "MUR",
            30_000,
            "one_time",
            None,
            None,
        )
        .unwrap();

        assert!(update(&conn, a.id, "Groceries", 30_000, true, "MUR", today).is_err());
    }

    #[test]
    fn delete_detaches_the_tag_but_keeps_the_transaction() {
        let conn = db();
        fund(&conn, "1000.00");
        let today = date("2026-07-13");
        let a = create(
            &conn,
            "MUR",
            today,
            "Groceries",
            "MUR",
            30_000,
            "one_time",
            None,
            None,
        )
        .unwrap();
        let tx_id = spend(&conn, "50.00", Some(a.id));

        delete(&conn, a.id).unwrap();

        let tx = crate::db::transactions::list(&conn)
            .unwrap()
            .into_iter()
            .find(|t| t.id == tx_id)
            .unwrap();
        assert_eq!(tx.allowance_id, None, "ON DELETE SET NULL detaches the tag");
        assert_eq!(
            tx.amount_minor, -5_000,
            "the ledger row itself is untouched"
        );
    }

    #[test]
    fn retagging_reverses_old_and_applies_new() {
        let conn = db();
        fund(&conn, "1000.00");
        let today = date("2026-07-13");
        let a = create(
            &conn,
            "MUR",
            today,
            "Groceries",
            "MUR",
            30_000,
            "one_time",
            None,
            None,
        )
        .unwrap();
        let b = create(
            &conn,
            "MUR",
            today,
            "Transport",
            "MUR",
            30_000,
            "one_time",
            None,
            None,
        )
        .unwrap();

        let tx = crate::db::transactions::create(
            &conn,
            crate::db::transactions::TxInput {
                account_id: 1,
                posted_date: "2026-07-05",
                amount: "100.00",
                currency: None,
                fx_rate: None,
                splits: &[crate::db::transactions::SplitInput {
                    category_id: 1,
                    amount: "100.00",
                }],
                payee: None,
                note: None,
                allowance_id: Some(a.id),
            },
            "2026-07-05T00:00:00Z",
        )
        .unwrap();
        assert_eq!(get(&conn, a.id).unwrap().balance_minor, 20_000);

        // Retag to b: a's balance reverses (back to 30_000), b's absorbs the -10_000.
        crate::db::transactions::update(
            &conn,
            tx.id,
            crate::db::transactions::TxInput {
                account_id: 1,
                posted_date: "2026-07-05",
                amount: "100.00",
                currency: None,
                fx_rate: None,
                splits: &[crate::db::transactions::SplitInput {
                    category_id: 1,
                    amount: "100.00",
                }],
                payee: None,
                note: None,
                allowance_id: Some(b.id),
            },
        )
        .unwrap();

        assert_eq!(
            get(&conn, a.id).unwrap().balance_minor,
            30_000,
            "a's tag reversed"
        );
        assert_eq!(
            get(&conn, b.id).unwrap().balance_minor,
            20_000,
            "b now absorbs the spend"
        );
    }

    #[test]
    fn refresh_due_is_idempotent_same_day_and_advances_and_skips_inactive_and_one_time() {
        let conn = db();
        fund(&conn, "1000.00"); // Total = 100_000.
        let today = date("2026-07-13"); // Monday
        let weekly = create(
            &conn,
            "MUR",
            today,
            "Personal",
            "MUR",
            20_000,
            "recurring",
            Some("weekly"),
            Some(1),
        )
        .unwrap();
        let one_time = create(
            &conn, "MUR", today, "Trip", "MUR", 10_000, "one_time", None, None,
        )
        .unwrap();
        let inactive = create(
            &conn,
            "MUR",
            today,
            "Paused",
            "MUR",
            10_000,
            "recurring",
            Some("weekly"),
            Some(1),
        )
        .unwrap();
        update(&conn, inactive.id, "Paused", 10_000, false, "MUR", today).unwrap();

        // Spend down the weekly allowance so a refresh has something to top up.
        spend(&conn, "150.00", Some(weekly.id)); // balance 20_000 -> 5_000.

        let next_week = date("2026-07-20");
        let n = refresh_due(&conn, "MUR", next_week).unwrap();
        assert_eq!(n, 1, "only the active recurring allowance refreshes");
        assert_eq!(
            get(&conn, weekly.id).unwrap().balance_minor,
            20_000,
            "topped back up to target"
        );
        assert_eq!(
            get(&conn, one_time.id).unwrap().balance_minor,
            10_000,
            "one-time never refreshes"
        );
        assert_eq!(
            get(&conn, inactive.id)
                .unwrap()
                .next_refresh_date
                .as_deref(),
            Some("2026-07-20"),
            "inactive allowance untouched"
        );

        // Idempotent same-day re-run: nothing left to top up.
        let again = refresh_due(&conn, "MUR", next_week).unwrap();
        assert_eq!(again, 0);
    }

    #[test]
    fn refresh_due_skips_and_logs_when_underfunded_and_continues_the_batch() {
        let conn = db();
        fund(&conn, "300.00"); // Total = 30_000.
        let today = date("2026-07-13"); // Monday
                                        // Allocate the FULL 30_000 across two weekly allowances, leaving Available at 0.
        let a = create(
            &conn,
            "MUR",
            today,
            "Personal",
            "MUR",
            15_000,
            "recurring",
            Some("weekly"),
            Some(1),
        )
        .unwrap();
        let b = create(
            &conn,
            "MUR",
            today,
            "Transport",
            "MUR",
            15_000,
            "recurring",
            Some("weekly"),
            Some(1),
        )
        .unwrap();

        // Spend only from `a`: balance 15_000 -> 5_000, Total 30_000 -> 20_000, so Available stays 0
        // (Reserved drops from 30_000 to 20_000 in exact lockstep with Total).
        spend(&conn, "100.00", Some(a.id));

        let next_week = date("2026-07-20");
        let n = refresh_due(&conn, "MUR", next_week).unwrap();
        // `a` needs 10_000 to heal but Available is 0 -> skipped (warned, left unchanged). `b` is
        // already at target (reserved_increase <= 0) so it is never gated and "tops up" (a no-op
        // trim) - the batch continues past the skip rather than aborting.
        assert_eq!(n, 1, "only b's no-op trim counts as an applied top-up");
        assert_eq!(
            get(&conn, a.id).unwrap().balance_minor,
            5_000,
            "left unchanged - not enough Available to heal it"
        );
        assert_eq!(get(&conn, b.id).unwrap().balance_minor, 15_000);
        // Both pointers advance regardless - a skip still advances the schedule (docs/allowances.md
        // §9.2 step 5), so a permanently-underfunded allowance doesn't get retried every single day.
        assert_eq!(
            get(&conn, a.id).unwrap().next_refresh_date.as_deref(),
            Some("2026-07-27")
        );
        assert_eq!(
            get(&conn, b.id).unwrap().next_refresh_date.as_deref(),
            Some("2026-07-27")
        );
    }

    #[test]
    fn serde_round_trips_camel_case_fields() {
        let conn = db();
        fund(&conn, "1000.00");
        let today = date("2026-07-13");
        create(
            &conn,
            "MUR",
            today,
            "Groceries",
            "MUR",
            30_000,
            "one_time",
            None,
            None,
        )
        .unwrap();
        let s = summary(&conn, "MUR", today).unwrap();

        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["totalMinor"], 100_000);
        assert_eq!(json["reservedMinor"], 30_000);
        assert_eq!(json["availableMinor"], 70_000);
        assert_eq!(json["baseCurrency"], "MUR");
        assert_eq!(json["excludedAllowances"], 0);
        assert_eq!(json["allowances"][0]["targetMinor"], 30_000);
        assert_eq!(json["allowances"][0]["reservedMinor"], 30_000);
        assert_eq!(json["allowances"][0]["kind"], "one_time");

        let back: AllowanceSummary = serde_json::from_value(json).unwrap();
        assert_eq!(back, s);
    }

    #[test]
    fn allowance_summary_snapshot_is_a_stable_camel_case_contract() {
        let conn = db();
        fund(&conn, "1000.00");
        let today = date("2026-07-13");
        create(
            &conn,
            "MUR",
            today,
            "Groceries",
            "MUR",
            30_000,
            "one_time",
            None,
            None,
        )
        .unwrap();
        let s = summary(&conn, "MUR", today).unwrap();
        // created_at is a real timestamp - normalise it before snapshotting for stability.
        let mut normalised = s.clone();
        for a in &mut normalised.allowances {
            a.created_at = "2026-07-13T00:00:00Z".to_string();
        }
        insta::assert_snapshot!(
            "allowance_summary_json",
            serde_json::to_string_pretty(&normalised).unwrap()
        );
    }

    /// ADR 0012 point 5: deleting a PRIOR-period tagged transaction after a refresh has already
    /// topped the balance back to target pushes the stored balance above target (the delete
    /// reverses the old spend's tag delta). Assert this is not a permanent drift: the next
    /// `refresh_due` trims the balance back to target for free (no gate, since it's a decrease in
    /// Reserved) and returns the excess to Available - the exact self-healing behavior documented in
    /// `docs/allowances.md` §12 and ADR 0012.
    #[test]
    fn refresh_due_trims_balance_after_a_prior_period_tagged_transaction_is_deleted() {
        let conn = db();
        fund(&conn, "1000.00"); // Total = 100_000.
        let period1 = date("2026-07-13"); // Monday.
        let a = create(
            &conn,
            "MUR",
            period1,
            "Personal",
            "MUR",
            50_000,
            "recurring",
            Some("weekly"),
            Some(1),
        )
        .unwrap();
        assert_eq!(a.balance_minor, 50_000);

        // Tag a spend in period 1: balance 50_000 -> 30_000, Total 100_000 -> 80_000.
        let tx_id = spend(&conn, "200.00", Some(a.id));
        assert_eq!(get(&conn, a.id).unwrap().balance_minor, 30_000);

        // Advance to period 2 and refresh: heals the balance back to target (20_000 <= Available).
        let period2 = date("2026-07-20");
        let healed = refresh_due(&conn, "MUR", period2).unwrap();
        assert_eq!(healed, 1, "period-1 spend is topped back up");
        assert_eq!(get(&conn, a.id).unwrap().balance_minor, 50_000);

        // Now delete the period-1 tagged transaction (a later edit could reduce/retag it the same
        // way). This reverses its tag delta, pushing the ALREADY-REFRESHED balance above target.
        crate::db::transactions::delete(&conn, tx_id).unwrap();
        let after_delete = get(&conn, a.id).unwrap();
        assert_eq!(
            after_delete.balance_minor, 70_000,
            "reversing the old tagged spend pushes balance 20_000 above the 50_000 target"
        );
        let s = summary(&conn, "MUR", period2).unwrap();
        assert_eq!(s.total_minor, 100_000, "deleting the expense restores Total");
        assert_eq!(s.available_minor, 30_000, "Available unchanged - the excess is absorbed by balance, not yet returned");

        // Advance to period 3 and refresh again: the above-target balance trims back to target for
        // free (a decrease is never gated), and the 20_000 excess returns to Available.
        let period3 = date("2026-07-27");
        let trimmed = refresh_due(&conn, "MUR", period3).unwrap();
        assert_eq!(trimmed, 1, "the trim-to-target still counts as an applied refresh");
        assert_eq!(
            get(&conn, a.id).unwrap().balance_minor,
            50_000,
            "trimmed back to target"
        );
        let s = summary(&conn, "MUR", period3).unwrap();
        assert_eq!(s.available_minor, 50_000, "the 20_000 excess is returned to Available");
        assert_eq!(s.total_minor, 100_000, "refresh never touches Total");
    }
}
