//! Deduplication (FR-2.4). Flags likely duplicates by comparing date (within a configurable
//! window), exact amount, and account. Dedup NEVER deletes - it sets a `pending_review` flag the
//! UI surfaces for user confirmation.
//!
//! Skeleton: the comparison predicate is defined and unit-tested; wiring against existing rows +
//! within-batch rows during import lands with the import pipeline.

use chrono::NaiveDate;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DedupKey {
    pub account_id: i64,
    pub amount_minor: i64,
    pub posted_date: NaiveDate,
}

/// Two transactions are likely duplicates if same account, exact amount, and dates within
/// `window_days` of each other.
pub fn is_likely_duplicate(a: &DedupKey, b: &DedupKey, window_days: i64) -> bool {
    a.account_id == b.account_id
        && a.amount_minor == b.amount_minor
        && (a.posted_date - b.posted_date).num_days().abs() <= window_days
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(acc: i64, amt: i64, d: (i32, u32, u32)) -> DedupKey {
        DedupKey {
            account_id: acc,
            amount_minor: amt,
            posted_date: NaiveDate::from_ymd_opt(d.0, d.1, d.2).unwrap(),
        }
    }

    #[test]
    fn flags_within_window_same_amount_account() {
        let a = key(1, 1299, (2026, 6, 1));
        let b = key(1, 1299, (2026, 6, 3));
        assert!(is_likely_duplicate(&a, &b, 3));
    }

    #[test]
    fn not_duplicate_when_amount_or_account_differs() {
        let a = key(1, 1299, (2026, 6, 1));
        assert!(!is_likely_duplicate(&a, &key(2, 1299, (2026, 6, 1)), 3));
        assert!(!is_likely_duplicate(&a, &key(1, 1300, (2026, 6, 1)), 3));
    }

    #[test]
    fn not_duplicate_outside_window() {
        let a = key(1, 1299, (2026, 6, 1));
        let b = key(1, 1299, (2026, 6, 10));
        assert!(!is_likely_duplicate(&a, &b, 3));
    }
}
