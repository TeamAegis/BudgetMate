//! Bank-file import (FR-2.2): CSV, OFX 1.x/2.x, and QFX parsed into normalised `StagedTx`, then
//! run through the rule engine + dedup and reviewed by the user before an ACID batch insert.
//!
//! CSV is wired end-to-end (`import::csv` for the pure parse, `db::imports` for the DB-aware
//! pipeline, `commands::import` for IPC). The `ofx`/`qfx` parsers are a later change (issue #13;
//! OFX will live behind its own `import/ofx.rs`, the least-mature dependency, isolated there).

pub mod csv;

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
