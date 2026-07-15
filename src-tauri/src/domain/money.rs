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

/// Default minor-unit digits for a currency with no listed exception (ISO-4217 exponent 2).
pub const DEFAULT_MINOR_UNIT_DIGITS: u32 = 2;

/// The ONE list of currencies whose minor-unit digit count differs from
/// `DEFAULT_MINOR_UNIT_DIGITS`. Kept deliberately small (no full ISO-4217 code list - binary
/// size); extend as needed. This is the single source of truth for money scale: `minor_unit_digits`
/// consults it, and `commands::vault::currency_minor_units` exposes it verbatim to the frontend so
/// TypeScript never re-derives currency digits itself (CLAUDE.md - all money math lives in Rust).
pub fn minor_unit_digit_exceptions() -> &'static [(&'static str, u32)] {
    &[
        ("JPY", 0),
        ("KRW", 0),
        ("VND", 0),
        ("CLP", 0),
        ("ISK", 0),
        ("UGX", 0),
        ("XAF", 0),
        ("XOF", 0),
        ("BHD", 3),
        ("KWD", 3),
        ("OMR", 3),
        ("TND", 3),
        ("IQD", 3),
        ("JOD", 3),
        ("LYD", 3),
    ]
}

/// Minor-unit digits for a currency (the ISO-4217 "exponent"). Falls back to
/// `DEFAULT_MINOR_UNIT_DIGITS` for any currency not in `minor_unit_digit_exceptions`. Money
/// parsing/scaling lives in Rust, never TS.
pub fn minor_unit_digits(currency: &str) -> u32 {
    minor_unit_digit_exceptions()
        .iter()
        .find(|(code, _)| *code == currency)
        .map(|(_, digits)| *digits)
        .unwrap_or(DEFAULT_MINOR_UNIT_DIGITS)
}

/// One currency's minor-unit digit count (mirrors TS `CurrencyDigits`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyDigits {
    pub currency: String,
    pub digits: u32,
}

/// The authoritative currency minor-unit-digit table (mirrors TS `CurrencyMinorUnits`). Single
/// source of truth for money scale, exposed over IPC via `currency_minor_units` so the frontend
/// never hardcodes per-currency digit knowledge (CLAUDE.md).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyMinorUnits {
    pub default_digits: u32,
    pub exceptions: Vec<CurrencyDigits>,
}

impl CurrencyMinorUnits {
    /// Build the canonical table from `DEFAULT_MINOR_UNIT_DIGITS` + `minor_unit_digit_exceptions`.
    pub fn canonical() -> Self {
        Self {
            default_digits: DEFAULT_MINOR_UNIT_DIGITS,
            exceptions: minor_unit_digit_exceptions()
                .iter()
                .map(|(code, digits)| CurrencyDigits { currency: (*code).to_string(), digits: *digits })
                .collect(),
        }
    }
}

/// Format integer minor units as a fixed-decimal major-unit STRING for `currency` (FR-4.2 export):
/// e.g. `(-1_500, "MUR") -> "-15.00"`, `(1_500, "JPY") -> "1500"` (0-decimal currency),
/// `(1_234, "BHD") -> "1.234"` (3-decimal currency). Sign preserved, no grouping, no currency
/// symbol - callers add those if needed. Built with `rust_decimal::Decimal::set_scale`, which
/// reinterprets the same integer mantissa at a different decimal scale (no float, no rounding):
/// never use this to introduce an f32/f64 anywhere in the money path.
pub fn minor_to_major_string(amount_minor: i64, currency: &str) -> String {
    let mut value = Decimal::from(amount_minor);
    value.set_scale(minor_unit_digits(currency)).expect("minor-unit digit count fits Decimal scale");
    value.to_string()
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
    fn minor_to_major_string_formats_by_currency_scale() {
        assert_eq!(minor_to_major_string(1_500, "MUR"), "15.00");
        assert_eq!(minor_to_major_string(-1_500, "MUR"), "-15.00");
        assert_eq!(minor_to_major_string(0, "MUR"), "0.00");
        assert_eq!(minor_to_major_string(99, "USD"), "0.99");
        // Zero-decimal currency: no decimal point at all.
        assert_eq!(minor_to_major_string(1_500, "JPY"), "1500");
        assert_eq!(minor_to_major_string(-1_500, "JPY"), "-1500");
        // Three-decimal currency.
        assert_eq!(minor_to_major_string(1_234, "BHD"), "1.234");
    }

    #[test]
    fn minor_to_major_string_snapshot() {
        insta::assert_snapshot!(
            "minor_to_major_string_examples",
            [
                minor_to_major_string(150_000, "MUR"),
                minor_to_major_string(-150_000, "MUR"),
                minor_to_major_string(999, "USD"),
                minor_to_major_string(-999, "USD"),
                minor_to_major_string(500, "JPY"),
                minor_to_major_string(-500, "JPY"),
                minor_to_major_string(1_234, "BHD"),
                minor_to_major_string(-1_234, "BHD"),
            ]
            .join("\n")
        );
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
    fn canonical_currency_table_is_the_single_source_of_truth() {
        let table = CurrencyMinorUnits::canonical();
        assert_eq!(table.default_digits, 2);
        let find = |code: &str| table.exceptions.iter().find(|e| e.currency == code).map(|e| e.digits);
        assert_eq!(find("IQD"), Some(3));
        assert_eq!(find("JPY"), Some(0));
        // Every listed exception must agree with `minor_unit_digits` (one list, no drift).
        for e in &table.exceptions {
            assert_eq!(minor_unit_digits(&e.currency), e.digits);
        }
    }

    #[test]
    fn huf_uses_the_iso_4217_two_digit_default_not_zero() {
        // HUF (Hungarian Forint) has ISO-4217 exponent 2 (subunit filler): it must NOT appear in
        // the exceptions table, and must fall back to the 2-digit default (regression for #85).
        assert_eq!(minor_unit_digits("HUF"), 2);
        assert!(
            !minor_unit_digit_exceptions().iter().any(|(code, _)| *code == "HUF"),
            "HUF must not be listed as a minor-unit-digit exception"
        );
        assert_eq!(parse_minor("1.99", "HUF"), Ok(199));
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
