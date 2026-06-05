//! Thin `#[tauri::command]` wrappers: validate input, call domain/db, return a serde DTO.
//! No heavy logic here. Every DTO has a 1:1 mirror in `src/app/core/models` (kept in sync).

use serde::Serialize;
use std::fs;
use tauri::{AppHandle, Manager};

use crate::crypto;
use crate::db;

/// Mirrors TS `AppInfo`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
}

/// Mirrors TS `DbHealth`. Proves the encrypted DB opened with the in-memory key and migrated.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbHealth {
    pub ok: bool,
    pub schema_version: i64,
    pub encrypted: bool,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "BudgetMate".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
    }
}

/// Open the SQLCipher DB with a key derived in-memory, run migrations, and report state.
///
/// NOTE: this uses a DEV passphrase/salt to prove the encrypted DB path end-to-end. The real
/// key comes from the biometric/passphrase unlock flow (FR-5.1, architecture §5.2); replace the
/// dev derivation when that lands. The DB file is genuinely SQLCipher-encrypted either way.
#[tauri::command]
pub fn db_health(app: AppHandle) -> Result<DbHealth, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let db_path = dir.join("budgetmate.db");

    // DEV ONLY — see note above.
    let key = crypto::derive_key(b"dev-passphrase", b"budgetmate-dev-salt")
        .map_err(|e| e.to_string())?;
    let key_hex = crypto::key_to_sqlcipher_hex(&key);

    let conn = db::open_encrypted(&db_path, &key_hex).map_err(|e| e.to_string())?;
    let encrypted = db::is_encrypted(&conn);
    let now = chrono::Utc::now().to_rfc3339();
    let schema_version = db::run_migrations(&conn, &now).map_err(|e| e.to_string())?;

    Ok(DbHealth { ok: true, schema_version, encrypted })
}
