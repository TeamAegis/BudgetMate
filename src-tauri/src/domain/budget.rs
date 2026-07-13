//! Envelope-style budgeting (FR-3.1). A budget caps monthly spend per category; spend is
//! aggregated from expense transaction splits, converted to the base (reporting) currency the
//! same way `base_amount_minor` derives it elsewhere. Pure, DB-free logic here is unit-testable
//! without SQLCipher (.claude/rules/engineering.md).

use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::domain::money::base_amount_minor;

/// v1 supports monthly budgets only; kept as a string column for a future period kind.
pub const MONTHLY_PERIOD: &str = "monthly";

/// A cap on spend for one category in one period (mirrors TS `Budget`; the raw `budgets` row).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Budget {
    pub id: i64,
    pub category_id: i64,
    pub period: String,
    pub cap_minor: i64,
}

/// One envelope's spend-vs-cap for the current period (mirrors TS `EnvelopeSummary`). This is the
/// budgets-screen read model; `spentMinor` is always a positive "money out" figure regardless of
/// how expenses are signed internally. Carries the underlying `budgets.id` (beyond the issue's
/// original field list) so the UI can route straight to `/budgets/:id/edit` - `list_envelopes` is
/// the only per-category read, and without the row id there would be no way to identify which
/// budget to edit/delete from the list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvelopeSummary {
    pub id: i64,
    pub category_id: i64,
    pub category_name: String,
    pub period: String,
    pub cap_minor: i64,
    /// Positive total spent this period, in `currency`.
    pub spent_minor: i64,
    /// `cap_minor - spent_minor`; negative once over budget.
    pub remaining_minor: i64,
    /// The base (reporting) currency the cap and spend are both expressed in.
    pub currency: String,
    pub status: EnvelopeStatus,
}

/// Where an envelope sits against its cap. NEVER signal this by colour alone in the UI - the
/// frontend must pair it with an icon + a plain-language label (design.md a11y rule).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnvelopeStatus {
    Under,
    Approaching,
    Over,
}

/// Spend at/above this percent of the cap flips an envelope to "approaching" (still <= 100%).
pub const APPROACHING_THRESHOLD_PCT: i64 = 80;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("budget cap must be greater than zero")]
    NonPositiveCap,
}

/// A cap of zero or less is meaningless - reject on create/update (issue #16 edge case).
pub fn validate_cap(cap_minor: i64) -> Result<(), ValidationError> {
    if cap_minor <= 0 {
        Err(ValidationError::NonPositiveCap)
    } else {
        Ok(())
    }
}

/// Classify spend against a cap: under (< 80%), approaching (80%-100% inclusive), over (> 100%).
/// Uses `Decimal` (not float) for the ratio so no rounding drift creeps into a UI-facing status.
pub fn envelope_status(cap_minor: i64, spent_minor: i64) -> EnvelopeStatus {
    if cap_minor <= 0 {
        // A cap this low/invalid is always "over"; validation should prevent it existing at all.
        return EnvelopeStatus::Over;
    }
    let cap = Decimal::from(cap_minor);
    let spent = Decimal::from(spent_minor);
    if spent > cap {
        EnvelopeStatus::Over
    } else if spent * Decimal::from(100) >= cap * Decimal::from(APPROACHING_THRESHOLD_PCT) {
        EnvelopeStatus::Approaching
    } else {
        EnvelopeStatus::Under
    }
}

/// Sum a category's expense splits for a period into a positive "money out" total, in base
/// currency. Each split is `(signed_split_amount_minor, transaction_fx_rate)`; expense splits are
/// stored negative (`domain::transaction::signed_amount`), so the base conversion is negated. The
/// per-row conversion is the exact same `base_amount_minor` used for `transactions.base_amount_minor`,
/// so this can never drift from how the ledger itself computes base amounts.
pub fn spend_from_splits(splits: &[(i64, Decimal)]) -> i64 {
    splits
        .iter()
        .fold(0i64, |acc, &(amount_minor, fx_rate)| {
            acc.saturating_add(-base_amount_minor(amount_minor, fx_rate))
        })
}

/// The current calendar month's inclusive date bounds (ISO `yyyy-mm-dd`), derived from `today`. v1
/// budgets are monthly only, so this is the only period math needed; the caller (the command) is
/// the one place that reads the real clock, keeping this pure and testable.
pub fn month_bounds(today: NaiveDate) -> (String, String) {
    let (year, month) = (today.year(), today.month());
    let start = NaiveDate::from_ymd_opt(year, month, 1).expect("day 1 of a month is always valid");
    let (next_year, next_month) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    let next_month_start =
        NaiveDate::from_ymd_opt(next_year, next_month, 1).expect("day 1 of a month is always valid");
    let end = next_month_start.pred_opt().expect("the day before day 1 of a month always exists");
    (start.format("%Y-%m-%d").to_string(), end.format("%Y-%m-%d").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn cap_must_be_positive() {
        assert!(validate_cap(1).is_ok());
        assert_eq!(validate_cap(0), Err(ValidationError::NonPositiveCap));
        assert_eq!(validate_cap(-1), Err(ValidationError::NonPositiveCap));
    }

    #[test]
    fn status_thresholds_are_exact_at_the_boundaries() {
        // cap 10000: under < 8000, approaching 8000..=10000, over > 10000.
        assert_eq!(envelope_status(10_000, 7_999), EnvelopeStatus::Under);
        assert_eq!(envelope_status(10_000, 8_000), EnvelopeStatus::Approaching);
        assert_eq!(envelope_status(10_000, 10_000), EnvelopeStatus::Approaching);
        assert_eq!(envelope_status(10_000, 10_001), EnvelopeStatus::Over);
    }

    #[test]
    fn status_handles_a_non_round_cap() {
        // cap 333: 80% = 266.4 -> at spend 266 that's < 80% (under); at 267 it's >= 80%.
        assert_eq!(envelope_status(333, 266), EnvelopeStatus::Under);
        assert_eq!(envelope_status(333, 267), EnvelopeStatus::Approaching);
    }

    #[test]
    fn spend_sums_negative_expense_splits_to_a_positive_total() {
        // Two expense splits, same currency (fx_rate 1): -1500 and -2000 -> spent 3500.
        let splits = vec![(-1_500i64, dec!(1)), (-2_000i64, dec!(1))];
        assert_eq!(spend_from_splits(&splits), 3_500);
    }

    #[test]
    fn spend_converts_foreign_currency_splits_to_base_with_the_same_rounding_as_transactions() {
        // -10000 minor at fx 45.5 -> base -455000 -> spend contribution +455000.
        let splits = vec![(-10_000i64, dec!(45.5))];
        assert_eq!(spend_from_splits(&splits), 455_000);
        assert_eq!(base_amount_minor(-10_000, dec!(45.5)), -455_000);
    }

    #[test]
    fn spend_of_no_splits_is_zero() {
        assert_eq!(spend_from_splits(&[]), 0);
    }

    #[test]
    fn month_bounds_covers_a_regular_month() {
        let today = NaiveDate::from_ymd_opt(2026, 6, 15).unwrap();
        assert_eq!(month_bounds(today), ("2026-06-01".to_string(), "2026-06-30".to_string()));
    }

    #[test]
    fn month_bounds_handles_december_rollover() {
        let today = NaiveDate::from_ymd_opt(2026, 12, 25).unwrap();
        assert_eq!(month_bounds(today), ("2026-12-01".to_string(), "2026-12-31".to_string()));
    }

    #[test]
    fn month_bounds_handles_a_leap_february() {
        let today = NaiveDate::from_ymd_opt(2024, 2, 10).unwrap();
        assert_eq!(month_bounds(today), ("2024-02-01".to_string(), "2024-02-29".to_string()));
    }
}
