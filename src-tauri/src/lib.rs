//! BudgetMate Rust core entry point. Registers plugins and the command surface. All business
//! logic (money, crypto, db, rules, import/export) lives in the modules below; commands are thin.

pub mod commands;
pub mod crypto;
pub mod db;
pub mod domain;
pub mod export;
pub mod import;
pub mod rules;

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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::db_health
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
