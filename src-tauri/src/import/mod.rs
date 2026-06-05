//! Bank-file import (FR-2.2): CSV, OFX 1.x/2.x, and QFX parsed into normalised `StagedTx`, then
//! run through the rule engine + dedup and reviewed by the user before an ACID batch insert.
//!
//! Skeleton: the normalised staging type is defined; the `csv` and `ofx`/`qfx` parsers are wired
//! in a later change (OFX behind `import/ofx.rs`, the least-mature dependency, isolated there).

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportFormat {
    Csv,
    Ofx,
    Qfx,
}
