//! Restore engine for FR-4.3 - **REPLACE mode only**; merge and Android SAF file-pick are a
//! deferred follow-up (see `docs/adr/0008-restore-replace-desktop-first-merge-deferred.md`). This
//! module is pure enough to unit-test WITHOUT a live `AppHandle`: given an app-data directory, the
//! `DbState` whose live connection is being replaced, a parsed `VaultBackup` envelope, and the
//! backup's own passphrase, it validates the envelope, opens a temp copy to prove the passphrase +
//! schema are usable, then atomically swaps the live SQLCipher database and meta sidecar for the
//! backup's and reopens the connection. `commands::backup::restore_backup` is the thin Tauri
//! wrapper: it reads+parses the `.vaultbak` file bytes and calls into `restore_replace` here.
//!
//! ## Crash safety
//! The swap (`restore_replace`'s step 3) never leaves a window where the live db/meta files are
//! simply missing: the pre-restore db AND meta are first **copied** (not moved) to `.prev` siblings,
//! then a `restore.pending` marker is written, THEN the new meta is written and the validated temp
//! db is renamed over the live db (an atomic replace on the same filesystem). If the process dies at
//! any point from the marker write onward, `recover_interrupted_restore` (called at the top of
//! `restore_backup` AND at the top of `commands::vault::unlock`) rolls the `.prev` copies back over
//! the live files on the next launch - self-healing to the ORIGINAL pre-restore data. The app is
//! never left silently empty. On any in-process failure during the swap, `restore_replace` performs
//! the same rollback synchronously and returns the error; because the CURRENT (post-restore) key is
//! never retained across a failure, the app is left LOCKED - the user's original passphrase still
//! opens the rolled-back vault.

use std::path::{Path, PathBuf};

use crate::crypto;
use crate::db;
use crate::state::DbState;
use crate::vault::{self, VaultMeta, VaultSettings};

use super::VaultBackup;

/// Sane upper bound on the envelope's Argon2 memory cost (KiB) - an attacker-suppliable
/// `.vaultbak` file with an absurd `mCost` is an OOM/DoS vector if we derive a key from it
/// unchecked. 1 GiB is far above any value this app has ever recorded.
const MAX_M_COST_KIB: u32 = 1_048_576;
const MAX_T_COST: u32 = 64;
const MAX_P_COST: u32 = 16;

const NEWER_VERSION_MSG: &str = "This backup was made by a newer version of the app.";
const CORRUPT_MSG: &str = "This backup file looks corrupt or unsupported.";

#[derive(Debug, thiserror::Error)]
pub enum RestoreError {
    /// A user-fixable / expected rejection (newer version, corrupt envelope). Safe to surface.
    #[error("{0}")]
    Validation(String),
    /// Wrong passphrase OR a corrupt embedded database - deliberately one variant, mirroring
    /// `db::DbError::KeyVerificationFailed` (no wrong-key-vs-corrupt oracle).
    #[error("wrong passphrase or corrupt database")]
    KeyVerificationFailed,
    /// Unexpected internal failure (I/O, migration, poisoned state). Never contains a key,
    /// passphrase, salt, or db bytes.
    #[error("{0}")]
    Internal(String),
}

impl From<db::DbError> for RestoreError {
    fn from(e: db::DbError) -> Self {
        RestoreError::Internal(e.to_string())
    }
}

impl From<vault::VaultError> for RestoreError {
    fn from(e: vault::VaultError) -> Self {
        RestoreError::Internal(e.to_string())
    }
}

impl From<std::io::Error> for RestoreError {
    fn from(e: std::io::Error) -> Self {
        RestoreError::Internal(e.to_string())
    }
}

/// Result of a successful replace-mode restore.
#[derive(Debug)]
pub struct RestoreOutcome {
    /// The backup envelope's own `createdAt` (when the SOURCE vault was snapshotted).
    pub created_at: String,
    pub transaction_count: i64,
}

fn restore_tmp_path(dir: &Path) -> PathBuf {
    vault::db_path(dir).with_extension("db.restore")
}
fn db_prev_path(dir: &Path) -> PathBuf {
    vault::db_path(dir).with_extension("db.prev")
}
fn meta_prev_path(dir: &Path) -> PathBuf {
    vault::meta_path(dir).with_extension("json.prev")
}
fn marker_path(dir: &Path) -> PathBuf {
    dir.join("restore.pending")
}

/// Self-heal a restore interrupted mid-swap (crash / power-loss). Idempotent and cheap when
/// nothing was interrupted (a single `Path::exists` check) - safe to call unconditionally on every
/// boot/unlock and at the start of every restore attempt. Rolls BACKWARD to the pre-restore state
/// (never forward) so an interrupted restore can never leave a silently-empty or half-swapped
/// vault: if the `restore.pending` marker is absent, this is a no-op.
pub fn recover_interrupted_restore(dir: &Path) -> Result<(), RestoreError> {
    let marker = marker_path(dir);
    if !marker.exists() {
        return Ok(());
    }
    let db_prev = db_prev_path(dir);
    let meta_prev = meta_prev_path(dir);
    if db_prev.exists() {
        std::fs::rename(&db_prev, vault::db_path(dir))?;
    }
    if meta_prev.exists() {
        std::fs::rename(&meta_prev, vault::meta_path(dir))?;
    }
    let _ = std::fs::remove_file(restore_tmp_path(dir));
    let _ = std::fs::remove_file(&marker);
    Ok(())
}

/// Guard the envelope BEFORE any Argon2 derivation or filesystem swap.
fn validate_envelope(env: &VaultBackup) -> Result<(), RestoreError> {
    if env.format_version != super::BACKUP_FORMAT_VERSION {
        return Err(RestoreError::Validation(NEWER_VERSION_MSG.to_string()));
    }
    if env.meta_version > vault::CURRENT_META_VERSION {
        return Err(RestoreError::Validation(NEWER_VERSION_MSG.to_string()));
    }
    let kdf = &env.kdf;
    if kdf.algorithm != "argon2id"
        || kdf.output_len != 32
        || kdf.m_cost > MAX_M_COST_KIB
        || kdf.t_cost > MAX_T_COST
        || kdf.p_cost > MAX_P_COST
    {
        return Err(RestoreError::Validation(CORRUPT_MSG.to_string()));
    }
    Ok(())
}

/// Open the validation temp copy with the re-derived key and bring it up to the current schema.
/// The LIVE db is never touched by this step - a failure here leaves it completely untouched.
fn validate_and_migrate_restored_copy(
    restore_tmp: &Path,
    key_hex: &str,
    now: &str,
) -> Result<(), RestoreError> {
    let conn =
        db::open_encrypted(restore_tmp, key_hex).map_err(|_| RestoreError::KeyVerificationFailed)?;
    let backup_schema_version: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))
        .map_err(|_| RestoreError::Validation(CORRUPT_MSG.to_string()))?;
    if backup_schema_version > db::latest_migration_version() {
        return Err(RestoreError::Validation(NEWER_VERSION_MSG.to_string()));
    }
    // Upgrade an OLDER-schema backup to the current schema. Deliberately no `seed_defaults` - a
    // restore is faithful to the backup's own content, never adds starter rows.
    db::run_migrations(&conn, now).map_err(RestoreError::from)?;
    Ok(())
}

/// Copy the live db + meta to `.prev` siblings, write the `restore.pending` marker, stamp the new
/// meta, and atomically rename the validated temp db over the live one. Returns the reopened
/// connection + outcome on success. On ANY failure the caller rolls back via
/// `recover_interrupted_restore` (the marker + `.prev` files it left behind are exactly what that
/// function expects).
fn swap_in_restored_copy(
    dir: &Path,
    restore_tmp: &Path,
    key_hex: &str,
    env: &VaultBackup,
    now: &str,
) -> Result<(rusqlite::Connection, RestoreOutcome), RestoreError> {
    let db_p = vault::db_path(dir);
    let meta_p = vault::meta_path(dir);
    let db_prev = db_prev_path(dir);
    let meta_prev = meta_prev_path(dir);
    let marker = marker_path(dir);

    let old_meta = vault::read_meta(dir)?;

    // (a) COPY (not move) the live files - they stay in place, so there is never a db-absent
    // window even if the process dies right after this line.
    std::fs::copy(&db_p, &db_prev)?;
    if let Err(e) = std::fs::copy(&meta_p, &meta_prev) {
        let _ = std::fs::remove_file(&db_prev);
        return Err(RestoreError::from(e));
    }

    // (b) Marker: from here on, `recover_interrupted_restore` knows to roll back on next launch.
    std::fs::write(&marker, now.as_bytes())?;

    // (c) New meta: preserve the LOCAL idle timeout, FORCE biometric off (it wraps the OLD key),
    // and ADOPT the backup's base currency (money-correctness - see the module doc in `backup/mod.rs`).
    let new_meta = VaultMeta {
        meta_version: vault::CURRENT_META_VERSION,
        salt: env.salt.clone(),
        kdf: env.kdf.clone(),
        created_at: old_meta.created_at.clone(),
        settings: VaultSettings {
            idle_timeout_secs: old_meta.settings.idle_timeout_secs,
            biometric_enabled: false,
            base_currency: env.base_currency.clone(),
        },
    };
    vault::write_meta(dir, &new_meta)?;

    // (d) Atomic commit: same filesystem, so this replaces the live db in one step.
    std::fs::rename(restore_tmp, &db_p)?;

    // (e) Reopen + re-run migrations (idempotent - already applied in the validation step) +
    // lazily materialise recurring occurrences, mirroring `commands::vault::open_and_unlock`.
    let conn = db::open_encrypted(&db_p, key_hex).map_err(|_| RestoreError::KeyVerificationFailed)?;
    db::run_migrations(&conn, now).map_err(RestoreError::from)?;
    if let Err(e) = db::recurring::materialise_due(&conn, chrono::Utc::now().date_naive()) {
        log::warn!("recurring materialisation skipped after restore: {e}");
    }
    let transaction_count: i64 = conn
        .query_row("SELECT count(*) FROM transactions", [], |r| r.get(0))
        .map_err(|e| RestoreError::Internal(e.to_string()))?;

    // (g) Success: the swap is durable - drop the crash-recovery artifacts.
    let _ = std::fs::remove_file(&marker);
    let _ = std::fs::remove_file(&db_prev);
    let _ = std::fs::remove_file(&meta_prev);

    Ok((conn, RestoreOutcome { created_at: env.created_at.clone(), transaction_count }))
}

/// Replace-mode restore (Merge is a deferred follow-up - see the module doc). Takes the `DbState`
/// mutex for the duration of the swap (dropping the live connection releases its file handle,
/// required for the rename to succeed on Windows) and either installs the new connection
/// (success) or leaves the state locked (any failure) - the app is NEVER left holding a
/// half-restored or stale connection.
pub fn restore_replace(
    dir: &Path,
    db_state: &DbState,
    env: &VaultBackup,
    passphrase: &str,
) -> Result<RestoreOutcome, RestoreError> {
    // Step 0: self-heal any prior interrupted restore, then clear a stale validation temp file.
    recover_interrupted_restore(dir)?;
    let restore_tmp = restore_tmp_path(dir);
    let _ = std::fs::remove_file(&restore_tmp);

    // Step 1: guard against a newer/unsupported/malicious envelope BEFORE deriving a key from it.
    validate_envelope(env)?;

    // Step 2: derive the key from the ENVELOPE's OWN salt/kdf (not the local install's) - a
    // restore must open with the SOURCE vault's key.
    let key = crypto::derive_key_with_params(passphrase.as_bytes(), &env.salt, &env.kdf)
        .map_err(|_| RestoreError::Internal("unable to derive key".to_string()))?;
    let key_hex = crypto::key_to_sqlcipher_hex(&key);

    // Step 3: validate on a temp copy - the LIVE db is untouched until this succeeds.
    std::fs::write(&restore_tmp, &env.db)?;
    let now = chrono::Utc::now().to_rfc3339();
    if let Err(e) = validate_and_migrate_restored_copy(&restore_tmp, &key_hex, &now) {
        let _ = std::fs::remove_file(&restore_tmp);
        return Err(e);
    }

    // Step 4: take the live connection's mutex and drop it - releases the file handle so the
    // rename below can replace it.
    let mut guard = db_state
        .guard()
        .map_err(|_| RestoreError::Internal("database state is poisoned".to_string()))?;
    *guard = None;

    // Step 5: snapshot + swap, with full rollback to the PRE-restore state on any failure.
    match swap_in_restored_copy(dir, &restore_tmp, &key_hex, env, &now) {
        Ok((conn, outcome)) => {
            *guard = Some(conn);
            Ok(outcome)
        }
        Err(e) => {
            // Never retained the post-restore key - stay LOCKED. The user's ORIGINAL passphrase
            // still matches the rolled-back meta, so they unlock normally.
            let _ = recover_interrupted_restore(dir);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup;

    fn temp_dir(tag: &str) -> PathBuf {
        let mut d = std::env::temp_dir();
        d.push(format!("budgetmate_restore_test_{}_{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// Build a real encrypted vault at `dir` with the given passphrase/currency, seed it with one
    /// transaction, and return its backup envelope (the same pipeline `create_backup` drives).
    fn build_vault_and_envelope(
        dir: &Path,
        passphrase: &[u8],
        base_currency: &str,
    ) -> backup::VaultBackup {
        let salt = vault::generate_salt().unwrap();
        let kdf = crypto::KdfParams::default();
        let key = crypto::derive_key_with_params(passphrase, &salt, &kdf).unwrap();
        let key_hex = crypto::key_to_sqlcipher_hex(&key);

        let db_path = vault::db_path(dir);
        {
            let conn = db::open_encrypted(&db_path, &key_hex).unwrap();
            db::run_migrations(&conn, "2026-06-05T00:00:00Z").unwrap();
            // Deliberately NOT `seed_defaults` - insert exactly one account (id 1) so the
            // transaction below references a currency-consistent account.
            conn.execute(
                "INSERT INTO accounts (name, type, currency, opening_balance_minor, archived)
                 VALUES ('Wallet', 'cash', ?1, 0, 0)",
                rusqlite::params![base_currency],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO transactions
                    (account_id, posted_date, amount_minor, currency, fx_rate, base_amount_minor,
                     payee, note, source, source_ref, pending_review, created_at)
                 VALUES (1, '2026-07-01', -500, ?1, '1', -500, 'Shop', NULL, 'manual', NULL, 0,
                         '2026-07-01T00:00:00Z')",
                rusqlite::params![base_currency],
            )
            .unwrap();
        }

        let meta = vault::VaultMeta {
            meta_version: vault::CURRENT_META_VERSION,
            salt,
            kdf,
            created_at: "2026-06-05T00:00:00Z".to_string(),
            settings: vault::VaultSettings {
                base_currency: base_currency.to_string(),
                ..vault::VaultSettings::default()
            },
        };
        vault::write_meta(dir, &meta).unwrap();

        let db_bytes = std::fs::read(&db_path).unwrap();
        backup::build_envelope(db_bytes, &meta, "2026-07-14T00:00:00Z", "BudgetMate 0.1.0")
    }

    /// Set up "install B" (a different passphrase/currency) as the CURRENT live vault at `dir`, and
    /// return its `DbState` pre-loaded with the open connection (mirrors app boot: unlocked).
    fn install_current_vault(dir: &Path, passphrase: &[u8], base_currency: &str) -> DbState {
        let salt = vault::generate_salt().unwrap();
        let kdf = crypto::KdfParams::default();
        let key = crypto::derive_key_with_params(passphrase, &salt, &kdf).unwrap();
        let key_hex = crypto::key_to_sqlcipher_hex(&key);

        let db_path = vault::db_path(dir);
        let conn = db::open_encrypted(&db_path, &key_hex).unwrap();
        db::run_migrations(&conn, "2026-06-05T00:00:00Z").unwrap();
        db::seed_defaults(&conn).unwrap();

        let meta = vault::VaultMeta {
            meta_version: vault::CURRENT_META_VERSION,
            salt,
            kdf,
            created_at: "2026-06-01T00:00:00Z".to_string(),
            settings: vault::VaultSettings {
                base_currency: base_currency.to_string(),
                idle_timeout_secs: 300,
                biometric_enabled: true,
            },
        };
        vault::write_meta(dir, &meta).unwrap();

        DbState::new(conn)
    }

    #[test]
    fn restore_replace_round_trip() {
        let dir = temp_dir("round_trip");
        let source_dir = temp_dir("round_trip_source");

        let envelope = build_vault_and_envelope(&source_dir, b"passphrase-one-A", "USD");
        let state = install_current_vault(&dir, b"passphrase-two-B", "MUR");

        let outcome = restore_replace(&dir, &state, &envelope, "passphrase-one-A").unwrap();
        assert_eq!(outcome.transaction_count, 1);
        assert_eq!(outcome.created_at, "2026-07-14T00:00:00Z");

        // The state is unlocked with the restored data.
        assert!(state.is_unlocked());
        state
            .with(|c| {
                let count: i64 = c.query_row("SELECT count(*) FROM transactions", [], |r| r.get(0))?;
                assert_eq!(count, 1);
                Ok(())
            })
            .unwrap();

        // The meta on disk now re-derives with P1 (the RESTORED passphrase), adopts the backup's
        // base currency, and forces biometric off (it wrapped install B's old key).
        let new_meta = vault::read_meta(&dir).unwrap();
        assert_eq!(new_meta.settings.base_currency, "USD", "adopts the backup's base currency");
        assert!(!new_meta.settings.biometric_enabled, "biometric forced off on restore");
        assert_eq!(new_meta.settings.idle_timeout_secs, 300, "local idle timeout preserved");
        let rekeyed = crypto::derive_key_with_params(b"passphrase-one-A", &new_meta.salt, &new_meta.kdf)
            .unwrap();
        let rekeyed_hex = crypto::key_to_sqlcipher_hex(&rekeyed);
        assert!(db::open_encrypted(&vault::db_path(&dir), &rekeyed_hex).is_ok());

        // No leftover crash-recovery artifacts.
        assert!(!db_prev_path(&dir).exists());
        assert!(!meta_prev_path(&dir).exists());
        assert!(!marker_path(&dir).exists());
        assert!(!restore_tmp_path(&dir).exists());

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&source_dir);
    }

    #[test]
    fn wrong_passphrase_rejected_and_rolls_back() {
        let dir = temp_dir("wrong_pass");
        let source_dir = temp_dir("wrong_pass_source");

        let envelope = build_vault_and_envelope(&source_dir, b"passphrase-one-A", "USD");
        let state = install_current_vault(&dir, b"passphrase-two-B", "MUR");

        let db_before = std::fs::read(vault::db_path(&dir)).unwrap();
        let meta_before = std::fs::read_to_string(vault::meta_path(&dir)).unwrap();

        let err = restore_replace(&dir, &state, &envelope, "totally-wrong-passphrase").unwrap_err();
        assert!(matches!(err, RestoreError::KeyVerificationFailed));

        // Live db + meta are byte-identical to before - no partial write, no rollback needed
        // because the failure happened before the live files were ever touched (validation-only).
        let db_after = std::fs::read(vault::db_path(&dir)).unwrap();
        let meta_after = std::fs::read_to_string(vault::meta_path(&dir)).unwrap();
        assert_eq!(db_before, db_after);
        assert_eq!(meta_before, meta_after);

        // No leftover temp files/marker.
        assert!(!db_prev_path(&dir).exists());
        assert!(!meta_prev_path(&dir).exists());
        assert!(!marker_path(&dir).exists());
        assert!(!restore_tmp_path(&dir).exists());

        // A wrong-passphrase failure happens during Step 3's temp-copy validation - BEFORE the
        // live connection's mutex is ever taken - so the currently-unlocked app is left exactly as
        // it was (still unlocked, still usable); only a failure during the swap itself (Step 5,
        // after the live connection is dropped) leaves the app locked.
        assert!(state.is_unlocked());

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&source_dir);
    }

    #[test]
    fn older_schema_backup_migrates_on_restore() {
        let dir = temp_dir("older_schema");
        let source_dir = temp_dir("older_schema_source");

        // Build a source vault whose embedded DB is migrated only to schema version 1 (older than
        // `db::latest_migration_version()`, which is currently 3).
        let salt = vault::generate_salt().unwrap();
        let kdf = crypto::KdfParams::default();
        let key = crypto::derive_key_with_params(b"passphrase-one-A", &salt, &kdf).unwrap();
        let key_hex = crypto::key_to_sqlcipher_hex(&key);
        let db_path = vault::db_path(&source_dir);
        {
            let conn = db::open_encrypted(&db_path, &key_hex).unwrap();
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
                );",
            )
            .unwrap();
            // Manually apply only migration 1's DDL (the accounts/categories/transactions core).
            let sql = include_str!("../db/migrations/0001_init.sql");
            conn.execute_batch(sql).unwrap();
            conn.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (1, '2026-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
        }
        let meta = vault::VaultMeta {
            meta_version: vault::CURRENT_META_VERSION,
            salt,
            kdf,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            settings: vault::VaultSettings::default(),
        };
        vault::write_meta(&source_dir, &meta).unwrap();
        let db_bytes = std::fs::read(&db_path).unwrap();
        let envelope =
            backup::build_envelope(db_bytes, &meta, "2026-07-14T00:00:00Z", "BudgetMate 0.1.0");

        let state = install_current_vault(&dir, b"passphrase-two-B", "MUR");
        let outcome = restore_replace(&dir, &state, &envelope, "passphrase-one-A").unwrap();
        assert_eq!(outcome.transaction_count, 0);

        // The reopened DB is at the current schema version and opens without error.
        state
            .with(|c| {
                let version: i64 = c.query_row(
                    "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                    [],
                    |r| r.get(0),
                )?;
                assert_eq!(version, db::latest_migration_version());
                Ok(())
            })
            .unwrap();

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&source_dir);
    }

    #[test]
    fn newer_meta_version_is_rejected() {
        let dir = temp_dir("newer_meta");
        let source_dir = temp_dir("newer_meta_source");

        let mut envelope = build_vault_and_envelope(&source_dir, b"passphrase-one-A", "USD");
        envelope.meta_version = vault::CURRENT_META_VERSION + 1;

        let state = install_current_vault(&dir, b"passphrase-two-B", "MUR");
        let db_before = std::fs::read(vault::db_path(&dir)).unwrap();

        let err = restore_replace(&dir, &state, &envelope, "passphrase-one-A").unwrap_err();
        assert!(matches!(err, RestoreError::Validation(_)));
        assert_eq!(std::fs::read(vault::db_path(&dir)).unwrap(), db_before, "live data untouched");
        assert!(state.is_unlocked(), "live connection was never touched by an early guard failure");

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&source_dir);
    }

    #[test]
    fn newer_format_version_is_rejected() {
        let dir = temp_dir("newer_format");
        let source_dir = temp_dir("newer_format_source");

        let mut envelope = build_vault_and_envelope(&source_dir, b"passphrase-one-A", "USD");
        envelope.format_version = backup::BACKUP_FORMAT_VERSION + 1;

        let state = install_current_vault(&dir, b"passphrase-two-B", "MUR");
        let err = restore_replace(&dir, &state, &envelope, "passphrase-one-A").unwrap_err();
        assert!(matches!(err, RestoreError::Validation(_)));

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&source_dir);
    }

    #[test]
    fn absurd_kdf_cost_is_rejected_before_deriving_a_key() {
        let dir = temp_dir("absurd_kdf");
        let source_dir = temp_dir("absurd_kdf_source");

        let mut envelope = build_vault_and_envelope(&source_dir, b"passphrase-one-A", "USD");
        envelope.kdf.m_cost = 50_000_000; // far above MAX_M_COST_KIB

        let state = install_current_vault(&dir, b"passphrase-two-B", "MUR");
        let err = restore_replace(&dir, &state, &envelope, "passphrase-one-A").unwrap_err();
        assert!(matches!(err, RestoreError::Validation(_)));

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&source_dir);
    }

    #[test]
    fn corrupt_file_is_rejected() {
        // The JSON-parse step lives in `commands::backup::restore_backup` (it owns reading the raw
        // file bytes); here we exercise the equivalent guard for a structurally-invalid envelope
        // reaching the engine (e.g. a hand-crafted/corrupted db payload that still parses as JSON
        // but fails to open as a database).
        let dir = temp_dir("corrupt");
        let source_dir = temp_dir("corrupt_source");
        let mut envelope = build_vault_and_envelope(&source_dir, b"passphrase-one-A", "USD");
        envelope.db = b"not a sqlite database".to_vec();

        let state = install_current_vault(&dir, b"passphrase-two-B", "MUR");
        let err = restore_replace(&dir, &state, &envelope, "passphrase-one-A").unwrap_err();
        assert!(matches!(err, RestoreError::KeyVerificationFailed));
        assert!(state.is_unlocked(), "corrupt db payload fails before the live connection is touched");

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&source_dir);
    }

    #[test]
    fn interrupted_restore_recovers() {
        let dir = temp_dir("interrupted");
        std::fs::write(vault::db_path(&dir), b"restored-db-bytes").unwrap();
        std::fs::write(vault::meta_path(&dir), b"{\"restored\":true}").unwrap();
        std::fs::write(db_prev_path(&dir), b"original-db-bytes").unwrap();
        std::fs::write(meta_prev_path(&dir), b"{\"original\":true}").unwrap();
        std::fs::write(restore_tmp_path(&dir), b"stale-validation-copy").unwrap();
        std::fs::write(marker_path(&dir), b"2026-07-14T00:00:00Z").unwrap();

        recover_interrupted_restore(&dir).unwrap();

        assert_eq!(std::fs::read(vault::db_path(&dir)).unwrap(), b"original-db-bytes");
        assert_eq!(std::fs::read(vault::meta_path(&dir)).unwrap(), b"{\"original\":true}");
        assert!(!db_prev_path(&dir).exists());
        assert!(!meta_prev_path(&dir).exists());
        assert!(!restore_tmp_path(&dir).exists());
        assert!(!marker_path(&dir).exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn recover_interrupted_restore_is_a_no_op_without_a_marker() {
        let dir = temp_dir("no_marker");
        std::fs::write(vault::db_path(&dir), b"live-db-bytes").unwrap();
        recover_interrupted_restore(&dir).unwrap();
        assert_eq!(std::fs::read(vault::db_path(&dir)).unwrap(), b"live-db-bytes");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
