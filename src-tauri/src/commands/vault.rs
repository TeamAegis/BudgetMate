//! Unlock / key-lifecycle commands (FR-5.1 / FR-5.2). Thin wrappers: derive the DB key from the
//! user passphrase (Argon2id), open the SQLCipher connection, and gate every other command behind
//! the unlocked `DbState`. Keys, passphrases and salts are NEVER logged, and a wrong passphrase is
//! reported generically (no wrong-key-vs-corrupt oracle).

use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::state::DbState;
use crate::{crypto, db, vault};

/// Mirrors TS `AppState`: what the shell needs to route between setup / unlock / app.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub initialized: bool,
    pub unlocked: bool,
    pub biometric_available: bool,
    pub biometric_enabled: bool,
    pub idle_timeout_secs: u32,
}

fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn current_state<R: Runtime>(app: &AppHandle<R>, db: &DbState) -> Result<AppState, String> {
    let dir = app_data_dir(app)?;
    let (biometric_enabled, idle_timeout_secs) = match vault::read_meta(&dir) {
        Ok(m) => (m.settings.biometric_enabled, m.settings.idle_timeout_secs),
        Err(_) => (false, vault::DEFAULT_IDLE_TIMEOUT_SECS),
    };
    Ok(AppState {
        initialized: vault::is_initialised(&dir),
        unlocked: db.is_unlocked(),
        biometric_available: vault::biometric::status(app).available,
        biometric_enabled,
        idle_timeout_secs,
    })
}

/// Derive the key, open+migrate the DB, and install the connection into managed state. The
/// `Zeroizing` key and hex are local and zeroise on drop the moment the connection is open. A
/// failure to open is mapped to a single generic message — never reveal wrong-key vs corruption.
fn open_and_unlock(
    db: &DbState,
    dir: &Path,
    passphrase: &str,
    meta: &vault::VaultMeta,
) -> Result<(), String> {
    let key = crypto::derive_key_with_params(passphrase.as_bytes(), &meta.salt, &meta.kdf)
        .map_err(|_| "unable to derive key".to_string())?;
    let key_hex = crypto::key_to_sqlcipher_hex(&key);
    let now = chrono::Utc::now().to_rfc3339();
    let conn = db::open_and_migrate(&vault::db_path(dir), &key_hex, &now)
        .map_err(|_| "Incorrect passphrase".to_string())?;
    // Materialise any due recurring occurrences lazily on app open (FR-1.3) — no background
    // scheduler. Idempotent, so a failure here must never block unlock; log-and-continue.
    if let Err(e) = db::recurring::materialise_due(&conn, chrono::Utc::now().date_naive()) {
        log::warn!("recurring materialisation skipped: {e}");
    }
    db.unlock(conn)
}

/// Current vault/lock state for the shell to decide setup vs unlock vs app.
#[tauri::command]
pub fn app_state<R: Runtime>(app: AppHandle<R>, db: State<'_, DbState>) -> Result<AppState, String> {
    current_state(&app, &db)
}

/// First-run only: set the passphrase, generate the salt, record the KDF params, create + open
/// the encrypted DB, and unlock. Rejected if the vault is already initialised.
#[tauri::command]
pub fn set_passphrase<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, DbState>,
    passphrase: String,
) -> Result<AppState, String> {
    let dir = app_data_dir(&app)?;
    match vault::consistency(&dir) {
        Ok(false) => {}
        Ok(true) => return Err(vault::VaultError::AlreadyInitialised.to_string()),
        Err(e) => return Err(e.to_string()),
    }
    vault::validate_passphrase(&passphrase).map_err(|e| e.to_string())?;

    let meta = vault::VaultMeta {
        meta_version: vault::CURRENT_META_VERSION,
        salt: vault::generate_salt().map_err(|e| e.to_string())?,
        kdf: crypto::KdfParams::default(),
        created_at: chrono::Utc::now().to_rfc3339(),
        settings: vault::VaultSettings::default(),
    };
    // Write meta first: if we crash before the DB is created, the next unlock recreates it with
    // the same salt. The reverse (DB without salt) would be unrecoverable.
    vault::write_meta(&dir, &meta).map_err(|e| e.to_string())?;
    open_and_unlock(&db, &dir, &passphrase, &meta)?;
    current_state(&app, &db)
}

/// Unlock an initialised vault with the passphrase. Wrong passphrase → generic error.
#[tauri::command]
pub fn unlock<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, DbState>,
    passphrase: String,
) -> Result<AppState, String> {
    let dir = app_data_dir(&app)?;
    let meta = match vault::read_meta(&dir) {
        Ok(m) => m,
        Err(vault::VaultError::Io(_)) => return Err(vault::VaultError::NotInitialised.to_string()),
        Err(e) => return Err(e.to_string()),
    };
    open_and_unlock(&db, &dir, &passphrase, &meta)?;
    current_state(&app, &db)
}

/// Biometric unlock (Android). Until the on-device keystore release is wired (#4) this is
/// unavailable everywhere and the passphrase path is the sole route.
#[tauri::command]
pub fn unlock_with_biometric<R: Runtime>(
    app: AppHandle<R>,
    db: State<'_, DbState>,
) -> Result<AppState, String> {
    let _ = (&app, &db);
    Err("biometric unlock is not available on this platform".to_string())
}

/// Lock: drop the in-memory key/connection. Idempotent.
#[tauri::command]
pub fn lock(db: State<'_, DbState>) -> Result<(), String> {
    db.lock()
}

#[tauri::command]
pub fn get_settings<R: Runtime>(app: AppHandle<R>) -> Result<vault::VaultSettings, String> {
    let dir = app_data_dir(&app)?;
    Ok(vault::read_meta(&dir).map(|m| m.settings).unwrap_or_default())
}

#[tauri::command]
pub fn set_idle_timeout<R: Runtime>(
    app: AppHandle<R>,
    secs: u32,
) -> Result<vault::VaultSettings, String> {
    update_settings(&app, |s| s.idle_timeout_secs = clamp_timeout(secs))
}

#[tauri::command]
pub fn set_biometric_enabled<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<vault::VaultSettings, String> {
    update_settings(&app, |s| s.biometric_enabled = enabled)
}

/// Set the base (reporting) currency (FR-1.4). Validated as a 3-letter ISO-4217 code.
#[tauri::command]
pub fn set_base_currency<R: Runtime>(
    app: AppHandle<R>,
    currency: String,
) -> Result<vault::VaultSettings, String> {
    let code = currency.trim().to_uppercase();
    if !crate::domain::account::is_iso4217(&code) {
        return Err("currency must be a 3-letter ISO-4217 code (e.g. MUR)".to_string());
    }
    update_settings(&app, move |s| s.base_currency = code)
}

fn update_settings<R: Runtime>(
    app: &AppHandle<R>,
    f: impl FnOnce(&mut vault::VaultSettings),
) -> Result<vault::VaultSettings, String> {
    let dir = app_data_dir(app)?;
    let mut meta = vault::read_meta(&dir).map_err(|_| vault::VaultError::NotInitialised.to_string())?;
    f(&mut meta.settings);
    vault::write_meta(&dir, &meta).map_err(|e| e.to_string())?;
    Ok(meta.settings)
}

/// `0` = idle timer disabled; otherwise clamp to a sane 15s–1h window.
fn clamp_timeout(secs: u32) -> u32 {
    if secs == 0 {
        0
    } else {
        secs.clamp(15, 3600)
    }
}
