//! BudgetMate Rust core entry point. Registers plugins, opens the encrypted DB into managed
//! state, and exposes the command surface. All business logic lives in the modules below.

pub mod commands;
pub mod crypto;
pub mod db;
pub mod domain;
pub mod export;
pub mod import;
pub mod rules;
pub mod state;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        // File + dialog. NO http/network plugin is ever registered.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Custom on-device OCR (native engines deferred; skeleton returns NotImplemented).
        .plugin(tauri_plugin_ocr::init());

    // Biometric unlock is Android-only here (its init() is mobile-only).
    #[cfg(target_os = "android")]
    {
        builder = builder.plugin(tauri_plugin_biometric::init());
    }

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Open the encrypted DB once, migrate + seed, and hold it in managed state.
            // NOTE: DEV key until the unlock/key-lifecycle flow (#2) replaces this with a key
            // derived from the user passphrase / released by biometrics. The DB file is genuinely
            // SQLCipher-encrypted either way.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("budgetmate.db");
            let key = crypto::derive_key(b"dev-passphrase", b"budgetmate-dev-salt")?;
            let key_hex = crypto::key_to_sqlcipher_hex(&key);
            let now = chrono::Utc::now().to_rfc3339();
            let conn = db::open_and_migrate(&db_path, &key_hex, &now)?;
            app.manage(state::DbState::new(conn));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::db_health,
            commands::accounts::list_accounts,
            commands::accounts::create_account,
            commands::accounts::update_account,
            commands::accounts::archive_account,
            commands::categories::list_categories,
            commands::categories::create_category,
            commands::categories::update_category,
            commands::categories::archive_category,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
