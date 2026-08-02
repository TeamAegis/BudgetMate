//! Account entity + validation. Money stays integer minor units; currency is per-account.

use serde::{Deserialize, Serialize};

/// Mirrors TS `Account`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: i64,
    pub name: String,
    pub account_type: AccountKind,
    pub currency: String,
    pub opening_balance_minor: i64,
    pub archived: bool,
    /// DERIVED, never stored: the account's balance right now, in the account's OWN `currency` -
    /// `opening_balance_minor` plus every confirmed (`pending_review = 0`), not-future-dated
    /// transaction on this account. This is what the Accounts screen shows; the opening balance
    /// alone is only where the account started, which read as a permanent "Rs 0" for any account
    /// opened at zero. Mirrors how `Allowance` carries its derived `reserved_minor`.
    pub balance_minor: i64,
}

/// Mirrors TS `AccountKind` (string union). Stored in the DB `type` column as the lowercase str.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountKind {
    Cash,
    Bank,
    Card,
    Wallet,
    Other,
}

impl AccountKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            AccountKind::Cash => "cash",
            AccountKind::Bank => "bank",
            AccountKind::Card => "card",
            AccountKind::Wallet => "wallet",
            AccountKind::Other => "other",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "cash" => Some(AccountKind::Cash),
            "bank" => Some(AccountKind::Bank),
            "card" => Some(AccountKind::Card),
            "wallet" => Some(AccountKind::Wallet),
            "other" => Some(AccountKind::Other),
            _ => None,
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("name must not be empty")]
    EmptyName,
    #[error("currency must be a 3-letter ISO-4217 code (e.g. MUR)")]
    BadCurrency,
}

/// Validate user-supplied account fields before persisting.
pub fn validate_account(name: &str, currency: &str) -> Result<(), ValidationError> {
    if name.trim().is_empty() {
        return Err(ValidationError::EmptyName);
    }
    if !is_iso4217(currency) {
        return Err(ValidationError::BadCurrency);
    }
    Ok(())
}

/// Lightweight ISO-4217 shape check: exactly 3 uppercase ASCII letters. (Full code-list validation
/// is intentionally avoided to keep the binary small; the picker constrains real choices.)
pub fn is_iso4217(currency: &str) -> bool {
    currency.len() == 3 && currency.bytes().all(|b| b.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_account_passes() {
        assert!(validate_account("Cash", "MUR").is_ok());
    }

    #[test]
    fn empty_name_rejected() {
        assert_eq!(validate_account("  ", "MUR"), Err(ValidationError::EmptyName));
    }

    #[test]
    fn bad_currency_rejected() {
        assert_eq!(validate_account("Cash", "mur"), Err(ValidationError::BadCurrency));
        assert_eq!(validate_account("Cash", "RUPEE"), Err(ValidationError::BadCurrency));
    }

    #[test]
    fn account_kind_roundtrips() {
        for k in [
            AccountKind::Cash,
            AccountKind::Bank,
            AccountKind::Card,
            AccountKind::Wallet,
            AccountKind::Other,
        ] {
            assert_eq!(AccountKind::parse(k.as_str()), Some(k));
        }
        assert_eq!(AccountKind::parse("crypto"), None);
    }
}
