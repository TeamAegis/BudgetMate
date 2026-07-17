//! CSV writer for the transaction export (FR-4.2): a header row followed by one record per
//! `ExportRow`. Amounts are the plain decimal STRINGS `rows::build_rows` already formatted (via
//! `domain::money::minor_to_major_string`) - this module does no money math, just serialises text.
//!
//! Free-text cells (account, payee, category, note) are sanitised against CSV/formula injection
//! (CWE-1236): Excel/Sheets auto-interprets a cell starting with `=`, `+`, `-`, or `@` as a formula
//! when the file is opened. This applies ONLY to the free-text columns - never to `amount` /
//! `base_amount` (which legitimately start with `-` for an expense and must stay numeric) nor to
//! date/currency/kind/base_currency (controlled vocabulary).

use ::csv::WriterBuilder;

use super::rows::ExportRow;
use super::ExportError;

const HEADERS: [&str; 10] = [
    "Date",
    "Account",
    "Payee",
    "Category",
    "Kind",
    "Amount",
    "Currency",
    "Base amount",
    "Base currency",
    "Note",
];

/// Prefix a free-text cell with a leading apostrophe if it begins with a character (`=`, `+`, `-`,
/// `@`) a spreadsheet would otherwise interpret as the start of a formula. The apostrophe forces
/// text interpretation in Excel/Sheets and is not itself displayed. Cells that don't start with one
/// of those characters are returned unchanged (no allocation).
fn sanitize_csv_cell(value: &str) -> std::borrow::Cow<'_, str> {
    match value.chars().next() {
        Some('=') | Some('+') | Some('-') | Some('@') => {
            std::borrow::Cow::Owned(format!("'{value}"))
        }
        _ => std::borrow::Cow::Borrowed(value),
    }
}

/// Serialise `rows` to a CSV byte buffer (header + one record per row).
pub fn to_csv(rows: &[ExportRow]) -> Result<Vec<u8>, ExportError> {
    let mut writer = WriterBuilder::new().from_writer(Vec::new());
    writer.write_record(HEADERS)?;
    for r in rows {
        writer.write_record([
            r.date.as_str(),
            sanitize_csv_cell(&r.account).as_ref(),
            sanitize_csv_cell(&r.payee).as_ref(),
            sanitize_csv_cell(&r.category).as_ref(),
            r.kind.as_str(),
            r.amount.as_str(),
            r.currency.as_str(),
            r.base_amount.as_str(),
            r.base_currency.as_str(),
            sanitize_csv_cell(&r.note).as_ref(),
        ])?;
    }
    writer.into_inner().map_err(|e| ExportError::Csv(e.into_error().into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows() -> Vec<ExportRow> {
        vec![
            ExportRow {
                date: "2026-06-06".into(),
                account: "Cash".into(),
                payee: "Market".into(),
                category: "Groceries".into(),
                kind: "Expense".into(),
                amount: "-30.00".into(),
                currency: "MUR".into(),
                base_amount: "-30.00".into(),
                base_currency: "MUR".into(),
                note: "weekly shop".into(),
            },
            ExportRow {
                date: "2026-06-10".into(),
                account: "Cash".into(),
                payee: String::new(),
                category: "Salary".into(),
                kind: "Income".into(),
                amount: "2000.00".into(),
                currency: "MUR".into(),
                base_amount: "2000.00".into(),
                base_currency: "MUR".into(),
                note: String::new(),
            },
        ]
    }

    #[test]
    fn empty_rows_still_writes_the_header() {
        let bytes = to_csv(&[]).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert_eq!(text.trim_end(), HEADERS.join(","));
    }

    #[test]
    fn csv_snapshot() {
        let bytes = to_csv(&rows()).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        insta::assert_snapshot!("export_csv_example", text);
    }

    #[test]
    fn formula_like_free_text_cells_are_prefixed_with_an_apostrophe() {
        let mut malicious = rows();
        malicious[0].payee = "=1+1".into();
        malicious[0].category = "=HYPERLINK(https://evil.example)".into();
        malicious[0].account = "+SUM(A1:A9)".into();
        malicious[1].note = "@import".into();

        let bytes = to_csv(&malicious).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("'=1+1"), "payee starting with '=' must be neutralised");
        assert!(
            text.contains("'=HYPERLINK(https://evil.example)"),
            "category starting with '=' must be neutralised"
        );
        assert!(text.contains("'+SUM(A1:A9)"), "account starting with '+' must be neutralised");
        assert!(text.contains("'@import"), "note starting with '@' must be neutralised");
    }

    #[test]
    fn negative_amounts_are_never_sanitised() {
        // amount/base_amount legitimately start with '-' for an expense and must stay numeric -
        // the sanitiser must never touch those columns.
        let bytes = to_csv(&rows()).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("-30.00"), "amount must be emitted unchanged, never prefixed");
        assert!(!text.contains("'-30.00"), "amount must never be treated as a formula-like cell");
    }
}
