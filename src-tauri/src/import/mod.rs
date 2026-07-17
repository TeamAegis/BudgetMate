//! Bank-file import (FR-2.2): CSV, OFX 1.x/2.x, and QFX parsed into normalised `StagedTx`, then
//! run through the rule engine + dedup and reviewed by the user before an ACID batch insert.
//!
//! CSV is wired end-to-end (`import::csv` for the pure parse, `db::imports` for the DB-aware
//! pipeline, `commands::import` for IPC). The OFX 1.x/2.x/QFX parser is implemented,
//! self-contained, in `import/ofx.rs` (`parse_ofx`; see
//! `docs/adr/0009-hand-rolled-ofx-parser.md`), but is NOT yet wired to the command surface: the
//! three `import_*` commands reject a non-CSV `format`. Wiring OFX through `db::imports` is its
//! own change.
//!
//! Note the two per-row failure types, which are deliberately distinct rather than shared: OFX
//! reports `import::RowError` (keyed by transaction-block ordinal + the bank's `FITID`), while CSV
//! reports `import::csv::RowError` (keyed by 0-based data-row index, which `skipRows` refers back
//! to). Only the CSV one crosses IPC today. Unifying them is a follow-up, not a merge-time
//! refactor.

pub mod csv;
pub mod ofx;

/// A parsed-but-not-yet-saved transaction from an imported file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagedTx {
    pub posted_date: String, // ISO yyyy-mm-dd
    pub amount_minor: i64,
    pub currency: String,
    pub payee: Option<String>,
    pub note: Option<String>,
    pub source_ref: Option<String>,
}

/// Which bank-file format is being imported. Mirrors TS `ImportFormat`. Stored in the `imports`
/// audit table's `format` column as the lowercase str.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportFormat {
    Csv,
    Ofx,
    Qfx,
}

impl ImportFormat {
    pub fn as_str(&self) -> &'static str {
        match self {
            ImportFormat::Csv => "csv",
            ImportFormat::Ofx => "ofx",
            ImportFormat::Qfx => "qfx",
        }
    }
}

/// The outcome of parsing an import file: normalised rows plus any per-row failures (malformed
/// rows are reported, never silently dropped - FR-2.2). Produced by `import::ofx`; the CSV parser
/// has its own row-index-keyed `csv::ParsedRows` (see the module note above).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedImport {
    pub transactions: Vec<StagedTx>,
    pub row_errors: Vec<RowError>,
}

/// A single transaction block that could not be normalised. `message` is STRUCTURAL only - never
/// echo payee/memo/amount text (the `error.rs` "no secrets" rule extends to user financial data).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RowError {
    /// 0-based ordinal of the transaction block within the file.
    pub index: usize,
    /// The bank's own transaction id (`FITID`), if it parsed before the failure.
    pub source_ref: Option<String>,
    /// Plain-language, structural reason (no financial data).
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn as_str_matches_serde_lowercase() {
        assert_eq!(ImportFormat::Csv.as_str(), "csv");
        assert_eq!(ImportFormat::Ofx.as_str(), "ofx");
        assert_eq!(ImportFormat::Qfx.as_str(), "qfx");
    }
}
