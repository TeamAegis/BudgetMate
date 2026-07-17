//! BudgetMate Rust core entry point. Registers plugins, opens the encrypted DB into managed
//! state, and exposes the command surface. All business logic lives in the modules below.

pub mod commands;
pub mod crypto;
pub mod db;
pub mod domain;
pub mod error;
pub mod export;
pub mod import;
pub mod rules;
pub mod state;
pub mod vault;

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

    // Biometric unlock and the content-URI-aware file reader (CSV import, FR-2.2) are
    // Android-only: their init()s are mobile-only, and android-fs isn't even a dependency on
    // other targets (see Cargo.toml's `cfg(target_os = "android")` dependency block).
    #[cfg(target_os = "android")]
    {
        builder = builder
            .plugin(tauri_plugin_biometric::init())
            .plugin(tauri_plugin_android_fs::init());
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

            // The app boots LOCKED: no key is in memory and the DB connection is absent until the
            // user unlocks (commands::vault). The key is derived from the passphrase (Argon2id)
            // and held only as the keyed connection; it is dropped on lock/background (FR-5.2).
            app.manage(state::DbState::locked());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::db_health,
            commands::vault::app_state,
            commands::vault::set_passphrase,
            commands::vault::unlock,
            commands::vault::unlock_with_biometric,
            commands::vault::lock,
            commands::vault::get_settings,
            commands::vault::set_idle_timeout,
            commands::vault::set_biometric_enabled,
            commands::vault::set_base_currency,
            commands::vault::currency_minor_units,
            commands::accounts::list_accounts,
            commands::accounts::create_account,
            commands::accounts::update_account,
            commands::accounts::archive_account,
            commands::categories::list_categories,
            commands::categories::create_category,
            commands::categories::update_category,
            commands::categories::archive_category,
            commands::goals::list_goals,
            commands::goals::create_goal,
            commands::goals::update_goal,
            commands::goals::delete_goal,
            commands::transactions::list_transactions,
            commands::transactions::create_transaction,
            commands::transactions::update_transaction,
            commands::transactions::delete_transaction,
            commands::recurring::list_recurring_rules,
            commands::recurring::create_recurring_rule,
            commands::recurring::update_recurring_rule,
            commands::recurring::set_recurring_active,
            commands::rules::list_rules,
            commands::rules::create_rule,
            commands::rules::update_rule,
            commands::rules::set_rule_active,
            commands::rules::delete_rule,
            commands::rules::reorder_rules,
            commands::rules::preview_rules,
            commands::ocr::extract_receipt,
            commands::import::import_read_headers,
            commands::import::import_preview,
            commands::import::import_commit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
