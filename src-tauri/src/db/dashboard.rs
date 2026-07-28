//! Home dashboard aggregation (issue #50). Reads the rows the pure `domain::dashboard` math needs
//! and delegates ALL money math/bucketing to it (and to the already-tested `db::reports::report`
//! for this-month spend). See `domain::dashboard` for the exact, `/finance-check`-validated money
//! semantics - this module only selects/filters rows.
//!
//! Everything here is computed **as of `today`**: a confirmed transaction dated in the future is
//! not counted yet (it has not happened), so it is filtered out of both `total_balance_minor` and
//! `balance_trend` at the same point, keeping the hero total and the trend's current-month point
//! in exact agreement.
//!
//! `total_balance` below is `Total` (ADR 0012 decision 1): the SAME base-currency ledger balance
//! definition is used here AND by the allowance reservation engine (`db::allowances`) - never a
//! second, separately-inlined copy of this accounting basis.

use chrono::NaiveDate;
use rusqlite::{params, Connection};

use super::DbError;
use crate::domain::dashboard::{balance_trend, DashboardData};
use crate::domain::report::{resolve_period, ReportPeriod};

const ISO_DATE: &str = "%Y-%m-%d";
/// Top few ongoing goals shown in the Home preview.
const GOALS_PREVIEW_COUNT: usize = 3;

/// Base-currency accounts' opening balances - NOT filtered by archived (CLAUDE.md: archiving only
/// hides an account from pickers; its historical money is still real).
fn base_opening_sum(conn: &Connection, base_currency: &str) -> Result<i64, DbError> {
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(opening_balance_minor), 0) FROM accounts WHERE currency = ?1",
        params![base_currency],
        |r| r.get(0),
    )?)
}

/// Every CONFIRMED transaction's own (already fx-correct) base amount, across ALL accounts, paired
/// with its parsed posted date - pending_review rows are unconfirmed dedup candidates and never
/// count (matches db::reports). Only rows dated on or before `today` count: a transaction dated in
/// the future has not happened yet. This is the shared row source for `total_balance` and the
/// dashboard's `balance_trend` - both must see the exact same set of rows.
fn confirmed_ledger_rows(conn: &Connection, today: NaiveDate) -> Result<Vec<(NaiveDate, i64)>, DbError> {
    let mut stmt =
        conn.prepare("SELECT posted_date, base_amount_minor FROM transactions WHERE pending_review = 0")?;
    let raw_rows = stmt
        .query_map([], |row| {
            let posted_date: String = row.get(0)?;
            let base_amount_minor: i64 = row.get(1)?;
            Ok((posted_date, base_amount_minor))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);

    let mut rows = Vec::with_capacity(raw_rows.len());
    for (date_str, amount_minor) in raw_rows {
        let date = NaiveDate::parse_from_str(&date_str, ISO_DATE).map_err(|_| {
            DbError::Invalid(format!("invalid posted date stored on a transaction: {date_str}"))
        })?;
        if date > today {
            continue;
        }
        rows.push((date, amount_minor));
    }
    Ok(rows)
}

/// `Total` (ADR 0012 decision 1): the base-currency ledger balance as of `today` - base-currency
/// account openings plus every confirmed, not-future-dated transaction's own base amount, across
/// all accounts. The single definition of `Total` shared by the dashboard and the allowance
/// reservation engine (`db::allowances::available_minor`) - never compute this a second way.
pub fn total_balance(conn: &Connection, base_currency: &str, today: NaiveDate) -> Result<i64, DbError> {
    let opening = base_opening_sum(conn, base_currency)?;
    let ledger_sum: i64 = confirmed_ledger_rows(conn, today)?.iter().map(|(_, amount)| amount).sum();
    Ok(opening + ledger_sum)
}

/// Aggregate the Home dashboard for `base_currency` as of `today`. Read-only (no transaction
/// needed - see `.claude/rules/database.md`, ACID applies to writes).
pub fn dashboard(conn: &Connection, base_currency: &str, today: NaiveDate) -> Result<DashboardData, DbError> {
    let opening = base_opening_sum(conn, base_currency)?;

    // Non-archived accounts in a foreign currency - their openings can't be honestly converted (no
    // stored fx rate for an opening balance), so they are counted here for the UI's caveat note.
    let excluded_accounts: i64 = conn.query_row(
        "SELECT count(*) FROM accounts WHERE currency != ?1 AND archived = 0",
        params![base_currency],
        |r| r.get(0),
    )?;

    // Filtering to `posted_date <= today` here keeps the hero total and `balance_trend`'s
    // current-month point in exact agreement (see the regression test below).
    let tx_rows = confirmed_ledger_rows(conn, today)?;
    let has_confirmed_transactions = !tx_rows.is_empty();
    let ledger_sum: i64 = tx_rows.iter().map(|(_, amount)| amount).sum();
    let total_balance_minor = opening + ledger_sum;

    // Ongoing (not completed) goals, split by base- vs foreign-currency for the netting/caveat.
    let all_goals = super::goals::list(conn)?;
    let ongoing: Vec<_> = all_goals.into_iter().filter(|g| !g.completed).collect();
    let has_ongoing_goals = !ongoing.is_empty();
    // Same sum `db::goals::reserved_minor` computes - kept as a filter over the already-fetched
    // `ongoing` list here (rather than a second query) since this function also needs `ongoing` for
    // `excludedGoals` and the Home preview.
    let goals_reserved_minor: i64 =
        ongoing.iter().filter(|g| g.currency == base_currency).map(|g| g.current_minor).sum();
    let excluded_goals = ongoing.iter().filter(|g| g.currency != base_currency).count() as i64;
    let allowances_reserved_minor = super::allowances::allowances_reserved_minor(conn, base_currency, today)?;
    let usable_balance_minor = total_balance_minor - goals_reserved_minor - allowances_reserved_minor;
    let goals_preview: Vec<_> = ongoing.into_iter().take(GOALS_PREVIEW_COUNT).collect();

    // This-month spend: reuse the tested Analytics aggregation rather than re-deriving spend logic.
    let bounds = resolve_period(ReportPeriod::ThisMonth, today);
    let report = super::reports::report(conn, ReportPeriod::ThisMonth, bounds, None, base_currency)?;
    let this_month_spend_minor = report.total_spend_minor;

    let balance_trend_points = balance_trend(today, opening, &tx_rows);

    let is_empty = !has_confirmed_transactions
        && total_balance_minor == 0
        && !has_ongoing_goals
        && excluded_accounts == 0;

    Ok(DashboardData {
        base_currency: base_currency.to_string(),
        total_balance_minor,
        usable_balance_minor,
        goals_reserved_minor,
        allowances_reserved_minor,
        this_month_spend_minor,
        balance_trend: balance_trend_points,
        goals: goals_preview,
        excluded_accounts,
        excluded_goals,
        is_empty,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::accounts;
    use crate::db::goals;
    use crate::db::transactions::{self, SplitInput, TxInput};
    use crate::domain::account::AccountKind;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        super::super::run_migrations(&conn, "2026-07-01T00:00:00Z").unwrap();
        super::super::seed_defaults(&conn).unwrap();
        conn
    }

    // Seeded defaults: account id 1 = Cash (MUR, opening 0); category 1 = Groceries (expense),
    // 9 = Salary (income).

    #[test]
    fn aggregates_balance_goals_and_spend_excluding_pending_review_and_foreign_currency() {
        let conn = db();

        // Accounts: the seeded Cash (MUR, opening 0), plus a foreign-currency wallet (excluded from
        // the opening sum + counted as an excluded account) and an ARCHIVED base-currency account
        // (its opening still counts - archiving never drops history).
        accounts::create(&conn, "Savings", AccountKind::Bank, "MUR", 10_000).unwrap();
        let usd_wallet = accounts::create(&conn, "USD Wallet", AccountKind::Wallet, "USD", 50_000).unwrap();
        let old_mur = accounts::create(&conn, "Old MUR", AccountKind::Bank, "MUR", 5_000).unwrap();
        accounts::archive(&conn, old_mur.id).unwrap();
        let _ = usd_wallet; // only needed to exist + be non-archived + foreign-currency

        // Transactions, all on the seeded MUR Cash account (id 1):
        // - an expense (Groceries, category 1): -5_000 base minor.
        transactions::create(
            &conn,
            TxInput {
                account_id: 1,
                posted_date: "2026-07-05",
                amount: "50.00",
                currency: None,
                fx_rate: None,
                splits: &[SplitInput { category_id: 1, amount: "50.00" }],
                payee: None,
                note: None,
            },
            "2026-07-05T00:00:00Z",
        )
        .unwrap();
        // - an income (Salary, category 9): +500_000 base minor.
        transactions::create(
            &conn,
            TxInput {
                account_id: 1,
                posted_date: "2026-07-06",
                amount: "5000.00",
                currency: None,
                fx_rate: None,
                splits: &[SplitInput { category_id: 9, amount: "5000.00" }],
                payee: None,
                note: None,
            },
            "2026-07-06T00:00:00Z",
        )
        .unwrap();
        // - a FOREIGN-currency expense recorded on the base-currency (MUR) account: 10.00 USD @ fx
        //   45 -> base_amount_minor = round(1_000 * 45) = 45_000, signed negative (expense). Its
        //   own base_amount_minor is fx-correct, so it counts even though the account is MUR and
        //   the transaction currency is not.
        transactions::create(
            &conn,
            TxInput {
                account_id: 1,
                posted_date: "2026-07-07",
                amount: "10.00",
                currency: Some("USD"),
                fx_rate: Some("45"),
                splits: &[SplitInput { category_id: 1, amount: "10.00" }],
                payee: None,
                note: None,
            },
            "2026-07-07T00:00:00Z",
        )
        .unwrap();
        // - a pending-review expense that must be excluded entirely (unconfirmed dedup candidate).
        let pending = transactions::create(
            &conn,
            TxInput {
                account_id: 1,
                posted_date: "2026-07-08",
                amount: "999.00",
                currency: None,
                fx_rate: None,
                splits: &[SplitInput { category_id: 1, amount: "999.00" }],
                payee: None,
                note: None,
            },
            "2026-07-08T00:00:00Z",
        )
        .unwrap();
        conn.execute(
            "UPDATE transactions SET pending_review = 1 WHERE id = ?1",
            params![pending.id],
        )
        .unwrap();

        // Goals: an ongoing MUR goal (counts toward reserved), a completed MUR goal (never counts,
        // completed goals are not "ongoing"), and an ongoing USD goal (excluded from reserved, but
        // counted in excludedGoals).
        goals::create(&conn, "Vacation", 100_000, 40_000, "MUR", None).unwrap();
        goals::create(&conn, "Emergency fund", 50_000, 50_000, "MUR", None).unwrap();
        goals::create(&conn, "Gadget", 20_000, 10_000, "USD", None).unwrap();

        let today = NaiveDate::from_ymd_opt(2026, 7, 13).unwrap();
        let data = dashboard(&conn, "MUR", today).unwrap();

        assert_eq!(data.base_currency, "MUR");
        // Openings: Cash(0) + Savings(10_000) + Old MUR archived(5_000) = 15_000 (USD wallet
        // excluded). Ledger (pending_review = 0 only): -5_000 + 500_000 - 45_000 = 450_000.
        assert_eq!(data.total_balance_minor, 465_000, "openings + confirmed ledger, foreign wallet's opening and the pending-review row both excluded");
        assert_eq!(data.goals_reserved_minor, 40_000, "only the ongoing MUR goal - the completed one and the USD one are excluded");
        assert_eq!(data.usable_balance_minor, 425_000, "total minus goals_reserved");
        assert_eq!(data.this_month_spend_minor, 50_000, "5_000 + 45_000 expense magnitude, income and pending-review excluded");
        assert_eq!(data.excluded_accounts, 1, "the non-archived USD wallet only");
        assert_eq!(data.excluded_goals, 1, "the ongoing USD goal only - the completed MUR goal isn't ongoing at all");
        assert_eq!(data.goals.len(), 2, "both ongoing goals fit in the top-3 preview");
        assert!(data.goals.iter().all(|g| !g.completed));
        assert!(!data.is_empty);
    }

    #[test]
    fn empty_vault_reports_is_empty_true() {
        let conn = db();
        let today = NaiveDate::from_ymd_opt(2026, 7, 13).unwrap();
        let data = dashboard(&conn, "MUR", today).unwrap();
        assert_eq!(data.total_balance_minor, 0);
        assert_eq!(data.goals.len(), 0);
        assert!(data.is_empty);
    }

    #[test]
    fn future_dated_transaction_is_excluded_from_balance_and_trend_matches_hero_total() {
        let conn = db();

        // Confirmed, but dated in a month AFTER "today" - must not count yet.
        transactions::create(
            &conn,
            TxInput {
                account_id: 1,
                posted_date: "2026-12-01",
                amount: "1000.00",
                currency: None,
                fx_rate: None,
                splits: &[SplitInput { category_id: 9, amount: "1000.00" }],
                payee: None,
                note: None,
            },
            "2026-07-13T00:00:00Z",
        )
        .unwrap();

        let today = NaiveDate::from_ymd_opt(2026, 7, 13).unwrap();
        let data = dashboard(&conn, "MUR", today).unwrap();

        assert_eq!(
            data.total_balance_minor, 0,
            "a confirmed transaction dated in a future month must not inflate today's balance"
        );
        let last_trend_point = data.balance_trend.last().unwrap();
        assert_eq!(
            last_trend_point.amount_minor, data.total_balance_minor,
            "the hero total must exactly equal the trend's current-month point"
        );
    }

    #[test]
    fn foreign_only_account_vault_is_not_reported_empty() {
        let conn = db();
        // The vault's only setup is a non-archived foreign-currency account with a nonzero
        // opening balance - it must not be hidden behind the teaching-empty state.
        accounts::create(&conn, "USD Wallet", AccountKind::Wallet, "USD", 50_000).unwrap();

        let today = NaiveDate::from_ymd_opt(2026, 7, 13).unwrap();
        let data = dashboard(&conn, "MUR", today).unwrap();

        assert_eq!(data.total_balance_minor, 0, "the foreign account's opening is excluded from the base total");
        assert_eq!(data.excluded_accounts, 1);
        assert!(!data.is_empty, "a foreign-currency-only account must not be invisible behind the empty state");
    }
}
