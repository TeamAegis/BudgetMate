//! Vault bootstrap metadata + lock settings.
//!
//! The DB key = `KDF(passphrase, salt, params)`, so the salt and the recorded Argon2 parameters
//! must be readable **while the vault is locked** - they cannot live inside the encrypted DB we
//! are trying to open. They are stored UNENCRYPTED in `app_data_dir/vault-meta.json`. This is
//! safe: the salt and KDF cost are not secret; security rests entirely on the user passphrase and
//! the Argon2 work factor. The DB key and passphrase are NEVER written here (or logged).

use crate::crypto::KdfParams;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub mod biometric;

pub const META_FILENAME: &str = "vault-meta.json";
pub const DB_FILENAME: &str = "budgetmate.db";
pub const CURRENT_META_VERSION: u32 = 1;
pub const DEFAULT_IDLE_TIMEOUT_SECS: u32 = 120;
/// Default base (reporting) currency - design-system §8 (MUR, "Rs").
pub const DEFAULT_BASE_CURRENCY: &str = "MUR";
/// Default dedup window in days (FR-2.4) - must equal `db::imports::DEFAULT_WINDOW_DAYS`.
pub const DEFAULT_DEDUP_WINDOW_DAYS: u32 = 3;

fn default_base_currency() -> String {
    DEFAULT_BASE_CURRENCY.to_string()
}

fn default_dedup_window_days() -> u32 {
    DEFAULT_DEDUP_WINDOW_DAYS
}

const SALT_LEN: usize = 16;
const MIN_PASSPHRASE_LEN: usize = 8;

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("io error: {0}")]
    Io(String),
    #[error("vault metadata is corrupt")]
    CorruptMeta,
    #[error("vault is already initialised")]
    AlreadyInitialised,
    #[error("vault is not initialised")]
    NotInitialised,
    #[error("inconsistent vault state")]
    Inconsistent,
    #[error("passphrase is too short")]
    PassphraseTooShort,
    #[error("secure random source failed")]
    Random,
}

/// Non-sensitive lock preferences. Stored in the meta sidecar so they are readable at boot before
/// the DB is unlocked. Mirrors TS `VaultSettings` 1:1.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSettings {
    /// Idle auto-lock timeout in seconds. `0` disables the idle timer (mobile background-lock
    /// still applies).
    pub idle_timeout_secs: u32,
    /// Whether biometric unlock is enrolled/enabled (Android only).
    pub biometric_enabled: bool,
    /// Base (reporting) currency - foreign-currency amounts convert to this via a per-transaction
    /// user rate (FR-1.4). `#[serde(default)]` so meta written before this field still loads.
    #[serde(default = "default_base_currency")]
    pub base_currency: String,
    /// Dedup window in days (FR-2.4): how many days apart, at the same amount + account, an
    /// imported row is flagged as a possible duplicate. `#[serde(default)]` so meta written before
    /// this field still loads.
    #[serde(default = "default_dedup_window_days")]
    pub dedup_window_days: u32,
}

impl Default for VaultSettings {
    fn default() -> Self {
        Self {
            idle_timeout_secs: DEFAULT_IDLE_TIMEOUT_SECS,
            biometric_enabled: false,
            base_currency: default_base_currency(),
            dedup_window_days: default_dedup_window_days(),
        }
    }
}

/// The vault meta sidecar. Holds only non-secret bootstrap material + lock settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMeta {
    pub meta_version: u32,
    /// Per-install random salt (not secret).
    pub salt: Vec<u8>,
    /// Frozen Argon2id parameters used to derive the key.
    pub kdf: KdfParams,
    pub created_at: String,
    #[serde(default)]
    pub settings: VaultSettings,
}

pub fn meta_path(dir: &Path) -> PathBuf {
    dir.join(META_FILENAME)
}

pub fn db_path(dir: &Path) -> PathBuf {
    dir.join(DB_FILENAME)
}

/// The vault is initialised once the meta sidecar exists (it holds the salt needed to derive the
/// key). The DB file itself is (re)created+migrated on unlock if absent.
pub fn is_initialised(dir: &Path) -> bool {
    meta_path(dir).exists()
}

/// Classify the on-disk state:
/// - `Ok(false)` - fresh install (no meta) → first-run set-passphrase.
/// - `Ok(true)`  - initialised (meta present); the DB is created on unlock if missing.
/// - `Err(Inconsistent)` - an encrypted DB exists but the salt is gone: unrecoverable, never
///   silently re-initialise (that would orphan the user's data).
pub fn consistency(dir: &Path) -> Result<bool, VaultError> {
    let meta = meta_path(dir).exists();
    let db = db_path(dir).exists();
    match (meta, db) {
        (false, true) => Err(VaultError::Inconsistent),
        (true, _) => Ok(true),
        (false, false) => Ok(false),
    }
}

/// 16 random bytes from the OS CSPRNG.
pub fn generate_salt() -> Result<Vec<u8>, VaultError> {
    let mut salt = vec![0u8; SALT_LEN];
    getrandom::fill(&mut salt).map_err(|_| VaultError::Random)?;
    Ok(salt)
}

pub fn validate_passphrase(passphrase: &str) -> Result<(), VaultError> {
    if passphrase.chars().count() < MIN_PASSPHRASE_LEN {
        return Err(VaultError::PassphraseTooShort);
    }
    Ok(())
}

pub fn read_meta(dir: &Path) -> Result<VaultMeta, VaultError> {
    let text = std::fs::read_to_string(meta_path(dir)).map_err(|e| VaultError::Io(e.to_string()))?;
    serde_json::from_str(&text).map_err(|_| VaultError::CorruptMeta)
}

/// Write the meta sidecar atomically (temp file + rename) so a crash mid-write can't corrupt it.
pub fn write_meta(dir: &Path, meta: &VaultMeta) -> Result<(), VaultError> {
    std::fs::create_dir_all(dir).map_err(|e| VaultError::Io(e.to_string()))?;
    let text = serde_json::to_string_pretty(meta).map_err(|_| VaultError::CorruptMeta)?;
    let tmp = dir.join(format!("{META_FILENAME}.tmp"));
    std::fs::write(&tmp, text.as_bytes()).map_err(|e| VaultError::Io(e.to_string()))?;
    std::fs::rename(&tmp, meta_path(dir)).map_err(|e| VaultError::Io(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let mut d = std::env::temp_dir();
        d.push(format!("budgetmate_vault_test_{}_{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn salt_is_16_bytes_and_unique() {
        let a = generate_salt().unwrap();
        let b = generate_salt().unwrap();
        assert_eq!(a.len(), SALT_LEN);
        assert_ne!(a, b, "two salts must differ (CSPRNG)");
    }

    #[test]
    fn passphrase_length_is_enforced() {
        assert!(validate_passphrase("1234567").is_err());
        assert!(validate_passphrase("12345678").is_ok());
    }

    #[test]
    fn meta_roundtrips_and_detects_first_run() {
        let dir = temp_dir("roundtrip");
        assert!(!is_initialised(&dir));
        assert!(!consistency(&dir).unwrap(), "fresh install");

        let meta = VaultMeta {
            meta_version: CURRENT_META_VERSION,
            salt: generate_salt().unwrap(),
            kdf: KdfParams::default(),
            created_at: "2026-06-05T00:00:00Z".to_string(),
            settings: VaultSettings::default(),
        };
        write_meta(&dir, &meta).unwrap();

        assert!(is_initialised(&dir));
        let back = read_meta(&dir).unwrap();
        assert_eq!(back.salt, meta.salt);
        assert_eq!(back.kdf, meta.kdf);
        assert_eq!(back.settings.idle_timeout_secs, DEFAULT_IDLE_TIMEOUT_SECS);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn orphaned_db_without_meta_is_inconsistent() {
        let dir = temp_dir("orphan");
        std::fs::write(db_path(&dir), b"encrypted-bytes").unwrap();
        assert!(matches!(consistency(&dir), Err(VaultError::Inconsistent)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_meta_is_reported() {
        let dir = temp_dir("corrupt");
        std::fs::write(meta_path(&dir), b"{not valid json").unwrap();
        assert!(matches!(read_meta(&dir), Err(VaultError::CorruptMeta)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Meta written before `dedup_window_days` existed (no `settings.dedupWindowDays` key) must
    /// still deserialise, defaulting to `DEFAULT_DEDUP_WINDOW_DAYS` (serde `#[serde(default)]`
    /// back-compat) - and a meta that DOES set the field round-trips it exactly.
    #[test]
    fn dedup_window_days_defaults_on_old_meta_and_round_trips_when_set() {
        let dir = temp_dir("dedup_window");
        let meta = VaultMeta {
            meta_version: CURRENT_META_VERSION,
            salt: generate_salt().unwrap(),
            kdf: KdfParams::default(),
            created_at: "2026-06-05T00:00:00Z".to_string(),
            settings: VaultSettings::default(),
        };

        // Simulate a meta file written before `dedup_window_days` existed: serialise via the real
        // struct, then strip the key from the JSON rather than hand-building/guessing the shape of
        // sibling structs (`KdfParams`, ...).
        let mut value = serde_json::to_value(&meta).unwrap();
        value["settings"].as_object_mut().unwrap().remove("dedupWindowDays");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(meta_path(&dir), serde_json::to_string(&value).unwrap()).unwrap();

        let back = read_meta(&dir).unwrap();
        assert_eq!(
            back.settings.dedup_window_days, DEFAULT_DEDUP_WINDOW_DAYS,
            "meta written before dedup_window_days existed still loads, defaulting the field"
        );

        // Now round-trip a meta that DOES set a non-default value.
        let mut meta = back;
        meta.settings.dedup_window_days = 7;
        write_meta(&dir, &meta).unwrap();
        let back2 = read_meta(&dir).unwrap();
        assert_eq!(back2.settings.dedup_window_days, 7);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
