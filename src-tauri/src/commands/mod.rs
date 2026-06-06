//! Thin `#[tauri::command]` wrappers: validate input, call domain/db, return a serde DTO.
//! No heavy logic here. Every DTO has a 1:1 mirror in `src/app/core/models` (kept in sync).

pub mod accounts;
pub mod categories;
pub mod transactions;
pub mod vault;

use serde::Serialize;
use tauri::State;

use crate::db;
use crate::state::DbState;

/// Mirrors TS `AppInfo`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
}

/// Mirrors TS `DbHealth`. Reports the managed encrypted connection's state.
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

/// Report the managed DB connection's health: open, encrypted, and at which schema version.
/// The connection is opened + migrated at startup (`lib.rs`); the unlock flow (#2) will gate it.
#[tauri::command]
pub fn db_health(state: State<'_, DbState>) -> Result<DbHealth, String> {
    state.with(|conn| {
        let schema_version: i64 = conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |r| r.get(0),
        )?;
        Ok(DbHealth { ok: true, schema_version, encrypted: db::is_encrypted(conn) })
    })
}
