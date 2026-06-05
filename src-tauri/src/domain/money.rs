//! Money types and invariants. Money is ALWAYS integer minor units (e.g. cents) + a currency
//! code. `rust_decimal` is used only for fx-rate arithmetic. NEVER f32/f64 for money.

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
}
