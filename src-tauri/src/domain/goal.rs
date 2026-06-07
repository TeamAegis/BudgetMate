//! Savings-goal entity + validation (FR-3.2). Money stays integer minor units; `completed` is
//! derived (saved has reached the target), never a stored flag. Pure logic — unit-testable.

use serde::{Deserialize, Serialize};

use crate::domain::account::is_iso4217;

/// Mirrors TS `Goal`. `current_minor` is the amount saved so far (design vocabulary: "current").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: i64,
    pub name: String,
    pub target_minor: i64,
    pub current_minor: i64,
    pub currency: String,
    pub target_date: Option<String>,
    /// Derived: the current amount has reached (or passed) the target.
    pub completed: bool,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("name must not be empty")]
    EmptyName,
    #[error("target must be greater than zero")]
    NonPositiveTarget,
    #[error("current amount must not be negative")]
    NegativeCurrent,
    #[error("currency must be a 3-letter ISO-4217 code (e.g. MUR)")]
    BadCurrency,
}

/// Validate user-supplied goal fields before persisting.
pub fn validate_goal(
    name: &str,
    target_minor: i64,
    current_minor: i64,
    currency: &str,
) -> Result<(), ValidationError> {
    if name.trim().is_empty() {
        return Err(ValidationError::EmptyName);
    }
    if target_minor <= 0 {
        return Err(ValidationError::NonPositiveTarget);
    }
    if current_minor < 0 {
        return Err(ValidationError::NegativeCurrent);
    }
    if !is_iso4217(currency) {
        return Err(ValidationError::BadCurrency);
    }
    Ok(())
}

/// A goal is complete once the current amount reaches the target.
pub fn is_completed(target_minor: i64, current_minor: i64) -> bool {
    current_minor >= target_minor
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_goal_passes() {
        assert!(validate_goal("Vacation", 1_000_000, 500_000, "MUR").is_ok());
    }

    #[test]
    fn empty_name_rejected() {
        assert_eq!(validate_goal("  ", 100, 0, "MUR"), Err(ValidationError::EmptyName));
    }

    #[test]
    fn non_positive_target_rejected() {
        assert_eq!(validate_goal("X", 0, 0, "MUR"), Err(ValidationError::NonPositiveTarget));
        assert_eq!(validate_goal("X", -1, 0, "MUR"), Err(ValidationError::NonPositiveTarget));
    }

    #[test]
    fn negative_current_rejected() {
        assert_eq!(validate_goal("X", 100, -1, "MUR"), Err(ValidationError::NegativeCurrent));
    }

    #[test]
    fn bad_currency_rejected() {
        assert_eq!(validate_goal("X", 100, 0, "mur"), Err(ValidationError::BadCurrency));
    }

    #[test]
    fn completion_is_derived_from_amounts() {
        assert!(!is_completed(1_000, 999));
        assert!(is_completed(1_000, 1_000));
        assert!(is_completed(1_000, 1_500));
    }
}
