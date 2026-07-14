//! Encrypted local backup + restore commands (FR-4.1 / FR-4.3) - desktop-first slice (see
//! `docs/adr/0007-encrypted-backup-desktop-first.md` and
//! `docs/adr/0008-restore-replace-desktop-first-merge-deferred.md`, mirroring the export ADR 0006).
//!
//! **Backup:** the frontend picks `dest_path` via the `dialog` plugin's save picker
//! (`core/bridge::pickBackupDestination`); this command copies the ALREADY-ENCRYPTED database bytes
//! (no key access needed - the in-memory key hex is irrelevant to a byte-for-byte copy), bundles
//! them with the non-secret salt/KDF params from the meta sidecar into a `.vaultbak` envelope, and
//! writes it with `std::fs::write`. Android's SAF-backed save is a separate, device-verified change;
//! the backup screen shows an info banner on Android instead of calling this command.
//!
//! Consistency without the key: `PRAGMA wal_checkpoint(TRUNCATE)` runs on the open connection (a
//! harmless no-op in the default DELETE journal mode, robust if that ever changes) while still
//! holding the `DbState` mutex guard, and the DB file bytes are read INSIDE that same guarded
//! scope - the same "read under the lock" shape `commands::export` uses. The guard is dropped
//! before the blocking base64/JSON/write work in `spawn_blocking` - never hold a
//! `std::sync::Mutex` guard across an `.await`. Deliberately NOT `VACUUM INTO` or rusqlite's
//! online-backup API: both emit a PLAINTEXT database unless the destination connection is keyed
//! with the same key, and the `backup` cargo feature is never enabled.
//!
//! **Restore:** `restore_backup` is REPLACE mode only (Merge is a deferred follow-up - see ADR
//! 0008). It is deliberately a SYNC command (mirroring `commands::vault::unlock`), not `async`: the
//! Argon2id derivation + blocking file I/O below run on the command's own worker thread, and there
//! is no `.await` for a `std::sync::Mutex` guard to be held across. All of the crash-safe swap logic
//! lives in `backup::restore` (unit-tested without a live `AppHandle`); this command only reads +
//! parses the `.vaultbak` file bytes and delegates.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};

use crate::backup::{self, restore, BACKUP_FORMAT_VERSION};
use crate::error::AppError;
use crate::state::DbState;
use crate::vault;

fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, AppError> {
    app.path().app_data_dir().map_err(|e| AppError::Internal(e.to_string()))
}

/// Result of a successful backup (mirrors TS `BackupSummary`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub path: String,
    pub byte_len: u64,
    pub format_version: u32,
}

/// Write an encrypted `.vaultbak` snapshot to `dest_path` (already chosen by the user via the save
/// dialog on the frontend). Locked surfaces `AppError::Locked` cleanly.
#[tauri::command]
pub async fn create_backup<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
    dest_path: String,
) -> Result<BackupSummary, AppError> {
    let dir = app_data_dir(&app)?;

    // Read the consistent, already-encrypted DB snapshot INSIDE the guarded scope so the
    // std::sync::Mutex guard drops before the blocking base64/JSON/write work below - never hold
    // it across an await.
    let db_bytes = {
        let guard = state.guard()?;
        let conn = guard.as_ref().ok_or(AppError::Locked)?;
        // Defensive checkpoint: a no-op in the default DELETE journal mode, but ensures the
        // on-disk file reflects every committed write if the journal mode ever changes.
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| AppError::Internal(e.to_string()))?;
        std::fs::read(vault::db_path(&dir)).map_err(|e| AppError::Internal(e.to_string()))?
    };

    let now = chrono::Utc::now().to_rfc3339();
    let app_str = format!("BudgetMate {}", env!("CARGO_PKG_VERSION"));
    let path = dest_path.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        // `vault::read_meta` does blocking file I/O - keep it inside spawn_blocking with the
        // envelope build/write below, never directly in the async command body.
        let meta = vault::read_meta(&dir)?;
        let envelope = backup::build_envelope(db_bytes, &meta, &now, &app_str);
        let bytes = backup::to_bytes(&envelope)?;
        std::fs::write(&path, &bytes).map_err(|e| AppError::Internal(e.to_string()))?;
        Ok::<Vec<u8>, AppError>(bytes)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))??;

    // Log ONLY a byte count / path - never the salt, kdf, key, passphrase, or db bytes.
    log::info!("created encrypted backup: {} byte(s) to {dest_path}", bytes.len());
    Ok(BackupSummary {
        path: dest_path,
        byte_len: bytes.len() as u64,
        format_version: BACKUP_FORMAT_VERSION,
    })
}

/// How to reconcile a restore with existing local data. `Merge` is a deferred follow-up (issue #21
/// slice) - the UI only ever sends `Replace`, but the enum is exhaustively matched below so adding
/// `Merge` later forces this command to handle it deliberately.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RestoreMode {
    Replace,
}

/// Result of a successful restore (mirrors TS `RestoreSummary`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSummary {
    pub format_version: u32,
    /// The RESTORED backup's own `createdAt` (when the source vault was snapshotted) - not "now".
    pub created_at: String,
    pub transaction_count: i64,
    /// The ADOPTED base (reporting) currency, trimmed + uppercased (money-correctness - see
    /// `backup::restore::validate_envelope`) - surfaced so the UI can disclose which currency
    /// reports now add up in, rather than leaving that a silent change.
    pub base_currency: String,
}

/// Restore the vault from a `.vaultbak` file at `backup_path` (already chosen via
/// `pickBackupFile`), REPLACE mode only. See the module doc + `backup::restore` for the full
/// crash-safety writeup. A wrong passphrase and a corrupt embedded database both surface as the
/// same generic `AppError::KeyVerificationFailed` (no wrong-key-vs-corrupt oracle).
#[tauri::command]
pub fn restore_backup<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DbState>,
    backup_path: String,
    passphrase: String,
    mode: RestoreMode,
) -> Result<RestoreSummary, AppError> {
    match mode {
        RestoreMode::Replace => {}
    }

    let dir = app_data_dir(&app)?;

    // Step 0: self-heal any restore left interrupted by a prior crash/power-loss before doing
    // anything else - the boot/unlock path (`commands::vault::unlock`) does the same.
    restore::recover_interrupted_restore(&dir)?;

    let bytes = std::fs::read(&backup_path)
        .map_err(|_| AppError::Validation("This file is not a valid Vault backup.".to_string()))?;
    let envelope: backup::VaultBackup = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::Validation("This file is not a valid Vault backup.".to_string()))?;

    let outcome = restore::restore_replace(&dir, &state, &envelope, &passphrase)?;

    // Log ONLY counts/paths/timestamps - never the salt, kdf, key, or passphrase.
    log::info!(
        "restored vault from backup: {} transaction(s), backup created {}",
        outcome.transaction_count,
        outcome.created_at
    );

    Ok(RestoreSummary {
        format_version: envelope.format_version,
        created_at: outcome.created_at,
        transaction_count: outcome.transaction_count,
        base_currency: outcome.base_currency,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{crypto, db};

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let mut d = std::env::temp_dir();
        d.push(format!("budgetmate_backup_test_{}_{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// End-to-end (minus the live `AppHandle`, which the pure `backup`/`db`/`vault` modules don't
    /// need): create a real encrypted SQLCipher DB + meta sidecar with a KNOWN passphrase, run the
    /// same pipeline `create_backup` drives (read bytes -> `build_envelope` -> `to_bytes`), and
    /// prove the envelope is restore-portable - the same passphrase + the salt/kdf it carries
    /// re-derive the key that opens the embedded (still-encrypted) DB bytes on any device.
    #[test]
    fn envelope_is_restore_portable_and_db_bytes_stay_encrypted() {
        let dir = temp_dir("portable");
        let passphrase = b"correct horse battery staple";
        let salt = vault::generate_salt().unwrap();
        let kdf = crypto::KdfParams::default();
        let key = crypto::derive_key_with_params(passphrase, &salt, &kdf).unwrap();
        let key_hex = crypto::key_to_sqlcipher_hex(&key);

        let db_path = vault::db_path(&dir);
        {
            let conn = db::open_encrypted(&db_path, &key_hex).unwrap();
            db::run_migrations(&conn, "2026-06-05T00:00:00Z").unwrap();
            db::seed_defaults(&conn).unwrap();
        }

        let meta = vault::VaultMeta {
            meta_version: vault::CURRENT_META_VERSION,
            salt: salt.clone(),
            kdf: kdf.clone(),
            created_at: "2026-06-05T00:00:00Z".to_string(),
            settings: vault::VaultSettings::default(),
        };
        vault::write_meta(&dir, &meta).unwrap();

        // The pipeline `create_backup` drives, minus the AppHandle/spawn_blocking plumbing.
        let db_bytes = std::fs::read(&db_path).unwrap();
        let read_meta = vault::read_meta(&dir).unwrap();
        let envelope =
            backup::build_envelope(db_bytes, &read_meta, "2026-07-14T00:00:00Z", "BudgetMate 0.1.0");
        let bytes = backup::to_bytes(&envelope).unwrap();

        // The envelope parses back as JSON.
        let parsed: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(parsed["formatVersion"], BACKUP_FORMAT_VERSION);

        let round_tripped: backup::VaultBackup = serde_json::from_slice(&bytes).unwrap();

        // The embedded DB bytes never contain the plaintext SQLite header - still encrypted.
        assert!(
            !round_tripped.db.windows(15).any(|w| w == b"SQLite format 3"),
            "backup must never embed a plaintext database"
        );
        assert_eq!(round_tripped.salt, salt);
        assert_eq!(round_tripped.kdf, kdf);
        assert_eq!(round_tripped.base_currency, "MUR", "carries the source install's base currency");

        // Restore-portability: write the decoded db bytes to a fresh path and open it with a key
        // re-derived from the SAME passphrase + the salt/kdf carried in the envelope.
        let restored_path = dir.join("restored.db");
        std::fs::write(&restored_path, &round_tripped.db).unwrap();
        let restored_key =
            crypto::derive_key_with_params(passphrase, &round_tripped.salt, &round_tripped.kdf)
                .unwrap();
        let restored_key_hex = crypto::key_to_sqlcipher_hex(&restored_key);
        let restored_conn = db::open_encrypted(&restored_path, &restored_key_hex).unwrap();
        let count: i64 =
            restored_conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get(0)).unwrap();
        assert!(count > 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn backup_summary_round_trips_over_serde_camel_case() {
        let summary = BackupSummary {
            path: "/tmp/budgetmate-backup-2026-07-14.vaultbak".into(),
            byte_len: 4096,
            format_version: BACKUP_FORMAT_VERSION,
        };
        let json = serde_json::to_string(&summary).unwrap();
        assert!(json.contains("\"byteLen\":4096"));
        assert!(json.contains("\"formatVersion\":1"));
        assert!(json.contains("\"path\":\"/tmp/budgetmate-backup-2026-07-14.vaultbak\""));
    }

    #[test]
    fn restore_summary_round_trips_over_serde_camel_case_and_carries_base_currency() {
        let summary = RestoreSummary {
            format_version: BACKUP_FORMAT_VERSION,
            created_at: "2026-07-14T00:00:00Z".to_string(),
            transaction_count: 42,
            base_currency: "USD".to_string(),
        };
        let json = serde_json::to_string(&summary).unwrap();
        assert!(json.contains("\"formatVersion\":1"));
        assert!(json.contains("\"createdAt\":\"2026-07-14T00:00:00Z\""));
        assert!(json.contains("\"transactionCount\":42"));
        assert!(json.contains("\"baseCurrency\":\"USD\""));
    }
}
