// The ONE place in the app that talks to Tauri. Feature code imports typed wrappers from here,
// never `@tauri-apps/api` directly (enforced by eslint no-restricted-imports). This keeps the
// IPC surface auditable and the capability/ACL minimal.
//
// All business logic lives in Rust; these wrappers only marshal arguments and return DTOs.

import { invoke } from '@tauri-apps/api/core';
import type { AppInfo, DbHealth } from '../models';

/** Whether we are running inside the Tauri runtime (vs. plain browser `ng serve`). */
export function isTauri(): boolean {
  return typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
    'undefined';
}

/** App metadata (name/version/platform) from the Rust core. */
export function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>('get_app_info');
}

/** Opens the SQLCipher DB with the in-memory key and reports schema/encryption state. */
export function dbHealth(): Promise<DbHealth> {
  return invoke<DbHealth>('db_health');
}
