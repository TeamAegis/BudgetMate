//! Money types and invariants. Money is ALWAYS integer minor units (e.g. cents) + a currency
//! code. `rust_decimal` is used only for fx-rate arithmetic. NEVER f32/f64 for money.

use std::str::FromStr;

use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// An amount in integer minor units with its currency (mirrors TS `Money`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Money {
    pub amount_minor: i64,
    pub currency: String,
}

impl Money {
    pub fn new(amount_minor: i64, currency: impl Into<String>) -> Self {
        Self {
            amount_minor,
            currency: currency.into(),
        }
    }
}

/// Derived base-currency amount: `base_amount_minor = round(amount_minor * fx_rate)` (FR-1.4).
/// Recomputed on every insert/update. Uses banker's rounding at the minor-unit scale.
pub fn base_amount_minor(amount_minor: i64, fx_rate: Decimal) -> i64 {
    let product = Decimal::from(amount_minor) * fx_rate;
    product
        .round_dp(0)
        .to_i64()
        .expect("base amount overflows i64")
}

/// Split invariant (FR-1.2): split amounts must sum EXACTLY to the parent amount.
pub fn splits_sum_to_parent(parent_minor: i64, split_minors: &[i64]) -> bool {
    split_minors.iter().try_fold(0i64, |acc, &m| acc.checked_add(m)) == Some(parent_minor)
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MoneyParseError {
    #[error("amount is not a valid number")]
    Malformed,
    #[error("amount has more decimal places than the currency allows")]
    TooPrecise,
    #[error("amount is out of range")]
    Overflow,
}

/// Minor-unit digits for a currency (the ISO-4217 "exponent"). Defaults to 2 and covers the common
/// 0- and 3-digit exceptions; extend as needed. Kept deliberately small (no full code list — binary
/// size). Money parsing/scaling lives in Rust, never TS.
pub fn minor_unit_digits(currency: &str) -> u32 {
    match currency {
        "JPY" | "KRW" | "VND" | "CLP" | "ISK" | "HUF" | "UGX" | "XAF" | "XOF" => 0,
        "BHD" | "KWD" | "OMR" | "TND" | "IQD" | "JOD" | "LYD" => 3,
        _ => 2,
    }
}

/// Parse a user-entered major-unit amount (e.g. "15.00") into integer minor units for `currency`.
/// Rejects malformed input or finer precision than the currency allows. Sign is preserved; callers
/// validate the magnitude separately.
pub fn parse_minor(amount: &str, currency: &str) -> Result<i64, MoneyParseError> {
    let value = Decimal::from_str(amount.trim()).map_err(|_| MoneyParseError::Malformed)?;
    let scaled = value * Decimal::from(10_i64.pow(minor_unit_digits(currency)));
    if scaled.fract() != Decimal::ZERO {
        return Err(MoneyParseError::TooPrecise);
    }
    scaled.round_dp(0).to_i64().ok_or(MoneyParseError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn base_amount_uses_fx_rate_and_rounds() {
        // 100.00 (10000 minor) at 1.2345 -> 12345 minor.
        assert_eq!(base_amount_minor(10_000, dec!(1.2345)), 12_345);
        // Rounding: 333 * 1.5 = 499.5 -> 500 (half to even rounds .5 toward even -> 500).
        assert_eq!(base_amount_minor(333, dec!(1.5)), 500);
    }

    #[test]
    fn identity_rate_is_noop() {
        assert_eq!(base_amount_minor(4_237, dec!(1)), 4_237);
    }

    #[test]
    fn splits_must_sum_exactly() {
        assert!(splits_sum_to_parent(1_000, &[600, 400]));
        assert!(splits_sum_to_parent(1_000, &[1_000]));
        assert!(!splits_sum_to_parent(1_000, &[600, 401]));
        assert!(!splits_sum_to_parent(1_000, &[600]));
    }

    #[test]
    fn parses_major_to_minor_by_currency_scale() {
        assert_eq!(parse_minor("15.00", "MUR"), Ok(1_500));
        assert_eq!(parse_minor("15", "MUR"), Ok(1_500));
        assert_eq!(parse_minor("0.99", "USD"), Ok(99));
        // Zero-decimal currency: no minor units.
        assert_eq!(parse_minor("1500", "JPY"), Ok(1_500));
        // Three-decimal currency.
        assert_eq!(parse_minor("1.234", "BHD"), Ok(1_234));
    }

    #[test]
    fn rejects_bad_or_too_precise_amounts() {
        assert_eq!(parse_minor("abc", "MUR"), Err(MoneyParseError::Malformed));
        assert_eq!(parse_minor("1.005", "MUR"), Err(MoneyParseError::TooPrecise));
        assert_eq!(parse_minor("1.5", "JPY"), Err(MoneyParseError::TooPrecise));
    }

    use proptest::prelude::*;

    proptest! {
        /// `splits_sum_to_parent` is true exactly when the splits add up to the parent.
        #[test]
        fn prop_splits_sum_to_parent(splits in prop::collection::vec(-1_000_000i64..1_000_000, 0..20)) {
            let total: i64 = splits.iter().sum();
            prop_assert!(splits_sum_to_parent(total, &splits));
            prop_assert!(!splits_sum_to_parent(total + 1, &splits));
        }

        /// An identity fx rate leaves the amount unchanged.
        #[test]
        fn prop_base_amount_identity_rate(amount in -100_000_000i64..100_000_000) {
            prop_assert_eq!(base_amount_minor(amount, dec!(1)), amount);
        }

        /// The base amount is the exact product rounded to the nearest minor unit (|error| <= 0.5).
        #[test]
        fn prop_base_amount_is_rounded_product(
            amount in -1_000_000i64..1_000_000,
            hundredths in 1i64..1_000_000,
        ) {
            let rate = Decimal::from(hundredths) / Decimal::from(100);
            let base = base_amount_minor(amount, rate);
            let exact = Decimal::from(amount) * rate;
            prop_assert!((Decimal::from(base) - exact).abs() <= dec!(0.5));
        }

        /// Formatting integer minor units to a major-unit string and parsing back is the identity
        /// (2-dp currency).
        #[test]
        fn prop_parse_minor_roundtrips_2dp(minor in -1_000_000_000i64..1_000_000_000) {
            let sign = if minor < 0 { "-" } else { "" };
            let abs = minor.unsigned_abs();
            let major = format!("{sign}{}.{:02}", abs / 100, abs % 100);
            prop_assert_eq!(parse_minor(&major, "MUR"), Ok(minor));
        }
    }
}
