//! Encrypted local backup (FR-4.1): a `.vaultbak` file is a JSON envelope bundling the
//! ALREADY-ENCRYPTED SQLCipher database bytes plus the non-secret bootstrap material (salt +
//! Argon2id `KdfParams`) that normally lives in `vault-meta.json` and is required to re-derive the
//! key on restore - a bare copy of `budgetmate.db` is NOT restore-portable without it, because that
//! material lives in the separate meta sidecar. No plaintext financial data is ever written: the
//! `db` bytes stay SQLCipher-encrypted end to end.
//!
//! **Desktop-first slice** (mirrors `docs/adr/0006-export-desktop-first-android-saf-deferred.md`;
//! see `docs/adr/0007-encrypted-backup-desktop-first.md`). This module is pure - no Tauri, dialog,
//! or `DbState` here - `commands::backup::create_backup` reads the consistent, already-encrypted DB
//! snapshot under the `DbState` mutex, then calls into this module to build and serialise the
//! envelope, and writes the bytes with `std::fs::write` to a path chosen via the save dialog.
//! Restore (FR-4.3, REPLACE mode - see `restore` submodule and
//! `docs/adr/0008-restore-replace-desktop-first-merge-deferred.md`) reads this same envelope shape:
//! same passphrase + the carried salt/kdf re-derive the key on any device. **v1 of the envelope also
//! carries `baseCurrency`** (serde-default MUR for a backup written before this field existed) -
//! money-correctness: `base_amount_minor` on every restored row was computed against the SOURCE
//! device's base currency, so a restore must adopt it rather than keep the local install's.

use serde::{Deserialize, Serialize};

use crate::crypto::KdfParams;
use crate::vault::VaultMeta;

pub mod restore;

/// Bumped only on a breaking change to the envelope shape; the `restore` submodule branches on it.
pub const BACKUP_FORMAT_VERSION: u32 = 1;

fn default_base_currency() -> String {
    crate::vault::DEFAULT_BASE_CURRENCY.to_string()
}

/// The `.vaultbak` container. This is a FILE FORMAT, not an IPC DTO - it never crosses `invoke()`,
/// so it has no TS mirror (listed in `DTO_SKIP`, `scripts/guards.mjs`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultBackup {
    pub format_version: u32,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// Informational only (e.g. "BudgetMate 0.1.0"); never parsed by a restore path.
    pub app: String,
    pub meta_version: u32,
    #[serde(with = "b64_bytes")]
    pub salt: Vec<u8>,
    pub kdf: KdfParams,
    /// The SQLCipher-encrypted `budgetmate.db` bytes, verbatim. Never plaintext.
    #[serde(with = "b64_bytes")]
    pub db: Vec<u8>,
    /// The source device's base (reporting) currency at backup time - every `base_amount_minor` in
    /// `db` is denominated in it. `#[serde(default)]` so a backup written before this field existed
    /// still parses (defaults to MUR, the app default).
    #[serde(default = "default_base_currency")]
    pub base_currency: String,
}

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("could not build the backup file: {0}")]
    Serde(String),
}

impl From<serde_json::Error> for BackupError {
    fn from(e: serde_json::Error) -> Self {
        BackupError::Serde(e.to_string())
    }
}

/// Base64 (standard alphabet, padded) adapter for the envelope's binary fields - keeps the file
/// compact. serde_json's default `Vec<u8>` encoding is a JSON array of numbers, which bloats a
/// multi-MB database roughly 3-4x; a base64 string does not.
mod b64_bytes {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &[u8], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(d)?;
        STANDARD.decode(&s).map_err(serde::de::Error::custom)
    }
}

/// Bundle already-encrypted DB bytes + the meta sidecar's non-secret bootstrap material into a
/// backup envelope. Pure (no I/O, no key access - the DB bytes are already SQLCipher-encrypted).
pub fn build_envelope(db_bytes: Vec<u8>, meta: &VaultMeta, now_iso: &str, app: &str) -> VaultBackup {
    VaultBackup {
        format_version: BACKUP_FORMAT_VERSION,
        created_at: now_iso.to_string(),
        app: app.to_string(),
        meta_version: meta.meta_version,
        salt: meta.salt.clone(),
        kdf: meta.kdf.clone(),
        db: db_bytes,
        base_currency: meta.settings.base_currency.clone(),
    }
}

/// Serialise the envelope to bytes for `std::fs::write`. Pure - the caller (the `create_backup`
/// command) writes the returned bytes to the user-chosen destination.
pub fn to_bytes(backup: &VaultBackup) -> Result<Vec<u8>, BackupError> {
    Ok(serde_json::to_vec(backup)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::VaultSettings;
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    fn meta() -> VaultMeta {
        VaultMeta {
            meta_version: 1,
            salt: vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
            kdf: KdfParams::default(),
            created_at: "2026-06-05T00:00:00Z".to_string(),
            settings: VaultSettings::default(),
        }
    }

    fn meta_with_currency(currency: &str) -> VaultMeta {
        let mut m = meta();
        m.settings.base_currency = currency.to_string();
        m
    }

    #[test]
    fn build_envelope_copies_meta_fields() {
        let m = meta();
        let env = build_envelope(vec![9, 9, 9], &m, "2026-07-14T00:00:00Z", "BudgetMate 0.1.0");
        assert_eq!(env.format_version, BACKUP_FORMAT_VERSION);
        assert_eq!(env.meta_version, m.meta_version);
        assert_eq!(env.salt, m.salt);
        assert_eq!(env.kdf, m.kdf);
        assert_eq!(env.db, vec![9, 9, 9]);
        assert_eq!(env.created_at, "2026-07-14T00:00:00Z");
        assert_eq!(env.app, "BudgetMate 0.1.0");
        assert_eq!(env.base_currency, m.settings.base_currency);
    }

    #[test]
    fn build_envelope_carries_the_meta_base_currency() {
        let m = meta_with_currency("USD");
        let env = build_envelope(vec![1], &m, "2026-07-14T00:00:00Z", "BudgetMate 0.1.0");
        assert_eq!(env.base_currency, "USD");
    }

    #[test]
    fn base_currency_defaults_to_mur_when_absent_from_the_wire() {
        // A backup written before this field existed still parses (money-correctness fallback).
        let json = serde_json::json!({
            "formatVersion": 1,
            "createdAt": "2026-06-05T00:00:00Z",
            "app": "BudgetMate 0.1.0",
            "metaVersion": 1,
            "salt": "AQIDBAUGBwgJCgsMDQ4PEA==",
            "kdf": {
                "algorithm": "argon2id",
                "version": 19,
                "m_cost": 19456,
                "t_cost": 2,
                "p_cost": 1,
                "output_len": 32
            },
            "db": "AQID"
        });
        let env: VaultBackup = serde_json::from_value(json).unwrap();
        assert_eq!(env.base_currency, "MUR");
    }

    #[test]
    fn to_bytes_round_trips_via_serde_json() {
        let m = meta();
        let env =
            build_envelope(vec![10, 20, 30, 40], &m, "2026-07-14T00:00:00Z", "BudgetMate 0.1.0");
        let bytes = to_bytes(&env).unwrap();
        let back: VaultBackup = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(back, env);
    }

    #[test]
    fn salt_and_db_are_base64_strings_not_a_numeric_array() {
        let m = meta();
        let env = build_envelope(vec![255, 0, 128], &m, "2026-07-14T00:00:00Z", "BudgetMate 0.1.0");
        let json: serde_json::Value = serde_json::from_slice(&to_bytes(&env).unwrap()).unwrap();
        assert!(json["salt"].is_string());
        assert!(json["db"].is_string());
        // Decoding the wire string reproduces the original bytes exactly.
        let decoded_db = STANDARD.decode(json["db"].as_str().unwrap()).unwrap();
        assert_eq!(decoded_db, vec![255, 0, 128]);
        let decoded_salt = STANDARD.decode(json["salt"].as_str().unwrap()).unwrap();
        assert_eq!(decoded_salt, m.salt);
    }
}
