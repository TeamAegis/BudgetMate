//! App-wide error type that crosses the IPC boundary. It serialises as an adjacently-tagged enum
//! (`{ "kind": ..., "message": ... }`) so the frontend can switch on `kind` (mirror: `AppError` in
//! `src/app/core/models`). Log once at the command boundary; never put secrets (keys, passphrases,
//! decrypted data) in a message.

use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum AppError {
    /// The vault is locked (no key in memory): the UI should route to unlock and retry.
    #[error("database is locked")]
    Locked,
    /// Wrong passphrase or a corrupt database. Deliberately one variant (no wrong-key-vs-corrupt
    /// oracle).
    #[error("wrong passphrase or corrupt database")]
    KeyVerificationFailed,
    /// A user-fixable input or validation error. Safe to surface (after translation) to the user.
    #[error("{0}")]
    Validation(String),
    /// An unexpected database / storage error. The message is sanitised (no secrets).
    #[error("{0}")]
    Database(String),
    /// Any other internal error (path resolution, IO, key derivation, plugin failure).
    #[error("{0}")]
    Internal(String),
}

impl From<crate::db::DbError> for AppError {
    fn from(e: crate::db::DbError) -> Self {
        use crate::db::DbError;
        match e {
            DbError::Sqlite(err) => AppError::Database(err.to_string()),
            DbError::KeyVerificationFailed => AppError::KeyVerificationFailed,
            DbError::Invalid(msg) => AppError::Validation(msg),
        }
    }
}

impl From<crate::export::ExportError> for AppError {
    fn from(e: crate::export::ExportError) -> Self {
        use crate::export::ExportError;
        let msg = e.to_string();
        match e {
            // The UI never offers JSON (screens.md §7.4); a stray call is a caller mistake.
            ExportError::Unsupported => AppError::Validation(msg),
            // A writer failure (disk-full-at-buffer-time, encoding issue) is unexpected/internal.
            ExportError::Csv(_) | ExportError::Xlsx(_) => AppError::Internal(msg),
        }
    }
}

impl From<crate::backup::BackupError> for AppError {
    fn from(e: crate::backup::BackupError) -> Self {
        // Only ever a serialisation failure building the envelope - unexpected/internal, and the
        // message never contains salt/kdf/key/passphrase/db bytes (see `backup::BackupError`).
        AppError::Internal(e.to_string())
    }
}

impl From<crate::vault::VaultError> for AppError {
    fn from(e: crate::vault::VaultError) -> Self {
        use crate::vault::VaultError;
        let msg = e.to_string();
        match e {
            // User-fixable / expected states.
            VaultError::PassphraseTooShort
            | VaultError::AlreadyInitialised
            | VaultError::NotInitialised => AppError::Validation(msg),
            // Unexpected / unrecoverable on-disk states.
            VaultError::Io(_)
            | VaultError::CorruptMeta
            | VaultError::Inconsistent
            | VaultError::Random => AppError::Internal(msg),
        }
    }
}
