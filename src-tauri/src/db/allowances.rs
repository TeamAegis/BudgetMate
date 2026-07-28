//! Allowance (imprest envelope) queries + the reservation engine (FR-3.4). Implements
//! `docs/adr/0012-allowance-total-source-and-derived-balance.md` - read it before changing this
//! file. All money math (the savings gate, the set-to-target refresh outcome, the delta-applied
//! target edit, calendar boundaries) lives in the pure `domain::allowance`; this module only reads
//! rows, computes the derived balance, and persists the allowance-level side effects, always inside
//! a transaction for anything multi-statement (ACID).
//!
//! **The stored balance does not exist.** A row keeps a refresh anchor
//! (`anchor_balance_minor` + `last_refresh_date`); `derived_balance` recomputes the current balance
//! on every read. Tagging a transaction to an allowance ONLY ever sets `transactions.allowance_id`
//! (see `db::transactions`) - it never mutates an `allowances` row, and the shared
//! `db::transactions::insert_in_tx` path (recurring, import) is untouched.

use chrono::NaiveDate;
use rusqlite::{params, Connection};

use super::DbError;
use crate::domain::allowance::{
    allowance_status, anchor_after_target_edit, current_boundary, next_boundary, parse_week_start,
    plan_refresh, reserved_delta, savings_gate_ok, should_auto_close, validate_allowance,
    week_start_str, Allowance, AllowanceKind, AllowanceLine, AllowancePeriod, AllowanceSummary,
};

const ISO_DATE: &str = "%Y-%m-%d";

const ALLOWANCE_COLUMNS: &str = "id, name, currency, target_minor, anchor_balance_minor, kind, \
    period, week_start, last_refresh_date, next_refresh_date, active, created_at";

fn parse_date(s: &str) -> Result<NaiveDate, DbError> {
    NaiveDate::parse_from_str(s, ISO_DATE)
        .map_err(|_| DbError::Invalid(format!("invalid date '{s}' (expected YYYY-MM-DD)")))
}

fn row_to_allowance(row: &rusqlite::Row<'_>) -> rusqlite::Result<Allowance> {
    let kind_str: String = row.get("kind")?;
    let period_str: Option<String> = row.get("period")?;
    Ok(Allowance {
        id: row.get("id")?,
        name: row.get("name")?,
        currency: row.get("currency")?,
        target_minor: row.get("target_minor")?,
        anchor_balance_minor: row.get("anchor_balance_minor")?,
        kind: AllowanceKind::parse(&kind_str).unwrap_or(AllowanceKind::OneTime),
        period: period_str.and_then(|p| AllowancePeriod::parse(&p)),
        week_start: row.get("week_start")?,
        last_refresh_date: row.get("last_refresh_date")?,
        next_refresh_date: row.get("next_refresh_date")?,
        active: row.get::<_, i64>("active")? != 0,
        created_at: row.get("created_at")?,
    })
}

fn get_row(conn: &Connection, id: i64) -> Result<Allowance, DbError> {
    let sql = format!("SELECT {ALLOWANCE_COLUMNS} FROM allowances WHERE id = ?1");
    conn.query_row(&sql, params![id], row_to_allowance).map_err(Into::into)
}

/// All allowances, active first then paused, alphabetical within each group (mirrors the
/// goal-list ordering convention).
pub fn list(conn: &Connection) -> Result<Vec<Allowance>, DbError> {
    let sql = format!(
        "SELECT {ALLOWANCE_COLUMNS} FROM allowances ORDER BY active DESC, name COLLATE NOCASE ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_allowance)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// The current balance for one allowance (ADR 0012 decision 3): the stored anchor plus every
/// tagged, CONFIRMED (`pending_review = 0`), not-future-dated transaction's `base_amount_minor`
/// posted on or after `last_refresh_date` (inclusive) and on or before `today`. Shares the
/// dashboard's exact accounting basis, so a pending-review or future-dated tagged row never moves
/// this figure - `Available = Total - Reserved` reconciles for free (§13.1).
pub fn derived_balance(
    conn: &Connection,
    allowance_id: i64,
    anchor_balance_minor: i64,
    last_refresh_date: &str,
    today: NaiveDate,
) -> Result<i64, DbError> {
    let today_str = today.format(ISO_DATE).to_string();
    let sum: i64 = conn.query_row(
        "SELECT COALESCE(SUM(base_amount_minor), 0) FROM transactions
         WHERE allowance_id = ?1 AND pending_review = 0
           AND posted_date >= ?2 AND posted_date <= ?3",
        params![allowance_id, last_refresh_date, today_str],
        |r| r.get(0),
    )?;
    Ok(anchor_balance_minor + sum)
}

/// `sum(max(0, derived balance))` over ACTIVE, `base_currency` allowances - the "Reserved" figure
/// ADR 0012 nets out of `Total` for both the dashboard (`allowancesReservedMinor`) and this
/// module's own `available_minor`/summary. Paused allowances contribute 0 regardless of their
/// stored balance (§11).
pub fn allowances_reserved_minor(conn: &Connection, base_currency: &str, today: NaiveDate) -> Result<i64, DbError> {
    let active: Vec<Allowance> =
        list(conn)?.into_iter().filter(|a| a.active && a.currency == base_currency).collect();
    let mut total = 0i64;
    for a in active {
        let balance = derived_balance(conn, a.id, a.anchor_balance_minor, &a.last_refresh_date, today)?;
        total += balance.max(0);
    }
    Ok(total)
}

/// `Available = Total - goals_reserved - allowances_reserved` (ADR 0012 decision 2) - the ONE
/// shared definition the savings gate enforces and the summary displays. May be negative
/// (over-committed elsewhere); never clamp it.
pub fn available_minor(conn: &Connection, base_currency: &str, today: NaiveDate) -> Result<i64, DbError> {
    let total = super::dashboard::total_balance(conn, base_currency, today)?;
    let goals_reserved = super::goals::reserved_minor(conn, base_currency)?;
    let allowances_reserved = allowances_reserved_minor(conn, base_currency, today)?;
    Ok(total - goals_reserved - allowances_reserved)
}

/// The allowances-screen read model: vault-level Total/Reserved/Available plus every allowance's
/// derived line (active and paused - only active ones count toward the totals).
pub fn allowance_summary(conn: &Connection, base_currency: &str, today: NaiveDate) -> Result<AllowanceSummary, DbError> {
    let total_minor = super::dashboard::total_balance(conn, base_currency, today)?;
    let goals_reserved = super::goals::reserved_minor(conn, base_currency)?;

    let rows = list(conn)?;
    let mut lines = Vec::with_capacity(rows.len());
    let mut allowances_reserved = 0i64;
    for a in &rows {
        let balance = derived_balance(conn, a.id, a.anchor_balance_minor, &a.last_refresh_date, today)?;
        let reserved = if a.active { balance.max(0) } else { 0 };
        if a.active && a.currency == base_currency {
            allowances_reserved += reserved;
        }
        lines.push(AllowanceLine {
            id: a.id,
            name: a.name.clone(),
            currency: a.currency.clone(),
            target_minor: a.target_minor,
            balance_minor: balance,
            reserved_minor: reserved,
            kind: a.kind,
            period: a.period,
            active: a.active,
            status: allowance_status(balance),
        });
    }

    Ok(AllowanceSummary {
        base_currency: base_currency.to_string(),
        total_minor,
        reserved_minor: goals_reserved + allowances_reserved,
        available_minor: total_minor - goals_reserved - allowances_reserved,
        allowances: lines,
    })
}

fn validate_kind_period(kind: AllowanceKind, period: Option<AllowancePeriod>) -> Result<(), DbError> {
    match (kind, period) {
        (AllowanceKind::Recurring, Some(_)) | (AllowanceKind::OneTime, None) => Ok(()),
        (AllowanceKind::Recurring, None) => {
            Err(DbError::Invalid("a recurring allowance needs a period (weekly or monthly)".into()))
        }
        (AllowanceKind::OneTime, Some(_)) => {
            Err(DbError::Invalid("a one-time allowance must not have a period".into()))
        }
    }
}

/// Create an allowance: the initial allocation (full target reserved immediately, GATED - §9.1).
/// `week_start` is an ISO-8601 weekday name ("monday".."sunday"); irrelevant for monthly/one-time
/// but always validated and stored. `currency` must equal `base_currency` (ADR 0012 decision 4).
#[allow(clippy::too_many_arguments)]
pub fn create(
    conn: &Connection,
    base_currency: &str,
    today: NaiveDate,
    name: &str,
    currency: &str,
    target_minor: i64,
    kind: AllowanceKind,
    period: Option<AllowancePeriod>,
    week_start: &str,
    now_iso: &str,
) -> Result<Allowance, DbError> {
    validate_allowance(name, target_minor, currency, base_currency).map_err(|e| DbError::Invalid(e.to_string()))?;
    validate_kind_period(kind, period)?;
    let week_start_day = parse_week_start(week_start)
        .ok_or_else(|| DbError::Invalid(format!("unknown week start '{week_start}'")))?;

    // Allocation earmarks the FULL target (nothing existed before this row) - gated (§7, §9.1).
    let available = available_minor(conn, base_currency, today)?;
    let delta = reserved_delta(0, false, target_minor, true);
    if !savings_gate_ok(delta, available) {
        return Err(DbError::Invalid(
            "not enough available savings to set aside this allowance's target".into(),
        ));
    }

    let today_str = today.format(ISO_DATE).to_string();
    let next_refresh_date = period.map(|p| next_boundary(p, week_start_day, today).to_string());
    conn.execute(
        "INSERT INTO allowances
           (name, currency, target_minor, anchor_balance_minor, kind, period, week_start,
            last_refresh_date, next_refresh_date, active, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10)",
        params![
            name.trim(),
            currency,
            target_minor,
            target_minor,
            kind.as_str(),
            period.map(|p| p.as_str()),
            week_start_str(week_start_day),
            today_str,
            next_refresh_date,
            now_iso,
        ],
    )?;
    get_row(conn, conn.last_insert_rowid())
}

/// Update name + target (delta-applied to the anchor, §8). Currency and (kind, period,
/// week_start) are not editable in v1 - pause/delete + recreate instead. Gated only when the edit
/// RAISES this allowance's reserved contribution (never gated while paused, since a paused
/// allowance contributes 0 to Reserved either way).
pub fn update(
    conn: &Connection,
    base_currency: &str,
    today: NaiveDate,
    id: i64,
    name: &str,
    currency: &str,
    target_minor: i64,
) -> Result<Allowance, DbError> {
    validate_allowance(name, target_minor, currency, base_currency).map_err(|e| DbError::Invalid(e.to_string()))?;
    let row = get_row(conn, id)?;
    let old_balance = derived_balance(conn, id, row.anchor_balance_minor, &row.last_refresh_date, today)?;
    let new_balance = old_balance + (target_minor - row.target_minor);

    let delta = reserved_delta(old_balance, row.active, new_balance, row.active);
    if delta > 0 {
        let available = available_minor(conn, base_currency, today)?;
        if !savings_gate_ok(delta, available) {
            return Err(DbError::Invalid(
                "not enough available savings to raise this allowance's target".into(),
            ));
        }
    }

    let new_anchor = anchor_after_target_edit(row.anchor_balance_minor, row.target_minor, target_minor);
    // `currency` is validated above (must equal `base_currency`) but never written here - currency
    // is immutable post-create (§8; pause/delete + recreate instead of changing it).
    let changed = conn.execute(
        "UPDATE allowances SET name = ?2, target_minor = ?3, anchor_balance_minor = ?4 WHERE id = ?1",
        params![id, name.trim(), target_minor, new_anchor],
    )?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("allowance {id} not found")));
    }
    get_row(conn, id)
}

/// Pause: deactivate. Never gated - the reserve returns to Available for free (§11, §13.4/§13.8).
pub fn pause(conn: &Connection, id: i64) -> Result<Allowance, DbError> {
    let changed = conn.execute("UPDATE allowances SET active = 0 WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("allowance {id} not found")));
    }
    get_row(conn, id)
}

/// Resume: re-allocate to target (anchor = target, `last_refresh_date` = today, `next_refresh_date`
/// = the next boundary), GATED by Available at resume time (§11, §13.8) - a paused allowance
/// contributes 0 to Reserved regardless of its stale stored balance, so this is exactly like a
/// fresh allocation of the full target.
pub fn resume(conn: &Connection, base_currency: &str, today: NaiveDate, id: i64) -> Result<Allowance, DbError> {
    let row = get_row(conn, id)?;
    if row.active {
        return Ok(row); // already active - idempotent no-op, not a re-allocation
    }

    let available = available_minor(conn, base_currency, today)?;
    let delta = reserved_delta(0, false, row.target_minor, true);
    if !savings_gate_ok(delta, available) {
        return Err(DbError::Invalid(
            "not enough available savings to resume this allowance".into(),
        ));
    }

    let today_str = today.format(ISO_DATE).to_string();
    let next_refresh_date = match row.period {
        Some(p) => {
            let week_start_day = parse_week_start(&row.week_start).unwrap_or(chrono::Weekday::Mon);
            Some(next_boundary(p, week_start_day, today).to_string())
        }
        None => None,
    };
    conn.execute(
        "UPDATE allowances
           SET active = 1, anchor_balance_minor = ?2, last_refresh_date = ?3, next_refresh_date = ?4
         WHERE id = ?1",
        params![id, row.target_minor, today_str, next_refresh_date],
    )?;
    get_row(conn, id)
}

/// Pause or resume, dispatched by the target `active` value (mirrors `db::recurring::set_active`'s
/// shape, but resume re-allocates - see `resume`).
pub fn set_active(
    conn: &Connection,
    base_currency: &str,
    today: NaiveDate,
    id: i64,
    active: bool,
) -> Result<Allowance, DbError> {
    if active {
        resume(conn, base_currency, today, id)
    } else {
        pause(conn, id)
    }
}

/// Hard delete (§11, §13.4/§13.8) - never gated (a decrease in Reserved). Tagged historical
/// transactions keep their now-dangling `allowance_id` for reporting (no FK enforced on that
/// column - see migration 0005's comment); nothing else to clean up since the balance was never
/// stored anywhere but this row.
pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    let changed = conn.execute("DELETE FROM allowances WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(DbError::Invalid(format!("allowance {id} not found")));
    }
    Ok(())
}

/// Lazy, idempotent-on-repeat pass run on unlock (after recurring materialisation - ADR 0012
/// decision 5), inside ONE transaction: first, auto-close any ACTIVE one-time allowance whose
/// derived balance has reached zero or below (§10) - done first so a freed reservation can fund a
/// recurring top-up later in the SAME pass; then, for each ACTIVE recurring allowance due
/// (`today >= next_refresh_date`), perform one gated set-to-target refresh (heal/trim/warn - §9.2)
/// and advance `next_refresh_date` to the next boundary strictly after `today` EITHER WAY (funded
/// or not). `available_minor` is recomputed before each recurring decision so an earlier top-up in
/// this same pass is reflected in the next one's gate check. Returns how many allowances were
/// touched (closed or refreshed, whether or not the refresh was actually funded).
pub fn refresh_due(conn: &Connection, base_currency: &str, today: NaiveDate) -> Result<usize, DbError> {
    let tx = conn.unchecked_transaction()?;
    let mut touched = 0usize;

    // 1) One-time auto-close - independent of any schedule (one-time allowances never refresh).
    let one_time: Vec<Allowance> = list(&tx)?
        .into_iter()
        .filter(|a| a.active && a.kind == AllowanceKind::OneTime)
        .collect();
    for a in one_time {
        let balance = derived_balance(&tx, a.id, a.anchor_balance_minor, &a.last_refresh_date, today)?;
        if should_auto_close(balance) {
            tx.execute("UPDATE allowances SET active = 0 WHERE id = ?1", params![a.id])?;
            touched += 1;
        }
    }

    // 2) Recurring refresh, due allowances only, oldest-id-first for a stable, deterministic order.
    let mut recurring: Vec<Allowance> = list(&tx)?
        .into_iter()
        .filter(|a| a.active && a.kind == AllowanceKind::Recurring)
        .collect();
    recurring.sort_by_key(|a| a.id);

    for row in recurring {
        let (period, next_due) = match (row.period, row.next_refresh_date.as_deref()) {
            (Some(p), Some(d)) => (p, parse_date(d)?),
            _ => continue, // malformed/missing schedule - skip rather than abort the whole pass
        };
        if today < next_due {
            continue;
        }
        let week_start_day = match parse_week_start(&row.week_start) {
            Some(w) => w,
            None => continue,
        };

        let current_balance = derived_balance(&tx, row.id, row.anchor_balance_minor, &row.last_refresh_date, today)?;
        let available = available_minor(&tx, base_currency, today)?;
        let outcome = plan_refresh(row.target_minor, current_balance, available);
        let new_next_refresh = next_boundary(period, week_start_day, today).to_string();

        if outcome.funded {
            // Anchor at the CURRENT PERIOD BOUNDARY, not `today` (ADR 0012 §5; see the "Anchor
            // discipline" doc in `domain::allowance`). A late lazy refresh (today strictly after the
            // boundary) must not exclude a current-period transaction entered after the refresh runs.
            let boundary = current_boundary(period, week_start_day, today);
            tx.execute(
                "UPDATE allowances SET anchor_balance_minor = ?2, last_refresh_date = ?3, next_refresh_date = ?4 WHERE id = ?1",
                params![row.id, outcome.new_balance_minor, boundary.to_string(), new_next_refresh],
            )?;
        } else {
            // Warn-and-do-not-refill (§6.2 decision 2): anchor + last_refresh_date UNCHANGED, only
            // the schedule pointer advances so the pass isn't stuck retrying the same due date.
            tx.execute(
                "UPDATE allowances SET next_refresh_date = ?2 WHERE id = ?1",
                params![row.id, new_next_refresh],
            )?;
            log::warn!("allowance {} refresh skipped: insufficient available savings", row.id);
        }
        touched += 1;
    }

    tx.commit()?;
    Ok(touched)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::transactions::{self, SplitInput, TxInput};

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        super::super::run_migrations(&conn, "2026-06-05T00:00:00Z").unwrap();
        super::super::seed_defaults(&conn).unwrap();
        conn
    }

    // Seeded defaults: account id 1 = Cash (MUR, opening 0); category 1 = Groceries (expense),
    // 9 = Salary (income).

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 7, 13).unwrap() // a Monday
    }

    fn deposit(conn: &Connection, amount: &str, date: &str) {
        transactions::create(
            conn,
            TxInput {
                account_id: 1,
                posted_date: date,
                amount,
                currency: None,
                fx_rate: None,
                splits: &[SplitInput { category_id: 9, amount }],
                payee: None,
                note: None,
            },
            "2026-06-01T00:00:00Z",
        )
        .unwrap();
    }

    /// Insert an expense, optionally tagging it to an allowance (allowance_id is not part of
    /// `TxInput` yet in this test helper - see commands::transactions - so tag it with a direct
    /// UPDATE after insert, mirroring how the manual create/update command path will set it).
    fn expense_tagged(conn: &Connection, amount: &str, date: &str, allowance_id: Option<i64>) -> i64 {
        let tx = transactions::create(
            conn,
            TxInput {
                account_id: 1,
                posted_date: date,
                amount,
                currency: None,
                fx_rate: None,
                splits: &[SplitInput { category_id: 1, amount }],
                payee: None,
                note: None,
            },
            "2026-06-01T00:00:00Z",
        )
        .unwrap();
        if let Some(id) = allowance_id {
            conn.execute(
                "UPDATE transactions SET allowance_id = ?2 WHERE id = ?1",
                params![tx.id, id],
            )
            .unwrap();
        }
        tx.id
    }

    #[test]
    fn create_gates_allocation_against_available() {
        let conn = db();
        deposit(&conn, "5000.00", "2026-07-01"); // Total = 500_000 minor

        // §7 step 1: create "Groceries" target 1000.00 -> gate 100_000 <= 500_000, ok.
        let a = create(
            &conn, "MUR", today(), "Groceries", "MUR", 100_000,
            AllowanceKind::Recurring, Some(AllowancePeriod::Weekly), "monday", "2026-07-13T00:00:00Z",
        )
        .unwrap();
        assert_eq!(a.anchor_balance_minor, 100_000);
        assert_eq!(a.last_refresh_date, "2026-07-13");
        assert_eq!(a.next_refresh_date.as_deref(), Some("2026-07-20"));

        // Creating a second allowance whose target exceeds what's left available is rejected
        // (all-or-nothing) and nothing is persisted.
        let err = create(
            &conn, "MUR", today(), "Too Big", "MUR", 999_999_999,
            AllowanceKind::OneTime, None, "monday", "2026-07-13T00:00:00Z",
        );
        assert!(err.is_err());
        assert_eq!(list(&conn).unwrap().len(), 1, "the rejected create must not persist a row");
    }

    #[test]
    fn create_rejects_non_base_currency_and_bad_kind_period_pairing() {
        let conn = db();
        deposit(&conn, "5000.00", "2026-07-01");
        assert!(create(
            &conn, "MUR", today(), "Foreign", "USD", 100_000,
            AllowanceKind::OneTime, None, "monday", "2026-07-13T00:00:00Z",
        )
        .is_err());
        assert!(create(
            &conn, "MUR", today(), "Bad", "MUR", 100_000,
            AllowanceKind::Recurring, None, "monday", "2026-07-13T00:00:00Z",
        )
        .is_err());
        assert!(create(
            &conn, "MUR", today(), "Bad2", "MUR", 100_000,
            AllowanceKind::OneTime, Some(AllowancePeriod::Weekly), "monday", "2026-07-13T00:00:00Z",
        )
        .is_err());
    }

    #[test]
    fn overspend_worked_example_section_7() {
        let conn = db();
        deposit(&conn, "5000.00", "2026-07-01"); // Total 500_000

        let a = create(
            &conn, "MUR", today(), "Groceries", "MUR", 100_000,
            AllowanceKind::Recurring, Some(AllowancePeriod::Weekly), "monday", "2026-07-13T00:00:00Z",
        )
        .unwrap();
        assert_eq!(available_minor(&conn, "MUR", today()).unwrap(), 400_000, "5000 - 1000 allocated");

        // Spend 600 (60_000 minor) tagged - balance 400, Available unchanged at 4000.
        expense_tagged(&conn, "600.00", "2026-07-13", Some(a.id));
        let balance = derived_balance(&conn, a.id, a.anchor_balance_minor, &a.last_refresh_date, today()).unwrap();
        assert_eq!(balance, 40_000);
        assert_eq!(available_minor(&conn, "MUR", today()).unwrap(), 400_000, "spend inside the envelope never touches Available");

        // Spend 600 again (only 400 remains): overspend of 200. Total drops by 600; Available drops
        // by only the 200 over-envelope portion.
        expense_tagged(&conn, "600.00", "2026-07-13", Some(a.id));
        let balance2 = derived_balance(&conn, a.id, a.anchor_balance_minor, &a.last_refresh_date, today()).unwrap();
        assert_eq!(balance2, -20_000, "overspent by 200");
        assert_eq!(available_minor(&conn, "MUR", today()).unwrap(), 380_000, "Available drops by exactly the 200 over-envelope portion");
    }

    #[test]
    fn target_edit_directions_section_8() {
        let conn = db();
        deposit(&conn, "5000.00", "2026-07-01");
        let a = create(
            &conn, "MUR", today(), "Groceries", "MUR", 100_000,
            AllowanceKind::OneTime, None, "monday", "2026-07-13T00:00:00Z",
        )
        .unwrap();
        expense_tagged(&conn, "600.00", "2026-07-13", Some(a.id)); // balance now 400

        // Raise 1000 -> 1500: delta +500, gated (500 <= available), balance -> 900.
        let raised = update(&conn, "MUR", today(), a.id, "Groceries", "MUR", 150_000).unwrap();
        let bal = derived_balance(&conn, a.id, raised.anchor_balance_minor, &raised.last_refresh_date, today()).unwrap();
        assert_eq!(bal, 90_000);

        // Lower 1500 -> 800 (current balance 900): delta -700, never gated, balance -> 200.
        let lowered = update(&conn, "MUR", today(), a.id, "Groceries", "MUR", 80_000).unwrap();
        let bal2 = derived_balance(&conn, a.id, lowered.anchor_balance_minor, &lowered.last_refresh_date, today()).unwrap();
        assert_eq!(bal2, 20_000);

        // Lower below what's already spent: 800 -> 500 (balance 200) -> -100 (overspent vs new target).
        let lowered2 = update(&conn, "MUR", today(), a.id, "Groceries", "MUR", 50_000).unwrap();
        let bal3 = derived_balance(&conn, a.id, lowered2.anchor_balance_minor, &lowered2.last_refresh_date, today()).unwrap();
        assert_eq!(bal3, -10_000);
    }

    #[test]
    fn update_raise_is_gated_by_available() {
        let conn = db();
        deposit(&conn, "1000.00", "2026-07-01"); // Total 100_000
        let a = create(
            &conn, "MUR", today(), "Groceries", "MUR", 100_000,
            AllowanceKind::OneTime, None, "monday", "2026-07-13T00:00:00Z",
        )
        .unwrap(); // uses up all available (Total == target)

        // Raising the target needs MORE available savings than exist -> rejected.
        let err = update(&conn, "MUR", today(), a.id, "Groceries", "MUR", 200_000);
        assert!(err.is_err());
        // The row must be untouched by the rejected update.
        let row = list(&conn).unwrap().into_iter().find(|r| r.id == a.id).unwrap();
        assert_eq!(row.target_minor, 100_000);
    }

    #[test]
    fn pause_frees_reserved_and_resume_is_gated() {
        let conn = db();
        deposit(&conn, "1000.00", "2026-07-01"); // Total 100_000
        let a = create(
            &conn, "MUR", today(), "Groceries", "MUR", 100_000,
            AllowanceKind::OneTime, None, "monday", "2026-07-13T00:00:00Z",
        )
        .unwrap();
        assert_eq!(available_minor(&conn, "MUR", today()).unwrap(), 0);

        let paused = set_active(&conn, "MUR", today(), a.id, false).unwrap();
        assert!(!paused.active);
        assert_eq!(available_minor(&conn, "MUR", today()).unwrap(), 100_000, "pause returns the reserve to Available for free");

        // Resuming re-allocates the full target again - fits exactly (100_000 <= 100_000).
        let resumed = set_active(&conn, "MUR", today(), a.id, true).unwrap();
        assert!(resumed.active);
        assert_eq!(resumed.anchor_balance_minor, 100_000);
        assert_eq!(available_minor(&conn, "MUR", today()).unwrap(), 0);
    }

    #[test]
    fn resume_is_rejected_when_available_cannot_cover_it() {
        let conn = db();
        deposit(&conn, "1000.00", "2026-07-01"); // Total 100_000
        let a = create(
            &conn, "MUR", today(), "Groceries", "MUR", 100_000,
            AllowanceKind::OneTime, None, "monday", "2026-07-13T00:00:00Z",
        )
        .unwrap();
        set_active(&conn, "MUR", today(), a.id, false).unwrap();
        // A second allowance soaks up the freed Available.
        create(
            &conn, "MUR", today(), "Rent", "MUR", 100_000,
            AllowanceKind::OneTime, None, "monday", "2026-07-13T00:00:00Z",
        )
        .unwrap();
        assert_eq!(available_minor(&conn, "MUR", today()).unwrap(), 0);

        assert!(set_active(&conn, "MUR", today(), a.id, true).is_err());
        let row = list(&conn).unwrap().into_iter().find(|r| r.id == a.id).unwrap();
        assert!(!row.active, "a rejected resume must leave the allowance paused");
    }

    #[test]
    fn delete_is_hard_and_frees_reserved_leaving_transactions_dangling() {
        let conn = db();
        deposit(&conn, "1000.00", "2026-07-01");
        let a = create(
            &conn, "MUR", today(), "Groceries", "MUR", 100_000,
            AllowanceKind::OneTime, None, "monday", "2026-07-13T00:00:00Z",
        )
        .unwrap();
        let tx_id = expense_tagged(&conn, "10.00", "2026-07-13", Some(a.id));
        // The Rs10 tagged spend was real (drew down Total), so freeing the reserve on delete
        // leaves Available at Total (99_000), not the original 100_000.
        assert_eq!(available_minor(&conn, "MUR", today()).unwrap(), 0, "spend inside the envelope leaves Available at 0 pre-delete");

        delete(&conn, a.id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
        assert_eq!(available_minor(&conn, "MUR", today()).unwrap(), 99_000, "deleting frees the reserve, but the real Rs10 spend stays spent");

        let dangling: Option<i64> = conn
            .query_row("SELECT allowance_id FROM transactions WHERE id = ?1", params![tx_id], |r| r.get(0))
            .unwrap();
        assert_eq!(dangling, Some(a.id), "the historical tag survives the parent's deletion, for reporting");
    }

    #[test]
    fn refresh_heals_overspend_when_available_covers_it() {
        let conn = db();
        deposit(&conn, "5000.00", "2026-07-01"); // Total 500_000
        let a = create(
            &conn, "MUR", NaiveDate::from_ymd_opt(2026, 7, 6).unwrap(), "Groceries", "MUR", 100_000,
            AllowanceKind::Recurring, Some(AllowancePeriod::Weekly), "monday", "2026-07-06T00:00:00Z",
        )
        .unwrap();
        assert_eq!(a.next_refresh_date.as_deref(), Some("2026-07-13"));

        // Overspend by 200 during week 1 (posted before the boundary so it draws down the old anchor).
        expense_tagged(&conn, "1200.00", "2026-07-08", Some(a.id));
        let pre = derived_balance(&conn, a.id, a.anchor_balance_minor, &a.last_refresh_date, today()).unwrap();
        assert_eq!(pre, -20_000);

        // On 2026-07-13 (the next_refresh_date), refresh_due tops it back up to target.
        let touched = refresh_due(&conn, "MUR", today()).unwrap();
        assert_eq!(touched, 1);
        let row = list(&conn).unwrap().into_iter().find(|r| r.id == a.id).unwrap();
        assert_eq!(row.anchor_balance_minor, 100_000, "healed to the full target");
        assert_eq!(row.last_refresh_date, "2026-07-13");
        assert_eq!(row.next_refresh_date.as_deref(), Some("2026-07-20"));
        let post = derived_balance(&conn, a.id, row.anchor_balance_minor, &row.last_refresh_date, today()).unwrap();
        assert_eq!(post, 100_000, "reading immediately after a funded refresh yields exactly the target");
    }

    #[test]
    fn refresh_skips_but_still_advances_when_underfunded() {
        let conn = db();
        deposit(&conn, "1000.00", "2026-07-01"); // Total 100_000 - just enough for ONE allowance
        let a = create(
            &conn, "MUR", NaiveDate::from_ymd_opt(2026, 7, 6).unwrap(), "Groceries", "MUR", 100_000,
            AllowanceKind::Recurring, Some(AllowancePeriod::Weekly), "monday", "2026-07-06T00:00:00Z",
        )
        .unwrap();
        // Spend exactly the whole anchor, so a refresh would need the FULL target again, but
        // Available is now 0 too (the same spend that zeroed the balance also zeroed Total).
        expense_tagged(&conn, "1000.00", "2026-07-08", Some(a.id));
        assert_eq!(available_minor(&conn, "MUR", today()).unwrap(), 0);

        let touched = refresh_due(&conn, "MUR", today()).unwrap();
        assert_eq!(touched, 1, "the allowance was due and processed, even though not funded");
        let row = list(&conn).unwrap().into_iter().find(|r| r.id == a.id).unwrap();
        assert_eq!(row.anchor_balance_minor, a.anchor_balance_minor, "anchor left unchanged when unfunded");
        assert_eq!(row.last_refresh_date, a.last_refresh_date, "last_refresh_date left unchanged when unfunded");
        assert_eq!(row.next_refresh_date.as_deref(), Some("2026-07-20"), "the pointer still advances (§6.2 decision 2)");

        // Not due again immediately (next_refresh_date is now in the future).
        assert_eq!(refresh_due(&conn, "MUR", today()).unwrap(), 0);
    }

    #[test]
    fn refresh_missed_periods_collapse_to_a_single_top_up() {
        let conn = db();
        deposit(&conn, "5000.00", "2026-05-01"); // well before creation, so it counts toward Total at creation time
        let a = create(
            &conn, "MUR", NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(), "Groceries", "MUR", 100_000,
            AllowanceKind::Recurring, Some(AllowancePeriod::Weekly), "monday", "2026-06-01T00:00:00Z",
        )
        .unwrap();
        expense_tagged(&conn, "300.00", "2026-06-02", Some(a.id)); // spend once, weeks ago

        // The app isn't opened again until well over a month later - still exactly ONE top-up.
        let much_later = NaiveDate::from_ymd_opt(2026, 7, 20).unwrap();
        let touched = refresh_due(&conn, "MUR", much_later).unwrap();
        assert_eq!(touched, 1, "missed periods collapse into a single refresh (§9.4)");
        let row = list(&conn).unwrap().into_iter().find(|r| r.id == a.id).unwrap();
        assert_eq!(row.anchor_balance_minor, 100_000);
        assert!(row.next_refresh_date.unwrap() > much_later.to_string());
    }

    #[test]
    fn refresh_anchors_at_the_boundary_so_late_entered_spend_still_counts() {
        // The T > B gap (Bug 1, ADR 0012 §5): the app is not opened exactly on the boundary day, so
        // a funded refresh normally fires strictly after it. This test fails against the old
        // `today`-anchored code (which would report the full 100_000 target, ignoring the spend
        // below) and passes once `last_refresh_date` is anchored at the boundary instead.
        let conn = db();
        deposit(&conn, "5000.00", "2026-07-01"); // Total 500_000, well before any boundary
        let created = NaiveDate::from_ymd_opt(2026, 7, 6).unwrap(); // a Monday
        let a = create(
            &conn, "MUR", created, "Groceries", "MUR", 100_000,
            AllowanceKind::Recurring, Some(AllowancePeriod::Weekly), "monday", "2026-07-06T00:00:00Z",
        )
        .unwrap();
        assert_eq!(a.next_refresh_date.as_deref(), Some("2026-07-13"));

        // The app isn't opened again until Wednesday 2026-07-15 - strictly after the 2026-07-13
        // boundary (T = 07-15 > B = 07-13). No overspend yet, so this refresh is funded trivially,
        // but it must still anchor `last_refresh_date` at the boundary, not at `today`.
        let t = NaiveDate::from_ymd_opt(2026, 7, 15).unwrap();
        let touched = refresh_due(&conn, "MUR", t).unwrap();
        assert_eq!(touched, 1);
        let row = list(&conn).unwrap().into_iter().find(|r| r.id == a.id).unwrap();
        assert_eq!(row.last_refresh_date, "2026-07-13", "anchored at the boundary, not today (ADR 0012 §5)");

        // A tagged expense dated the boundary Monday, entered AFTER the refresh ran (a back-dated
        // receipt / delayed OCR confirmation) - exactly the scenario the boundary fix protects.
        expense_tagged(&conn, "300.00", "2026-07-13", Some(a.id));

        let balance = derived_balance(&conn, a.id, row.anchor_balance_minor, &row.last_refresh_date, t).unwrap();
        assert_eq!(
            balance, 70_000,
            "current-period spend entered after a late lazy refresh must still draw the balance \
             down (this assertion fails under the old today-anchored code, which reports 100_000)"
        );
    }

    #[test]
    fn refresh_still_forgives_prior_period_spend_posted_before_the_boundary() {
        // Companion to the test above: boundary-anchoring must NOT resurrect prior-period spend -
        // set-to-target still discards the pre-refresh balance entirely.
        let conn = db();
        deposit(&conn, "5000.00", "2026-06-01");
        let created = NaiveDate::from_ymd_opt(2026, 7, 6).unwrap(); // a Monday
        let a = create(
            &conn, "MUR", created, "Groceries", "MUR", 100_000,
            AllowanceKind::Recurring, Some(AllowancePeriod::Weekly), "monday", "2026-07-06T00:00:00Z",
        )
        .unwrap();

        // Overspend by 200 during week 1, before the boundary.
        expense_tagged(&conn, "1200.00", "2026-07-08", Some(a.id));

        let t = NaiveDate::from_ymd_opt(2026, 7, 15).unwrap(); // Wednesday, T > B (boundary 07-13)
        refresh_due(&conn, "MUR", t).unwrap();
        let row = list(&conn).unwrap().into_iter().find(|r| r.id == a.id).unwrap();
        assert_eq!(row.last_refresh_date, "2026-07-13");

        // The prior-period overspend is forgiven (set-to-target discards the pre-refresh balance);
        // reading right after the refresh yields exactly target, not target minus that old spend.
        let balance = derived_balance(&conn, a.id, row.anchor_balance_minor, &row.last_refresh_date, t).unwrap();
        assert_eq!(balance, 100_000, "prior-period spend (posted before the boundary) is excluded/forgiven");
    }

    #[test]
    fn one_time_auto_closes_at_zero_and_leftover_returns_on_manual_pause() {
        let conn = db();
        deposit(&conn, "1000.00", "2026-07-01");
        let spent_fully = create(
            &conn, "MUR", today(), "Gadget fund", "MUR", 50_000,
            AllowanceKind::OneTime, None, "monday", "2026-07-13T00:00:00Z",
        )
        .unwrap();
        expense_tagged(&conn, "500.00", "2026-07-13", Some(spent_fully.id)); // exactly spent -> 0

        let leftover = create(
            &conn, "MUR", today(), "Untouched", "MUR", 30_000,
            AllowanceKind::OneTime, None, "monday", "2026-07-13T00:00:00Z",
        )
        .unwrap();

        let touched = refresh_due(&conn, "MUR", today()).unwrap();
        assert_eq!(touched, 1, "only the fully-spent one-time allowance auto-closes");
        let closed = list(&conn).unwrap().into_iter().find(|r| r.id == spent_fully.id).unwrap();
        assert!(!closed.active);
        let still_open = list(&conn).unwrap().into_iter().find(|r| r.id == leftover.id).unwrap();
        assert!(still_open.active, "a one-time allowance with a positive balance does not auto-close");

        // Manually pausing the untouched one-time allowance returns its leftover to Available.
        let before = available_minor(&conn, "MUR", today()).unwrap();
        set_active(&conn, "MUR", today(), leftover.id, false).unwrap();
        assert_eq!(available_minor(&conn, "MUR", today()).unwrap(), before + 30_000);
    }

    #[test]
    fn available_reconciles_with_dashboard_total_across_confirmed_pending_and_future_rows() {
        let conn = db();
        deposit(&conn, "5000.00", "2026-07-01"); // Total 500_000

        let a = create(
            &conn, "MUR", today(), "Groceries", "MUR", 100_000,
            AllowanceKind::OneTime, None, "monday", "2026-07-13T00:00:00Z",
        )
        .unwrap();

        // A pending-review tagged expense must not move the derived balance (§13.1).
        let pending_id = expense_tagged(&conn, "40.00", "2026-07-13", Some(a.id));
        conn.execute("UPDATE transactions SET pending_review = 1 WHERE id = ?1", params![pending_id]).unwrap();

        // A future-dated tagged expense must not move the derived balance either.
        expense_tagged(&conn, "40.00", "2026-12-25", Some(a.id));

        let balance = derived_balance(&conn, a.id, a.anchor_balance_minor, &a.last_refresh_date, today()).unwrap();
        assert_eq!(balance, 100_000, "neither the pending-review nor the future-dated tagged row moved the balance");

        let total = super::super::dashboard::total_balance(&conn, "MUR", today()).unwrap();
        let reserved = allowances_reserved_minor(&conn, "MUR", today()).unwrap();
        let available = available_minor(&conn, "MUR", today()).unwrap();
        assert_eq!(total, 500_000, "the pending-review and future-dated rows are excluded from Total too");
        assert_eq!(reserved, 100_000);
        assert_eq!(available, total - reserved, "Available = Total - Reserved reconciles exactly");
    }

    #[test]
    fn summary_lists_all_allowances_but_only_totals_active_ones() {
        let conn = db();
        deposit(&conn, "1000.00", "2026-07-01");
        let active = create(
            &conn, "MUR", today(), "Groceries", "MUR", 60_000,
            AllowanceKind::OneTime, None, "monday", "2026-07-13T00:00:00Z",
        )
        .unwrap();
        let paused = create(
            &conn, "MUR", today(), "Transport", "MUR", 20_000,
            AllowanceKind::OneTime, None, "monday", "2026-07-13T00:00:00Z",
        )
        .unwrap();
        set_active(&conn, "MUR", today(), paused.id, false).unwrap();

        let summary = allowance_summary(&conn, "MUR", today()).unwrap();
        assert_eq!(summary.total_minor, 100_000);
        assert_eq!(summary.reserved_minor, 60_000, "only the active allowance counts");
        assert_eq!(summary.available_minor, 40_000);
        assert_eq!(summary.allowances.len(), 2, "both active and paused allowances are listed for display");
        let paused_line = summary.allowances.iter().find(|l| l.id == paused.id).unwrap();
        assert_eq!(paused_line.reserved_minor, 0, "a paused allowance's line reports 0 reserved");
        let active_line = summary.allowances.iter().find(|l| l.id == active.id).unwrap();
        assert_eq!(active_line.reserved_minor, 60_000);
    }
}
