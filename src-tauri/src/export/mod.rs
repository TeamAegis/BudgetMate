//! Data export (FR-4.2): transaction history to CSV and Excel (.xlsx) via `rust_xlsxwriter`, to a
//! user-chosen location. Export is plaintext by design (for external use); the UI warns the user.
//!
//! Skeleton: the export format enum is defined; writers are wired in a later change. (Encrypted
//! backups — FR-4.1 — copy the already-encrypted SQLCipher file via the save dialog and live with
//! the backup/restore flow, not here.)

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Csv,
    Xlsx,
    Json,
}
