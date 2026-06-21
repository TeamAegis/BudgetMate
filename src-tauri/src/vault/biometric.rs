//! Biometric-unlock abstraction.
//!
//! Android uses `tauri-plugin-biometric` to release a keystore-held secret; every other target
//! (Windows desktop dev, iOS-deferred) has no biometric and the app degrades to **passphrase
//! only**. Keeping this behind one function means the command surface and the frontend never need
//! a platform branch - `available` is simply `false` where there is no biometric.
//!
//! NOTE: the on-device biometric → keystore secret → DB-key release path is wired up during the
//! Android bring-up (#4) where it can be tested on a device. Until then `available()` reports
//! `false` and the passphrase path is the sole unlock route on every platform.

/// Biometric capability for the current platform/runtime.
#[derive(Debug, Clone, Copy)]
pub struct BiometricStatus {
    pub available: bool,
}

#[cfg(target_os = "android")]
pub fn status<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) -> BiometricStatus {
    // TODO(#4, on-device): query tauri_plugin_biometric status and report real availability.
    BiometricStatus { available: false }
}

#[cfg(not(target_os = "android"))]
pub fn status<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) -> BiometricStatus {
    BiometricStatus { available: false }
}
