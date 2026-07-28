//! Transaction entity + validation + the money sign rule (FR-1.1). Pure logic; the DB layer
//! supplies category/account lookups and persistence.
//!
//! Categorisation is modelled through `tx_splits` (the `transactions` row has no category column),
//! so a manual entry is the transaction plus exactly one split; FR-1.2 generalises to ≥2.
//!
//! The stored `amount_minor` is SIGNED - expenses are negative, income/transfers positive -
//! derived from the chosen category's kind so all sign/money logic stays in Rust (never TS).

use std::str::FromStr;

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::domain::account::is_iso4217;
use crate::domain::category::CategoryKind;
use crate::domain::money::splits_sum_to_parent;

/// A ledger transaction with its category splits (mirrors TS `Transaction`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub id: i64,
    pub account_id: i64,
    pub posted_date: String,
    pub amount_minor: i64,
    pub currency: String,
    /// fx rate as a decimal string (never a float); "1" for same-currency entries.
    pub fx_rate: String,
    pub base_amount_minor: i64,
    pub payee: Option<String>,
    pub note: Option<String>,
    pub source: String,
    pub source_ref: Option<String>,
    pub pending_review: bool,
    pub created_at: String,
    pub splits: Vec<TxSplit>,
    /// Optional allowance tag (FR-3.4). Setting this ONLY draws down that allowance's DERIVED
    /// balance (ADR 0012) - it never mutates the `allowances` row itself. Only the manual
    /// create/update path ever sets it (`db::transactions::create_tagged`/`update_tagged`); recurring
    /// and import transactions are never tagged.
    pub allowance_id: Option<i64>,
}

/// One category line of a transaction (mirrors TS `TxSplit`). `category_name` is denormalised for
/// display; `amount_minor` carries the same sign convention as the parent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxSplit {
    pub id: i64,
    pub category_id: i64,
    pub category_name: String,
    pub amount_minor: i64,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum TxValidationError {
    #[error("posted date must not be empty")]
    EmptyDate,
    #[error("amount must be greater than zero")]
    NonPositiveAmount,
    #[error("currency must be a 3-letter ISO-4217 code (e.g. MUR)")]
    BadCurrency,
    #[error("fx rate must be a positive decimal")]
    BadFxRate,
    #[error("a transaction needs at least one split")]
    EmptySplits,
    #[error("all splits must be the same type (all expense or all income)")]
    MixedSplitKinds,
    #[error("splits must add up to the transaction total")]
    SplitsDontSumToTotal,
}

/// Signed ledger amount from a non-negative magnitude + the category kind: expenses reduce the
/// balance (negative); income and transfers are positive. (Full transfer semantics arrive later.)
pub fn signed_amount(magnitude_minor: i64, kind: CategoryKind) -> i64 {
    match kind {
        CategoryKind::Expense => -magnitude_minor,
        CategoryKind::Income | CategoryKind::Transfer => magnitude_minor,
    }
}

/// Validate manual-entry input and return the parsed positive `fx_rate`. `magnitude_minor` is the
/// non-negative amount (already parsed from the user's major-unit input); the sign is applied
/// separately from the category kind.
pub fn validate_transaction(
    posted_date: &str,
    magnitude_minor: i64,
    currency: &str,
    fx_rate: &str,
) -> Result<Decimal, TxValidationError> {
    if posted_date.trim().is_empty() {
        return Err(TxValidationError::EmptyDate);
    }
    if magnitude_minor <= 0 {
        return Err(TxValidationError::NonPositiveAmount);
    }
    if !is_iso4217(currency) {
        return Err(TxValidationError::BadCurrency);
    }
    let rate = Decimal::from_str(fx_rate.trim()).map_err(|_| TxValidationError::BadFxRate)?;
    if rate <= Decimal::ZERO {
        return Err(TxValidationError::BadFxRate);
    }
    Ok(rate)
}

/// Validate the split set of a transaction (FR-1.2): at least one split, every split positive, all
/// splits the same kind (a transaction is a single income/expense), and the split magnitudes adding
/// up EXACTLY to the transaction total. `kinds[i]` is the kind of `split_magnitudes[i]`'s category.
pub fn validate_split_set(
    total_magnitude: i64,
    split_magnitudes: &[i64],
    kinds: &[CategoryKind],
) -> Result<(), TxValidationError> {
    debug_assert_eq!(split_magnitudes.len(), kinds.len());
    if split_magnitudes.is_empty() {
        return Err(TxValidationError::EmptySplits);
    }
    if split_magnitudes.iter().any(|&m| m <= 0) {
        return Err(TxValidationError::NonPositiveAmount);
    }
    if kinds.windows(2).any(|w| w[0] != w[1]) {
        return Err(TxValidationError::MixedSplitKinds);
    }
    if !splits_sum_to_parent(total_magnitude, split_magnitudes) {
        return Err(TxValidationError::SplitsDontSumToTotal);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn sign_follows_category_kind() {
        assert_eq!(signed_amount(1_500, CategoryKind::Expense), -1_500);
        assert_eq!(signed_amount(1_500, CategoryKind::Income), 1_500);
        assert_eq!(signed_amount(1_500, CategoryKind::Transfer), 1_500);
    }

    #[test]
    fn valid_input_returns_rate() {
        assert_eq!(
            validate_transaction("2026-06-06", 1_500, "MUR", "1"),
            Ok(dec!(1))
        );
        assert_eq!(
            validate_transaction("2026-06-06", 1_000, "USD", "1.2345"),
            Ok(dec!(1.2345))
        );
    }

    #[test]
    fn rejects_bad_input() {
        assert_eq!(
            validate_transaction("", 1_500, "MUR", "1"),
            Err(TxValidationError::EmptyDate)
        );
        assert_eq!(
            validate_transaction("2026-06-06", 0, "MUR", "1"),
            Err(TxValidationError::NonPositiveAmount)
        );
        assert_eq!(
            validate_transaction("2026-06-06", 1_500, "mur", "1"),
            Err(TxValidationError::BadCurrency)
        );
        assert_eq!(
            validate_transaction("2026-06-06", 1_500, "MUR", "0"),
            Err(TxValidationError::BadFxRate)
        );
        assert_eq!(
            validate_transaction("2026-06-06", 1_500, "MUR", "nope"),
            Err(TxValidationError::BadFxRate)
        );
    }

    #[test]
    fn valid_split_set_passes() {
        use CategoryKind::Expense;
        assert_eq!(validate_split_set(1_000, &[600, 400], &[Expense, Expense]), Ok(()));
        assert_eq!(validate_split_set(1_000, &[1_000], &[Expense]), Ok(()));
    }

    #[test]
    fn split_set_rejects_bad_shapes() {
        use CategoryKind::{Expense, Income};
        assert_eq!(validate_split_set(1_000, &[], &[]), Err(TxValidationError::EmptySplits));
        assert_eq!(
            validate_split_set(1_000, &[1_000, 0], &[Expense, Expense]),
            Err(TxValidationError::NonPositiveAmount)
        );
        assert_eq!(
            validate_split_set(1_000, &[600, 400], &[Expense, Income]),
            Err(TxValidationError::MixedSplitKinds)
        );
        assert_eq!(
            validate_split_set(1_000, &[600, 401], &[Expense, Expense]),
            Err(TxValidationError::SplitsDontSumToTotal)
        );
    }
}
