//! XLSX writer for the transaction export (FR-4.2), via `rust_xlsxwriter`. A bold header row
//! followed by one worksheet row per `ExportRow`. Every cell (including amounts) is written with
//! `write_string`/`write_string_with_format` - NEVER `write_number` (which takes an `f64`) - so no
//! float ever enters the money path; the exported amount cells are text, a documented tradeoff
//! (see the export ADR) until a finance-validated numeric-cell change.

use rust_xlsxwriter::{Format, Workbook};

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

/// Serialise `rows` to an in-memory `.xlsx` byte buffer.
pub fn to_xlsx(rows: &[ExportRow]) -> Result<Vec<u8>, ExportError> {
    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();
    let bold = Format::new().set_bold();

    for (col, header) in HEADERS.iter().enumerate() {
        sheet.write_string_with_format(0, col as u16, *header, &bold)?;
    }
    for (i, r) in rows.iter().enumerate() {
        let row = (i + 1) as u32;
        sheet.write_string(row, 0, r.date.as_str())?;
        sheet.write_string(row, 1, r.account.as_str())?;
        sheet.write_string(row, 2, r.payee.as_str())?;
        sheet.write_string(row, 3, r.category.as_str())?;
        sheet.write_string(row, 4, r.kind.as_str())?;
        sheet.write_string(row, 5, r.amount.as_str())?;
        sheet.write_string(row, 6, r.currency.as_str())?;
        sheet.write_string(row, 7, r.base_amount.as_str())?;
        sheet.write_string(row, 8, r.base_currency.as_str())?;
        sheet.write_string(row, 9, r.note.as_str())?;
    }
    workbook.save_to_buffer().map_err(ExportError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows() -> Vec<ExportRow> {
        vec![ExportRow {
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
        }]
    }

    #[test]
    fn produces_a_non_empty_zip_encoded_workbook() {
        let bytes = to_xlsx(&rows()).unwrap();
        assert!(!bytes.is_empty());
        // .xlsx is a ZIP container; the ZIP local-file-header magic is `PK\x03\x04`.
        assert_eq!(&bytes[0..4], b"PK\x03\x04");
    }

    #[test]
    fn empty_rows_still_produces_a_valid_workbook() {
        let bytes = to_xlsx(&[]).unwrap();
        assert!(!bytes.is_empty());
        assert_eq!(&bytes[0..4], b"PK\x03\x04");
    }
}
