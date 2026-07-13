//! Reporting aggregations (FR-3.3): spend-by-category and spend-over-time. Pure, DB-free logic -
//! the DB layer (`db::reports`) supplies already-converted `SpendRow`s (base-currency minor units,
//! expense splits only, `pending_review` excluded) and this module only groups/sums/labels them.
//! Money stays integer minor units throughout; no floats.

use chrono::{Datelike, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A period preset for the Analytics period filter (mirrors TS `ReportPeriod`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReportPeriod {
    ThisMonth,
    Last3Months,
    ThisYear,
    AllTime,
}

/// Time-bucket size for the spend-over-time chart (mirrors TS `Granularity`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Granularity {
    Day,
    Week,
    Month,
}

/// One expense split already converted to base-currency minor units (a positive money-out
/// magnitude - the DB layer takes `abs()` of the signed split amount after fx conversion).
#[derive(Debug, Clone)]
pub struct SpendRow {
    pub category_id: i64,
    pub category_name: String,
    pub base_amount_minor: i64,
    pub posted_date: NaiveDate,
}

/// Total spend for one category over the report period (mirrors TS `CategorySpend`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorySpend {
    pub category_id: i64,
    pub category_name: String,
    pub amount_minor: i64,
}

/// Total spend for one time bucket (mirrors TS `TimeBucket`). `label` is a short display string
/// (e.g. "13 Jul", "Wk of 07 Jul", "Jul 2026") generated in Rust so the frontend never derives date
/// formatting itself; `startDate` is the bucket's first day in ISO `YYYY-MM-DD` for any caller that
/// needs the raw value (sorting, tests).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeBucket {
    pub label: String,
    pub start_date: String,
    pub amount_minor: i64,
}

/// The full Analytics report (mirrors TS `ReportData`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportData {
    pub base_currency: String,
    pub period: ReportPeriod,
    pub total_spend_minor: i64,
    pub by_category: Vec<CategorySpend>,
    pub over_time: Vec<TimeBucket>,
    pub granularity: Granularity,
}

/// Add (or subtract, for a negative `months`) whole calendar months to the first of `date`'s
/// month, correctly rolling over year boundaries (e.g. Nov 2025 + 3 -> Feb 2026).
fn add_months(date: NaiveDate, months: i32) -> NaiveDate {
    let total = date.year() * 12 + (date.month() as i32 - 1) + months;
    let year = total.div_euclid(12);
    let month = total.rem_euclid(12) + 1;
    NaiveDate::from_ymd_opt(year, month as u32, 1).expect("first-of-month date is always valid")
}

/// Resolve a `ReportPeriod` preset into `[start, end)` (end EXCLUSIVE) relative to `today`. Pure -
/// takes `today` as a parameter rather than reading the clock, so it is deterministically testable.
/// `AllTime` has no bounds (`None`): the caller passes an unfiltered date range to the DB query.
///
/// ```
/// use app_lib::domain::report::{resolve_period, ReportPeriod};
/// use chrono::NaiveDate;
///
/// let today = NaiveDate::from_ymd_opt(2026, 7, 13).unwrap();
/// assert_eq!(
///     resolve_period(ReportPeriod::ThisMonth, today),
///     Some((
///         NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
///         NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
///     ))
/// );
/// assert_eq!(resolve_period(ReportPeriod::AllTime, today), None);
/// ```
pub fn resolve_period(period: ReportPeriod, today: NaiveDate) -> Option<(NaiveDate, NaiveDate)> {
    match period {
        ReportPeriod::AllTime => None,
        ReportPeriod::ThisMonth => {
            let start = today.with_day(1).expect("day 1 is always valid");
            Some((start, add_months(start, 1)))
        }
        ReportPeriod::Last3Months => {
            let this_month_start = today.with_day(1).expect("day 1 is always valid");
            // Include the current (possibly partial) month plus the two before it = 3 months.
            let start = add_months(this_month_start, -2);
            Some((start, add_months(this_month_start, 1)))
        }
        ReportPeriod::ThisYear => {
            let start = NaiveDate::from_ymd_opt(today.year(), 1, 1).expect("valid date");
            let end = NaiveDate::from_ymd_opt(today.year() + 1, 1, 1).expect("valid date");
            Some((start, end))
        }
    }
}

/// Pick a time-bucket size from the resolved period span: short spans get daily buckets, medium
/// spans weekly, long (or unbounded/`AllTime`) spans monthly - otherwise a year of daily points (or
/// an all-time report) would overwhelm the line chart.
///
/// ```
/// use app_lib::domain::report::{choose_granularity, Granularity};
/// use chrono::NaiveDate;
///
/// let d = |y, m, day| NaiveDate::from_ymd_opt(y, m, day).unwrap();
/// assert_eq!(choose_granularity(Some((d(2026, 7, 1), d(2026, 8, 1)))), Granularity::Day);
/// assert_eq!(choose_granularity(Some((d(2026, 5, 1), d(2026, 8, 1)))), Granularity::Week);
/// assert_eq!(choose_granularity(Some((d(2026, 1, 1), d(2027, 1, 1)))), Granularity::Month);
/// assert_eq!(choose_granularity(None), Granularity::Month);
/// ```
pub fn choose_granularity(bounds: Option<(NaiveDate, NaiveDate)>) -> Granularity {
    match bounds {
        None => Granularity::Month,
        Some((start, end_excl)) => {
            let span_days = (end_excl - start).num_days();
            if span_days <= 31 {
                Granularity::Day
            } else if span_days <= 120 {
                Granularity::Week
            } else {
                Granularity::Month
            }
        }
    }
}

/// Sum spend per category, sorted by amount descending (highest spend first), ties broken by
/// category name (case-insensitive) so the order is deterministic.
///
/// ```
/// use app_lib::domain::report::{spend_by_category, SpendRow};
/// use chrono::NaiveDate;
///
/// let d = NaiveDate::from_ymd_opt(2026, 7, 1).unwrap();
/// let rows = vec![
///     SpendRow { category_id: 1, category_name: "Groceries".into(), base_amount_minor: 1_000, posted_date: d },
///     SpendRow { category_id: 2, category_name: "Dining".into(), base_amount_minor: 2_000, posted_date: d },
///     SpendRow { category_id: 1, category_name: "Groceries".into(), base_amount_minor: 500, posted_date: d },
/// ];
/// let totals = spend_by_category(&rows);
/// assert_eq!(totals[0].category_name, "Dining");
/// assert_eq!(totals[0].amount_minor, 2_000);
/// assert_eq!(totals[1].category_name, "Groceries");
/// assert_eq!(totals[1].amount_minor, 1_500);
/// ```
pub fn spend_by_category(rows: &[SpendRow]) -> Vec<CategorySpend> {
    // BTreeMap keyed by category_id keeps grouping deterministic before the final sort.
    let mut totals: BTreeMap<i64, (String, i64)> = BTreeMap::new();
    for r in rows {
        let entry =
            totals.entry(r.category_id).or_insert_with(|| (r.category_name.clone(), 0));
        entry.1 += r.base_amount_minor;
    }
    let mut out: Vec<CategorySpend> = totals
        .into_iter()
        .map(|(category_id, (category_name, amount_minor))| CategorySpend {
            category_id,
            category_name,
            amount_minor,
        })
        .collect();
    out.sort_by(|a, b| {
        b.amount_minor
            .cmp(&a.amount_minor)
            .then_with(|| a.category_name.to_lowercase().cmp(&b.category_name.to_lowercase()))
    });
    out
}

/// The first day of `date`'s bucket at `granularity` (day = itself, week = that week's Monday,
/// month = the 1st of that month).
fn bucket_start(date: NaiveDate, granularity: Granularity) -> NaiveDate {
    match granularity {
        Granularity::Day => date,
        Granularity::Week => date.week(Weekday::Mon).first_day(),
        Granularity::Month => date.with_day(1).expect("day 1 is always valid"),
    }
}

fn bucket_label(start: NaiveDate, granularity: Granularity) -> String {
    match granularity {
        Granularity::Day => start.format("%d %b").to_string(),
        Granularity::Week => format!("Wk of {}", start.format("%d %b")),
        Granularity::Month => start.format("%b %Y").to_string(),
    }
}

/// Bucket spend by `granularity` and sum each bucket, in chronological order.
///
/// Design choice (documented, not left implicit): buckets are only emitted for periods that
/// actually have spend - a day/week/month with zero spend is simply absent rather than emitted as
/// a zero-amount bucket. This keeps the response compact (an `AllTime` report over years of sparse
/// data would otherwise carry thousands of empty daily buckets) and the aggregation trivially
/// deterministic (a `BTreeMap` grouped by bucket start, sorted for free by `NaiveDate: Ord`). The
/// line chart connects the points it is given, which for a budgeting app (spend is inherently
/// bursty - rent once a month, groceries a few times a week) reads the same as a filled series
/// would for the granularities we choose (§`choose_granularity`), without the extra payload.
///
/// ```
/// use app_lib::domain::report::{spend_over_time, Granularity, SpendRow};
/// use chrono::NaiveDate;
///
/// let d1 = NaiveDate::from_ymd_opt(2026, 7, 1).unwrap();
/// let d2 = NaiveDate::from_ymd_opt(2026, 7, 3).unwrap();
/// let rows = vec![
///     SpendRow { category_id: 1, category_name: "Groceries".into(), base_amount_minor: 1_000, posted_date: d1 },
///     SpendRow { category_id: 2, category_name: "Dining".into(), base_amount_minor: 500, posted_date: d1 },
///     SpendRow { category_id: 1, category_name: "Groceries".into(), base_amount_minor: 200, posted_date: d2 },
/// ];
/// let buckets = spend_over_time(&rows, Granularity::Day);
/// assert_eq!(buckets.len(), 2);
/// assert_eq!(buckets[0].amount_minor, 1_500);
/// assert_eq!(buckets[1].amount_minor, 200);
/// ```
pub fn spend_over_time(rows: &[SpendRow], granularity: Granularity) -> Vec<TimeBucket> {
    let mut totals: BTreeMap<NaiveDate, i64> = BTreeMap::new();
    for r in rows {
        let key = bucket_start(r.posted_date, granularity);
        *totals.entry(key).or_insert(0) += r.base_amount_minor;
    }
    totals
        .into_iter()
        .map(|(start, amount_minor)| TimeBucket {
            label: bucket_label(start, granularity),
            start_date: start.format("%Y-%m-%d").to_string(),
            amount_minor,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    // ---- resolve_period ----

    #[test]
    fn this_month_bounds() {
        assert_eq!(
            resolve_period(ReportPeriod::ThisMonth, d(2026, 7, 13)),
            Some((d(2026, 7, 1), d(2026, 8, 1)))
        );
    }

    #[test]
    fn this_month_handles_december_rollover() {
        assert_eq!(
            resolve_period(ReportPeriod::ThisMonth, d(2026, 12, 25)),
            Some((d(2026, 12, 1), d(2027, 1, 1)))
        );
    }

    #[test]
    fn last_3_months_spans_year_boundary() {
        // Jan 2026 -> start is Nov 2025 (this month + 2 back = 3 months total).
        assert_eq!(
            resolve_period(ReportPeriod::Last3Months, d(2026, 1, 15)),
            Some((d(2025, 11, 1), d(2026, 2, 1)))
        );
    }

    #[test]
    fn last_3_months_mid_year() {
        assert_eq!(
            resolve_period(ReportPeriod::Last3Months, d(2026, 7, 13)),
            Some((d(2026, 5, 1), d(2026, 8, 1)))
        );
    }

    #[test]
    fn this_year_bounds() {
        assert_eq!(
            resolve_period(ReportPeriod::ThisYear, d(2026, 7, 13)),
            Some((d(2026, 1, 1), d(2027, 1, 1)))
        );
    }

    #[test]
    fn this_year_handles_leap_february() {
        // 2028 is a leap year; ThisYear bounds don't depend on Feb length, but exercise the date
        // arithmetic near it anyway (regression guard for off-by-one month math).
        assert_eq!(
            resolve_period(ReportPeriod::ThisYear, d(2028, 2, 29)),
            Some((d(2028, 1, 1), d(2029, 1, 1)))
        );
    }

    #[test]
    fn all_time_has_no_bounds() {
        assert_eq!(resolve_period(ReportPeriod::AllTime, d(2026, 7, 13)), None);
    }

    // ---- choose_granularity ----

    #[test]
    fn granularity_thresholds() {
        assert_eq!(choose_granularity(Some((d(2026, 7, 1), d(2026, 8, 1)))), Granularity::Day);
        assert_eq!(choose_granularity(Some((d(2026, 7, 1), d(2026, 7, 31)))), Granularity::Day);
        assert_eq!(choose_granularity(Some((d(2026, 5, 1), d(2026, 8, 1)))), Granularity::Week);
        assert_eq!(choose_granularity(Some((d(2026, 1, 1), d(2026, 5, 1)))), Granularity::Week);
        assert_eq!(choose_granularity(Some((d(2026, 1, 1), d(2027, 1, 1)))), Granularity::Month);
        assert_eq!(choose_granularity(None), Granularity::Month);
    }

    // ---- spend_by_category ----

    #[test]
    fn category_sort_is_amount_desc_then_name() {
        let rows = vec![
            SpendRow {
                category_id: 1,
                category_name: "Zoo".into(),
                base_amount_minor: 1_000,
                posted_date: d(2026, 7, 1),
            },
            SpendRow {
                category_id: 2,
                category_name: "apple".into(),
                base_amount_minor: 1_000,
                posted_date: d(2026, 7, 1),
            },
            SpendRow {
                category_id: 3,
                category_name: "Dining".into(),
                base_amount_minor: 2_000,
                posted_date: d(2026, 7, 1),
            },
        ];
        let totals = spend_by_category(&rows);
        assert_eq!(
            totals.iter().map(|c| c.category_name.as_str()).collect::<Vec<_>>(),
            vec!["Dining", "apple", "Zoo"]
        );
    }

    #[test]
    fn category_totals_are_currency_agnostic_once_converted() {
        // Rows already carry base-currency minor units (fx conversion happens in db::reports), so
        // aggregation just sums regardless of the original transaction currency.
        let rows = vec![
            SpendRow {
                category_id: 1,
                category_name: "Groceries".into(),
                base_amount_minor: 1_500, // e.g. MUR entry
                posted_date: d(2026, 7, 1),
            },
            SpendRow {
                category_id: 1,
                category_name: "Groceries".into(),
                base_amount_minor: 4_550, // e.g. USD 100 @ 45.5 -> 4550 base minor
                posted_date: d(2026, 7, 2),
            },
        ];
        let totals = spend_by_category(&rows);
        assert_eq!(totals.len(), 1);
        assert_eq!(totals[0].amount_minor, 6_050);
    }

    #[test]
    fn empty_rows_produce_no_categories() {
        assert!(spend_by_category(&[]).is_empty());
    }

    // ---- spend_over_time ----

    #[test]
    fn day_buckets_group_by_exact_date() {
        let rows = vec![
            SpendRow {
                category_id: 1,
                category_name: "Groceries".into(),
                base_amount_minor: 1_000,
                posted_date: d(2026, 7, 1),
            },
            SpendRow {
                category_id: 2,
                category_name: "Dining".into(),
                base_amount_minor: 500,
                posted_date: d(2026, 7, 1),
            },
            SpendRow {
                category_id: 1,
                category_name: "Groceries".into(),
                base_amount_minor: 200,
                posted_date: d(2026, 7, 3),
            },
        ];
        let buckets = spend_over_time(&rows, Granularity::Day);
        assert_eq!(buckets.len(), 2);
        assert_eq!(buckets[0].start_date, "2026-07-01");
        assert_eq!(buckets[0].amount_minor, 1_500);
        assert_eq!(buckets[0].label, "01 Jul");
        assert_eq!(buckets[1].start_date, "2026-07-03");
        assert_eq!(buckets[1].amount_minor, 200);
    }

    #[test]
    fn week_buckets_group_by_monday_start() {
        // Wed 1 Jul 2026 and Fri 3 Jul 2026 both fall in the week starting Mon 29 Jun 2026.
        let rows = vec![
            SpendRow {
                category_id: 1,
                category_name: "Groceries".into(),
                base_amount_minor: 300,
                posted_date: d(2026, 7, 1),
            },
            SpendRow {
                category_id: 1,
                category_name: "Groceries".into(),
                base_amount_minor: 700,
                posted_date: d(2026, 7, 3),
            },
        ];
        let buckets = spend_over_time(&rows, Granularity::Week);
        assert_eq!(buckets.len(), 1);
        assert_eq!(buckets[0].start_date, "2026-06-29");
        assert_eq!(buckets[0].amount_minor, 1_000);
        assert_eq!(buckets[0].label, "Wk of 29 Jun");
    }

    #[test]
    fn month_buckets_group_by_calendar_month_chronologically() {
        let rows = vec![
            SpendRow {
                category_id: 1,
                category_name: "Groceries".into(),
                base_amount_minor: 100,
                posted_date: d(2026, 8, 15),
            },
            SpendRow {
                category_id: 1,
                category_name: "Groceries".into(),
                base_amount_minor: 200,
                posted_date: d(2026, 7, 2),
            },
        ];
        let buckets = spend_over_time(&rows, Granularity::Month);
        // Chronological order even though input rows are not.
        assert_eq!(buckets[0].start_date, "2026-07-01");
        assert_eq!(buckets[0].label, "Jul 2026");
        assert_eq!(buckets[1].start_date, "2026-08-01");
        assert_eq!(buckets[1].label, "Aug 2026");
    }

    #[test]
    fn no_gaps_are_filled_for_empty_periods() {
        // Documented design choice: only buckets with spend are emitted (see spend_over_time docs).
        let rows = vec![
            SpendRow {
                category_id: 1,
                category_name: "Groceries".into(),
                base_amount_minor: 100,
                posted_date: d(2026, 1, 1),
            },
            SpendRow {
                category_id: 1,
                category_name: "Groceries".into(),
                base_amount_minor: 100,
                posted_date: d(2026, 6, 1),
            },
        ];
        let buckets = spend_over_time(&rows, Granularity::Month);
        assert_eq!(buckets.len(), 2, "no zero-amount buckets for Feb-May");
    }

    #[test]
    fn empty_rows_produce_no_buckets() {
        assert!(spend_over_time(&[], Granularity::Day).is_empty());
    }

    // ---- serde shape ----

    #[test]
    fn report_period_serialises_camel_case() {
        assert_eq!(serde_json::to_string(&ReportPeriod::ThisMonth).unwrap(), "\"thisMonth\"");
        assert_eq!(serde_json::to_string(&ReportPeriod::Last3Months).unwrap(), "\"last3Months\"");
        assert_eq!(serde_json::to_string(&ReportPeriod::ThisYear).unwrap(), "\"thisYear\"");
        assert_eq!(serde_json::to_string(&ReportPeriod::AllTime).unwrap(), "\"allTime\"");
    }

    #[test]
    fn granularity_serialises_lowercase() {
        assert_eq!(serde_json::to_string(&Granularity::Day).unwrap(), "\"day\"");
        assert_eq!(serde_json::to_string(&Granularity::Week).unwrap(), "\"week\"");
        assert_eq!(serde_json::to_string(&Granularity::Month).unwrap(), "\"month\"");
    }

    #[test]
    fn report_data_round_trips_camel_case_fields() {
        let data = ReportData {
            base_currency: "MUR".into(),
            period: ReportPeriod::ThisMonth,
            total_spend_minor: 1_500,
            by_category: vec![CategorySpend {
                category_id: 1,
                category_name: "Groceries".into(),
                amount_minor: 1_500,
            }],
            over_time: vec![TimeBucket {
                label: "13 Jul".into(),
                start_date: "2026-07-13".into(),
                amount_minor: 1_500,
            }],
            granularity: Granularity::Day,
        };
        let json = serde_json::to_value(&data).unwrap();
        assert_eq!(json["baseCurrency"], "MUR");
        assert_eq!(json["totalSpendMinor"], 1_500);
        assert_eq!(json["byCategory"][0]["categoryId"], 1);
        assert_eq!(json["byCategory"][0]["categoryName"], "Groceries");
        assert_eq!(json["overTime"][0]["startDate"], "2026-07-13");
        assert_eq!(json["granularity"], "day");
    }
}
