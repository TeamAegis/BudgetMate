//! Home dashboard aggregate (issue #50). Pure, DB-free: `db::dashboard` reads rows and this module
//! does all the money math and month-end bucketing. Money semantics (validated by `/finance-check`,
//! see CLAUDE.md issue #50 discussion - kept here as the single source of truth):
//!
//! - Everything is computed **as of `today`**: a confirmed transaction dated in the future is not
//!   counted until its date arrives (see `db::dashboard`, which filters rows to `posted_date <=
//!   today` before this module ever sees them). This keeps the hero total and `balance_trend`'s
//!   current-month point in exact agreement - both are "as of today", never "as of whenever the
//!   last confirmed row happens to be dated".
//! - **Total balance** (base currency) = the sum of base-currency accounts' opening balances, PLUS
//!   every `pending_review = 0`, not-future-dated transaction's own `base_amount_minor` (already
//!   fx-correct) across ALL accounts, regardless of the account's own currency. Foreign-currency
//!   accounts' openings are excluded (there is no stored fx rate for an opening balance, so it
//!   cannot be honestly converted) - but their transactions still count, since each transaction
//!   carries its own `base_amount_minor`. Accounts are NOT filtered by `archived` - archiving only
//!   hides an account from pickers; its historical money is still real.
//! - **Usable balance** = total balance minus the `current_minor` of every ONGOING (not completed),
//!   base-currency goal (foreign-currency goals are excluded from the netting, same fx reasoning),
//!   minus `allowances_reserved_minor` (ADR 0012: `sum(max(0, derived balance))` over active,
//!   base-currency allowances - the same figure the allowance savings gate enforces, computed once
//!   in `db::allowances::allowances_reserved_minor`, never a second inlined copy). It MAY be
//!   negative (over-committed) - never clamp it.
//! - **Balance trend** is the TOTAL balance (never usable) at each of the trailing 6 months' ends,
//!   as of `today` (never past it), because goals have no history table, so a past "usable balance"
//!   is unreconstructable, while total balance IS exactly reconstructable from the ledger.
//!
//! All money stays integer minor units; no floats anywhere in this module.

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};

use crate::domain::goal::Goal;

/// One point on the trailing balance-trend chart (mirrors TS `BalancePoint`): a short Rust-
/// formatted month label (e.g. "Jul") and the TOTAL balance (see module doc) at that month's end.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BalancePoint {
    pub label: String,
    pub amount_minor: i64,
}

/// The Home dashboard aggregate (mirrors TS `DashboardData`, from `get_dashboard`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardData {
    pub base_currency: String,
    pub total_balance_minor: i64,
    pub usable_balance_minor: i64,
    /// The amount netted out of `total_balance_minor` to reach `usable_balance_minor` (the
    /// "set aside for goals" figure) - the sum of ongoing, base-currency goals' `current_minor`.
    pub goals_reserved_minor: i64,
    /// The amount netted out of `total_balance_minor` for active, base-currency allowances (ADR
    /// 0012) - `sum(max(0, derived balance))`, the same figure `db::allowances::available_minor`
    /// uses for the savings gate.
    pub allowances_reserved_minor: i64,
    pub this_month_spend_minor: i64,
    /// Trailing 6 months, oldest first, last point = the current month.
    pub balance_trend: Vec<BalancePoint>,
    /// Top few ongoing goals for the Home preview (see `db::dashboard` for the count/ordering).
    pub goals: Vec<Goal>,
    /// Count of non-archived accounts in a currency other than `base_currency` (excluded from the
    /// opening-balance sum).
    pub excluded_accounts: i64,
    /// Count of ongoing goals in a currency other than `base_currency` (excluded from the netting).
    pub excluded_goals: i64,
    /// True when there is nothing to show yet: no confirmed transactions, a zero total balance,
    /// and no ongoing goals - drives the Home teaching-empty state.
    pub is_empty: bool,
}

/// Add (or subtract, for negative `months`) whole calendar months to the first of `date`'s month,
/// correctly rolling over year boundaries. Mirrors `domain::report::add_months` (kept as a small,
/// separately-testable copy rather than making the report module's private helper `pub(crate)`).
fn add_months(date: NaiveDate, months: i32) -> NaiveDate {
    let total = date.year() * 12 + (date.month() as i32 - 1) + months;
    let year = total.div_euclid(12);
    let month = total.rem_euclid(12) + 1;
    NaiveDate::from_ymd_opt(year, month as u32, 1).expect("first-of-month date is always valid")
}

fn first_of_month(date: NaiveDate) -> NaiveDate {
    date.with_day(1).expect("day 1 is always valid")
}

/// Compute the trailing 6 month-end TOTAL-balance points (oldest first, last = the current month
/// containing `today`). For each month, the point is `base_opening_sum` (the base-currency
/// accounts' opening balances - constant across all points, it has no date) plus every row's
/// `base_amount_minor` whose `posted_date` falls strictly before the first day of the month AFTER
/// that point's month (i.e. "as of that month's end"). `rows` is expected to already be filtered
/// to `posted_date <= today` by the caller (`db::dashboard`) - a future-dated row must never
/// appear here, so the current-month point always equals the caller's "as of today" hero total.
/// Pure and deterministic - takes `today` rather than reading the clock, so it is unit-testable
/// without mocking time.
///
/// ```
/// use app_lib::domain::dashboard::balance_trend;
/// use chrono::NaiveDate;
///
/// let d = |y, m, day| NaiveDate::from_ymd_opt(y, m, day).unwrap();
/// let today = d(2026, 7, 13);
/// let rows = vec![(d(2026, 7, 5), 1_000)];
/// let points = balance_trend(today, 0, &rows);
/// assert_eq!(points.len(), 6);
/// assert_eq!(points.last().unwrap().label, "Jul");
/// assert_eq!(points.last().unwrap().amount_minor, 1_000);
/// // The row posted in July has not happened yet as of March's end.
/// assert_eq!(points[0].amount_minor, 0);
/// ```
pub fn balance_trend(today: NaiveDate, base_opening_sum: i64, rows: &[(NaiveDate, i64)]) -> Vec<BalancePoint> {
    let current_month_start = first_of_month(today);
    (0..6)
        .map(|i| {
            let month_start = add_months(current_month_start, i - 5);
            let cutoff = add_months(month_start, 1); // first day of the month AFTER this point.
            let ledger_sum: i64 = rows.iter().filter(|(d, _)| *d < cutoff).map(|(_, amt)| amt).sum();
            BalancePoint {
                label: month_start.format("%b").to_string(),
                amount_minor: base_opening_sum + ledger_sum,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn trend_points_are_month_end_running_totals_normal_months() {
        let today = d(2026, 7, 13);
        // One transaction each in Jan (well before the window), May, and July.
        let rows = vec![(d(2026, 1, 15), 500), (d(2026, 5, 10), 200), (d(2026, 7, 5), 100)];
        let points = balance_trend(today, 1_000, &rows);

        assert_eq!(points.len(), 6);
        let labels: Vec<&str> = points.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(labels, vec!["Feb", "Mar", "Apr", "May", "Jun", "Jul"]);

        // Feb/Mar/Apr: only the Jan row (500) has happened -> 1_000 + 500.
        assert_eq!(points[0].amount_minor, 1_500, "Feb");
        assert_eq!(points[1].amount_minor, 1_500, "Mar");
        assert_eq!(points[2].amount_minor, 1_500, "Apr");
        // May onward: the May row (200) has also happened.
        assert_eq!(points[3].amount_minor, 1_700, "May");
        assert_eq!(points[4].amount_minor, 1_700, "Jun");
        // July: the July row (100) has also happened.
        assert_eq!(points[5].amount_minor, 1_800, "Jul (current month)");
    }

    #[test]
    fn trend_handles_year_boundary_rollover() {
        // Today is January 2026 - the trailing 6 months span back into 2025.
        let today = d(2026, 1, 15);
        let points = balance_trend(today, 0, &[]);
        let labels: Vec<&str> = points.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(labels, vec!["Aug", "Sep", "Oct", "Nov", "Dec", "Jan"]);
    }

    #[test]
    fn empty_ledger_all_points_equal_the_opening_baseline() {
        let today = d(2026, 7, 13);
        let points = balance_trend(today, 42_000, &[]);
        assert_eq!(points.len(), 6);
        assert!(points.iter().all(|p| p.amount_minor == 42_000));
    }

    #[test]
    fn cumulative_behaviour_is_monotonic_for_pure_additions() {
        // Every row is a positive amount (e.g. only income/deposits) - the running total across the
        // 6 trailing points must never decrease.
        let today = d(2026, 7, 13);
        let rows = vec![(d(2026, 2, 1), 100), (d(2026, 4, 1), 50), (d(2026, 6, 15), 25)];
        let points = balance_trend(today, 10, &rows);
        for pair in points.windows(2) {
            assert!(
                pair[1].amount_minor >= pair[0].amount_minor,
                "balance trend must be non-decreasing when every row is a positive amount"
            );
        }
        assert_eq!(points.last().unwrap().amount_minor, 10 + 100 + 50 + 25);
    }

    #[test]
    fn dashboard_data_round_trips_camel_case_fields() {
        let data = DashboardData {
            base_currency: "MUR".into(),
            total_balance_minor: 465_000,
            usable_balance_minor: 415_000,
            goals_reserved_minor: 40_000,
            allowances_reserved_minor: 10_000,
            this_month_spend_minor: 50_000,
            balance_trend: vec![BalancePoint { label: "Jul".into(), amount_minor: 465_000 }],
            goals: vec![Goal {
                id: 1,
                name: "Vacation".into(),
                target_minor: 100_000,
                current_minor: 40_000,
                currency: "MUR".into(),
                target_date: None,
                completed: false,
            }],
            excluded_accounts: 1,
            excluded_goals: 1,
            is_empty: false,
        };
        let json = serde_json::to_value(&data).unwrap();
        assert_eq!(json["baseCurrency"], "MUR");
        assert_eq!(json["totalBalanceMinor"], 465_000);
        assert_eq!(json["usableBalanceMinor"], 415_000);
        assert_eq!(json["goalsReservedMinor"], 40_000);
        assert_eq!(json["allowancesReservedMinor"], 10_000);
        assert_eq!(json["thisMonthSpendMinor"], 50_000);
        assert_eq!(json["balanceTrend"][0]["label"], "Jul");
        assert_eq!(json["balanceTrend"][0]["amountMinor"], 465_000);
        assert_eq!(json["goals"][0]["targetMinor"], 100_000);
        assert_eq!(json["excludedAccounts"], 1);
        assert_eq!(json["excludedGoals"], 1);
        assert_eq!(json["isEmpty"], false);

        // Round-trip back.
        let back: DashboardData = serde_json::from_value(json).unwrap();
        assert_eq!(back, data);
    }
}
