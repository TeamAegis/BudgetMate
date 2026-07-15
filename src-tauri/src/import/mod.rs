//! Bank-file import (FR-2.2): CSV, OFX 1.x/2.x, and QFX parsed into normalised `StagedTx`, then
//! run through the rule engine + dedup and reviewed by the user before an ACID batch insert.
//!
//! Skeleton: the normalised staging type is defined. The OFX 1.x/2.x/QFX parser is implemented,
//! self-contained, in `import/ofx.rs` (`parse_ofx`) - see `docs/adr/0009-hand-rolled-ofx-parser.md`.
//! The `csv` parser, the import command surface, dedup/rule wiring, and the review UI land in a
//! later change (issue #12); this module does no DB writes and no IPC.

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportFormat {
    Csv,
    Ofx,
    Qfx,
}

/// The outcome of parsing an import file: normalised rows plus any per-row failures (malformed
/// rows are reported, never silently dropped - FR-2.2).
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
