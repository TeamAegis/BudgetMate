//! CSV bank-file parsing (FR-2.2): pure parse + column mapping - no DB, no rule engine, no
//! dedup (those live in `db::imports`, which wires this against the DB). Every data row is either
//! staged (`StagedRow`) or reported as a `RowError` with the reason - malformed rows are surfaced
//! to the user, never silently dropped (design.md "Flows that must never auto-commit").

use ::csv::{ReaderBuilder, StringRecord};
use serde::Serialize;

use crate::domain::money::parse_minor;
use crate::import::{StagedRow, StagedTx};

/// Header row + a handful of sample data rows, for the column-mapping UI.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CsvHeaders {
    pub headers: Vec<String>,
    pub sample_rows: Vec<Vec<String>>,
}

/// Which source column (0-based index into the header row) feeds each target field. `date` and
/// `amount` are required; the rest are optional.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ColumnMapping {
    pub date: usize,
    pub amount: usize,
    pub payee: Option<usize>,
    pub note: Option<usize>,
    pub source_ref: Option<usize>,
}

/// A data row that could not be parsed - reported to the user, never silently dropped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowError {
    /// 0-based data-row index (excludes the header row); stable across preview and commit since
    /// both re-parse the same file.
    pub row: usize,
    pub message: String,
}

/// Result of parsing a whole file against a `ColumnMapping`. `rows` uses the shared
/// `import::StagedRow` (0-based data-row index, excludes the header row) - the same shape OFX/QFX
/// parsing produces, so `db::imports` can share one preview/commit core across formats.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedRows {
    pub rows: Vec<StagedRow>,
    pub errors: Vec<RowError>,
}

fn reader(content: &str) -> ::csv::Reader<&[u8]> {
    // `flexible(true)`: tolerate ragged real-world exports (a short row just yields missing
    // columns, reported as a `RowError`, rather than aborting the whole file).
    ReaderBuilder::new().flexible(true).has_headers(true).from_reader(content.as_bytes())
}

/// Parse the header row + up to 5 sample data rows (for the mapping UI). A completely unreadable
/// file yields empty headers/samples - the caller's UI shows that as "couldn't read that file".
pub fn read_headers(content: &str) -> CsvHeaders {
    let mut r = reader(content);
    let headers = r.headers().map(|h| h.iter().map(str::to_string).collect()).unwrap_or_default();
    let sample_rows = r
        .records()
        .take(5)
        .filter_map(|rec| rec.ok())
        .map(|rec| rec.iter().map(str::to_string).collect())
        .collect();
    CsvHeaders { headers, sample_rows }
}

/// Normalise a date to ISO `yyyy-mm-dd`. Accepts ISO input as-is and the Mauritius `dd/mm/yyyy`
/// (also `dd-mm-yyyy`) convention (docs/financial-knowledge.md §8, matches `rules::receipt`).
/// Returns `None` for a blank or unrecognised value.
fn normalise_date(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(d) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(d.format("%Y-%m-%d").to_string());
    }
    for fmt in ["%d/%m/%Y", "%d-%m-%Y"] {
        if let Ok(d) = chrono::NaiveDate::parse_from_str(s, fmt) {
            return Some(d.format("%Y-%m-%d").to_string());
        }
    }
    None
}

/// Strip a leading `+` and any `,` thousands separators before parsing (common bank-export
/// conventions). Does not attempt locale-specific decimal-separator handling (out of scope).
fn clean_amount(raw: &str) -> String {
    let s = raw.trim();
    let s = s.strip_prefix('+').unwrap_or(s);
    s.chars().filter(|&c| c != ',').collect()
}

/// Trimmed, non-empty cell at `idx`, or `None` if the row is too short / the cell is blank.
fn cell(rec: &StringRecord, idx: usize) -> Option<&str> {
    rec.get(idx).map(str::trim).filter(|s| !s.is_empty())
}

/// Parse every data row against `mapping` in the given `currency`. Malformed rows (missing or
/// unrecognised date, missing or unrecognised amount) are reported as a `RowError` (a 0-based row
/// index plus a plain-language reason) and excluded from `rows` - never silently dropped. The
/// amount's SIGN from the file is preserved (negative is money out, positive is money in);
/// imports do not derive sign from a category kind the way manual entry does (docs/adr/0010).
pub fn parse_rows(content: &str, mapping: &ColumnMapping, currency: &str) -> ParsedRows {
    let mut rows = Vec::new();
    let mut errors = Vec::new();

    for (row, rec) in reader(content).records().enumerate() {
        let rec = match rec {
            Ok(r) => r,
            Err(e) => {
                errors.push(RowError { row, message: format!("could not read this row: {e}") });
                continue;
            }
        };

        let (Some(date_raw), Some(amount_raw)) = (cell(&rec, mapping.date), cell(&rec, mapping.amount))
        else {
            errors.push(RowError { row, message: "missing date or amount".to_string() });
            continue;
        };
        let Some(posted_date) = normalise_date(date_raw) else {
            errors.push(RowError { row, message: format!("unrecognised date '{date_raw}'") });
            continue;
        };
        let amount_minor = match parse_minor(&clean_amount(amount_raw), currency) {
            Ok(m) => m,
            Err(e) => {
                errors.push(RowError {
                    row,
                    message: format!("unrecognised amount '{amount_raw}': {e}"),
                });
                continue;
            }
        };

        rows.push(StagedRow {
            row,
            staged: StagedTx {
                posted_date,
                amount_minor,
                currency: currency.to_string(),
                payee: mapping.payee.and_then(|i| cell(&rec, i)).map(str::to_string),
                note: mapping.note.and_then(|i| cell(&rec, i)).map(str::to_string),
                source_ref: mapping.source_ref.and_then(|i| cell(&rec, i)).map(str::to_string),
            },
        });
    }

    ParsedRows { rows, errors }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mapping() -> ColumnMapping {
        ColumnMapping { date: 0, amount: 2, payee: Some(1), note: None, source_ref: None }
    }

    #[test]
    fn reads_headers_and_up_to_five_sample_rows() {
        let content = "Date,Description,Amount\n\
                        2026-06-01,Winners,-450.00\n\
                        2026-06-02,Salary,20000.00\n\
                        2026-06-03,Cafe,-120.00\n\
                        2026-06-04,Rent,-15000.00\n\
                        2026-06-05,Shop,-300.00\n\
                        2026-06-06,Extra,-10.00\n";
        let h = read_headers(content);
        assert_eq!(h.headers, vec!["Date", "Description", "Amount"]);
        assert_eq!(h.sample_rows.len(), 5, "capped at 5 sample rows");
        assert_eq!(h.sample_rows[0], vec!["2026-06-01", "Winners", "-450.00"]);
    }

    #[test]
    fn parses_iso_and_mauritius_dates_preserving_the_files_sign() {
        let content = "Date,Description,Amount\n\
                        2026-06-01,Winners,-450.00\n\
                        05/06/2026,Salary,20000.00\n";
        let parsed = parse_rows(content, &mapping(), "MUR");
        assert!(parsed.errors.is_empty());
        assert_eq!(parsed.rows.len(), 2);
        assert_eq!(parsed.rows[0].staged.posted_date, "2026-06-01");
        assert_eq!(parsed.rows[0].staged.amount_minor, -45_000, "expense stays negative");
        assert_eq!(parsed.rows[0].staged.payee.as_deref(), Some("Winners"));
        // 05/06/2026 is Mauritius dd/mm/yyyy -> 5 June 2026.
        assert_eq!(parsed.rows[1].staged.posted_date, "2026-06-05");
        assert_eq!(parsed.rows[1].staged.amount_minor, 2_000_000, "income stays positive");
    }

    #[test]
    fn strips_leading_plus_and_thousands_commas() {
        // The thousands-separated amount must be quoted in the CSV itself, or its comma would be
        // read as a column delimiter - that is a CSV-quoting concern, separate from our cleanup.
        let content = "Date,Description,Amount\n2026-06-01,Salary,\"+20,000.00\"\n";
        let parsed = parse_rows(content, &mapping(), "MUR");
        assert!(parsed.errors.is_empty());
        assert_eq!(parsed.rows[0].staged.amount_minor, 2_000_000);
    }

    #[test]
    fn reports_missing_or_unrecognised_fields_as_row_errors_not_silent_drops() {
        let content = "Date,Description,Amount\n\
                        ,Winners,-450.00\n\
                        2026-06-01,Cafe,not-a-number\n\
                        13/13/2026,Shop,-10.00\n\
                        2026-06-02,Ok Row,-5.00\n";
        let parsed = parse_rows(content, &mapping(), "MUR");
        assert_eq!(parsed.rows.len(), 1, "only the one well-formed row is staged");
        assert_eq!(parsed.errors.len(), 3, "every malformed row is reported, not dropped");
        assert_eq!(parsed.errors[0].row, 0);
        assert_eq!(parsed.errors[1].row, 1);
        assert_eq!(parsed.errors[2].row, 2);
        assert!(parsed.errors[1].message.contains("amount"));
    }

    #[test]
    fn ragged_rows_are_reported_not_panicking() {
        // flexible(true) tolerates the short row at the csv level; our column lookup then reports
        // the missing amount cell as a row error rather than panicking on an out-of-range index.
        let content = "Date,Description,Amount\n2026-06-01,Too Short\n2026-06-02,Ok,-5.00\n";
        let parsed = parse_rows(content, &mapping(), "MUR");
        assert_eq!(parsed.rows.len(), 1);
        assert_eq!(parsed.errors.len(), 1);
        assert_eq!(parsed.errors[0].row, 0);
    }

    #[test]
    fn note_and_source_ref_columns_are_optional() {
        let content = "Date,Description,Amount,Ref,Memo\n2026-06-01,Winners,-450.00,CHQ001,Groceries run\n";
        let m = ColumnMapping {
            date: 0,
            amount: 2,
            payee: Some(1),
            note: Some(4),
            source_ref: Some(3),
        };
        let parsed = parse_rows(content, &m, "MUR");
        assert!(parsed.errors.is_empty());
        let row = &parsed.rows[0].staged;
        assert_eq!(row.note.as_deref(), Some("Groceries run"));
        assert_eq!(row.source_ref.as_deref(), Some("CHQ001"));
    }
}
