//! CSV writer for the transaction export (FR-4.2): a header row followed by one record per
//! `ExportRow`. Amounts are the plain decimal STRINGS `rows::build_rows` already formatted (via
//! `domain::money::minor_to_major_string`) - this module does no money math, just serialises text.

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

/// Serialise `rows` to a CSV byte buffer (header + one record per row).
pub fn to_csv(rows: &[ExportRow]) -> Result<Vec<u8>, ExportError> {
    let mut writer = WriterBuilder::new().from_writer(Vec::new());
    writer.write_record(HEADERS)?;
    for r in rows {
        writer.write_record([
            r.date.as_str(),
            r.account.as_str(),
            r.payee.as_str(),
            r.category.as_str(),
            r.kind.as_str(),
            r.amount.as_str(),
            r.currency.as_str(),
            r.base_amount.as_str(),
            r.base_currency.as_str(),
            r.note.as_str(),
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
}
