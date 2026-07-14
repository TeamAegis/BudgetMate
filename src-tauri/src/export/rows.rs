//! Pure, testable row assembly for the transaction export (FR-4.2). One `ExportRow` per SPLIT
//! (lossless: a split transaction becomes N rows, one per category, with the parent's fields
//! repeated) rather than one row per transaction, so a split transaction's amounts still sum to
//! the same total in the exported file. `ExportRow` never crosses IPC directly (the command only
//! returns an `ExportSummary`), so it carries no `serde`/camelCase requirement.

use std::collections::HashMap;

use crate::domain::category::CategoryKind;
use crate::domain::money::minor_to_major_string;
use crate::domain::report::allocate_base;
use crate::domain::transaction::Transaction;

/// One line of the export - one row per category split. All amount fields are STRINGS (never
/// f32/f64 - the `no-float-money` guard scans this path), formatted by
/// `domain::money::minor_to_major_string`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportRow {
    pub date: String,
    pub account: String,
    pub payee: String,
    pub category: String,
    /// "Expense" | "Income" | "Transfer" - from the split's own category kind, not from the sign
    /// (income and transfer are both positive, so sign alone can't distinguish them).
    pub kind: String,
    /// Split-signed major-unit amount in the transaction's own currency.
    pub amount: String,
    pub currency: String,
    /// This split's share of the transaction's OWN stored `base_amount_minor`, allocated across the
    /// transaction's splits by magnitude (see `domain::report::allocate_base`) so the exported base
    /// amounts always reconcile exactly with the ledger, even for a fractional-fx split transaction.
    pub base_amount: String,
    pub base_currency: String,
    pub note: String,
}

fn kind_label(kind: CategoryKind) -> &'static str {
    match kind {
        CategoryKind::Expense => "Expense",
        CategoryKind::Income => "Income",
        CategoryKind::Transfer => "Transfer",
    }
}

/// Assemble export rows from transactions (each already carrying its splits, per
/// `db::transactions::list`). `account_name` / `category_kind` are id -> lookup maps built by the
/// caller from `db::accounts::list` / `db::categories::list` (`TxSplit` only denormalises the
/// category NAME, not its kind, so the command passes both maps in - this is a deliberate
/// adaptation of the original one-map signature; see the export ADR). `base_ccy` labels the base
/// column; each split's base amount is this transaction's OWN stored `base_amount_minor` allocated
/// across its splits' magnitudes (`domain::report::allocate_base` - the same reconciliation the
/// Analytics module uses), NOT independently re-derived from the split amount and `fx_rate` - that
/// would drift by +/-1 minor unit from the ledger for a fractional-fx split transaction.
pub fn build_rows(
    txs: &[Transaction],
    account_name: &HashMap<i64, String>,
    category_kind: &HashMap<i64, CategoryKind>,
    base_ccy: &str,
) -> Vec<ExportRow> {
    let mut rows = Vec::new();
    for tx in txs {
        let account = account_name.get(&tx.account_id).cloned().unwrap_or_default();
        let magnitudes: Vec<i64> = tx.splits.iter().map(|s| s.amount_minor.abs()).collect();
        let base_shares = allocate_base(tx.base_amount_minor.abs(), &magnitudes);
        for (split, base_share) in tx.splits.iter().zip(base_shares) {
            let kind = category_kind
                .get(&split.category_id)
                .copied()
                .unwrap_or(CategoryKind::Expense);
            // Re-apply this split's own sign so a mixed-sign split set (rare) still exports
            // correctly-signed base amounts.
            let base_minor = base_share * split.amount_minor.signum();
            rows.push(ExportRow {
                date: tx.posted_date.clone(),
                account: account.clone(),
                payee: tx.payee.clone().unwrap_or_default(),
                category: split.category_name.clone(),
                kind: kind_label(kind).to_string(),
                amount: minor_to_major_string(split.amount_minor, &tx.currency),
                currency: tx.currency.clone(),
                base_amount: minor_to_major_string(base_minor, base_ccy),
                base_currency: base_ccy.to_string(),
                note: tx.note.clone().unwrap_or_default(),
            });
        }
    }
    rows
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use rust_decimal::Decimal;

    use super::*;
    use crate::domain::money::base_amount_minor;
    use crate::domain::transaction::TxSplit;

    /// `base_amount_minor` is derived from `fx_rate` exactly as the DB layer would on write
    /// (`domain::money::base_amount_minor`), so the stored base total is consistent with the rate a
    /// test sets - never the raw split sum (that was the pre-fix bug this module now avoids).
    fn tx(id: i64, fx_rate: &str, splits: Vec<TxSplit>) -> Transaction {
        let sum_minor: i64 = splits.iter().map(|s| s.amount_minor).sum();
        let rate = Decimal::from_str(fx_rate).unwrap_or(Decimal::ONE);
        Transaction {
            id,
            account_id: 1,
            posted_date: "2026-06-06".into(),
            amount_minor: sum_minor,
            currency: "MUR".into(),
            fx_rate: fx_rate.into(),
            base_amount_minor: base_amount_minor(sum_minor, rate),
            payee: Some("Market".into()),
            note: Some("weekly shop".into()),
            source: "manual".into(),
            source_ref: None,
            pending_review: false,
            created_at: "2026-06-06T10:00:00Z".into(),
            splits,
        }
    }

    fn maps() -> (HashMap<i64, String>, HashMap<i64, CategoryKind>) {
        let accounts = HashMap::from([(1, "Cash".to_string())]);
        let categories = HashMap::from([
            (1, CategoryKind::Expense), // Groceries
            (2, CategoryKind::Expense), // Dining
            (9, CategoryKind::Income),  // Salary
        ]);
        (accounts, categories)
    }

    #[test]
    fn single_split_becomes_one_row() {
        let (accounts, categories) = maps();
        let txs = [tx(
            1,
            "1",
            vec![TxSplit { id: 1, category_id: 1, category_name: "Groceries".into(), amount_minor: -1_500 }],
        )];
        let rows = build_rows(&txs, &accounts, &categories, "MUR");
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!(r.date, "2026-06-06");
        assert_eq!(r.account, "Cash");
        assert_eq!(r.payee, "Market");
        assert_eq!(r.category, "Groceries");
        assert_eq!(r.kind, "Expense");
        assert_eq!(r.amount, "-15.00");
        assert_eq!(r.currency, "MUR");
        assert_eq!(r.base_amount, "-15.00");
        assert_eq!(r.base_currency, "MUR");
        assert_eq!(r.note, "weekly shop");
    }

    #[test]
    fn multi_split_becomes_one_row_per_split_summing_to_the_parent() {
        let (accounts, categories) = maps();
        let txs = [tx(
            2,
            "1",
            vec![
                TxSplit { id: 1, category_id: 1, category_name: "Groceries".into(), amount_minor: -3_000 },
                TxSplit { id: 2, category_id: 2, category_name: "Dining".into(), amount_minor: -2_000 },
            ],
        )];
        let rows = build_rows(&txs, &accounts, &categories, "MUR");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].category, "Groceries");
        assert_eq!(rows[0].amount, "-30.00");
        assert_eq!(rows[1].category, "Dining");
        assert_eq!(rows[1].amount, "-20.00");
    }

    #[test]
    fn income_kind_label_and_foreign_currency_base_conversion() {
        let (accounts, categories) = maps();
        let mut income = tx(
            3,
            "45.5",
            vec![TxSplit { id: 3, category_id: 9, category_name: "Salary".into(), amount_minor: 10_000 }],
        );
        income.currency = "USD".into();
        let txs = [income];
        let rows = build_rows(&txs, &accounts, &categories, "MUR");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].kind, "Income");
        assert_eq!(rows[0].amount, "100.00");
        assert_eq!(rows[0].currency, "USD");
        assert_eq!(rows[0].base_amount, "4550.00");
        assert_eq!(rows[0].base_currency, "MUR");
    }

    #[test]
    fn missing_account_or_note_falls_back_to_empty_string() {
        let (_, categories) = maps();
        let accounts = HashMap::new(); // account id 1 not in the map
        let mut t = tx(
            4,
            "1",
            vec![TxSplit { id: 4, category_id: 1, category_name: "Groceries".into(), amount_minor: -500 }],
        );
        t.note = None;
        let txs = [t];
        let rows = build_rows(&txs, &accounts, &categories, "MUR");
        assert_eq!(rows[0].account, "");
        assert_eq!(rows[0].note, "");
    }

    #[test]
    fn build_rows_reconciles_fractional_fx_split_transaction_without_drift() {
        // Mirrors `allocate_base`'s own doc example: 200 minor @ fx 0.335 -> stored base 67
        // (exact). Two 100-minor splits would each independently round `100 * 0.335 = 33.5` to 34,
        // summing to 68 - one over the ledger total. Allocating from the transaction's own stored
        // base reconciles to 67: "0.34" + "0.33", never "0.34" + "0.34".
        let (accounts, categories) = maps();
        let txs = [tx(
            5,
            "0.335",
            vec![
                TxSplit { id: 5, category_id: 1, category_name: "Groceries".into(), amount_minor: 100 },
                TxSplit { id: 6, category_id: 2, category_name: "Dining".into(), amount_minor: 100 },
            ],
        )];
        assert_eq!(txs[0].base_amount_minor, 67, "sanity: the transaction's own stored base amount");

        let rows = build_rows(&txs, &accounts, &categories, "MUR");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].base_amount, "0.34");
        assert_eq!(rows[1].base_amount, "0.33");

        let base_minor_sum = 34i64 + 33i64;
        assert_eq!(base_minor_sum, 67, "must reconcile to the parent's stored base, not 68");
    }

    #[test]
    fn build_rows_snapshot() {
        let (accounts, categories) = maps();
        let txs = [
            tx(
                1,
                "1",
                vec![
                    TxSplit { id: 1, category_id: 1, category_name: "Groceries".into(), amount_minor: -3_000 },
                    TxSplit { id: 2, category_id: 2, category_name: "Dining".into(), amount_minor: -2_000 },
                ],
            ),
            tx(
                2,
                "1",
                vec![TxSplit { id: 3, category_id: 9, category_name: "Salary".into(), amount_minor: 200_000 }],
            ),
        ];
        let rows = build_rows(&txs, &accounts, &categories, "MUR");
        insta::assert_debug_snapshot!("build_rows_example", rows);
    }
}
