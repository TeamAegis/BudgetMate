// The ONE place in the app that talks to Tauri. Feature code imports typed wrappers from here,
// never `@tauri-apps/api` directly (enforced by eslint no-restricted-imports). This keeps the
// IPC surface auditable and the capability/ACL minimal.
//
// All business logic lives in Rust; these wrappers only marshal arguments and return DTOs.

import { invoke } from '@tauri-apps/api/core';
import type {
  AppInfo,
  AppState,
  DbHealth,
  VaultSettings,
  Account,
  NewAccount,
  UpdateAccount,
  Category,
  NewCategory,
  UpdateCategory,
  Transaction,
  NewTransaction,
  UpdateTransaction,
} from '../models';

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

// ── Unlock / key lifecycle (FR-5.1 / FR-5.2) ────────────────────────────────────

/** Current vault/lock state: initialized? unlocked? biometric availability + idle timeout. */
export function appState(): Promise<AppState> {
  return invoke<AppState>('app_state');
}
/** First-run: set the passphrase, derive the key, create + open the encrypted DB, and unlock. */
export function setPassphrase(passphrase: string): Promise<AppState> {
  return invoke<AppState>('set_passphrase', { passphrase });
}
/** Unlock an initialized vault with the passphrase. Wrong passphrase rejects generically. */
export function unlock(passphrase: string): Promise<AppState> {
  return invoke<AppState>('unlock', { passphrase });
}
/** Biometric unlock (Android). Rejects where biometric is unavailable. */
export function unlockWithBiometric(): Promise<AppState> {
  return invoke<AppState>('unlock_with_biometric');
}
/** Lock: drop the in-memory key + connection in the Rust core. */
export function lock(): Promise<void> {
  return invoke<void>('lock');
}
/** Read non-sensitive lock settings (idle timeout, biometric enabled). */
export function getSettings(): Promise<VaultSettings> {
  return invoke<VaultSettings>('get_settings');
}
/** Persist the idle auto-lock timeout (seconds; 0 disables the idle timer). */
export function setIdleTimeout(secs: number): Promise<VaultSettings> {
  return invoke<VaultSettings>('set_idle_timeout', { secs });
}
/** Enable/disable biometric unlock. */
export function setBiometricEnabled(enabled: boolean): Promise<VaultSettings> {
  return invoke<VaultSettings>('set_biometric_enabled', { enabled });
}

// ── Accounts ───────────────────────────────────────────────────────────────────

export function listAccounts(includeArchived = false): Promise<Account[]> {
  return invoke<Account[]>('list_accounts', { includeArchived });
}
export function createAccount(account: NewAccount): Promise<Account> {
  return invoke<Account>('create_account', { account });
}
export function updateAccount(account: UpdateAccount): Promise<Account> {
  return invoke<Account>('update_account', { account });
}
export function archiveAccount(id: number): Promise<void> {
  return invoke<void>('archive_account', { id });
}

// ── Categories ───────────────────────────────────────────────────────────────────

export function listCategories(includeArchived = false): Promise<Category[]> {
  return invoke<Category[]>('list_categories', { includeArchived });
}
export function createCategory(category: NewCategory): Promise<Category> {
  return invoke<Category>('create_category', { category });
}
export function updateCategory(category: UpdateCategory): Promise<Category> {
  return invoke<Category>('update_category', { category });
}
export function archiveCategory(id: number): Promise<void> {
  return invoke<void>('archive_category', { id });
}

// ── Transactions (FR-1.1) ──────────────────────────────────────────────────────

/** All transactions, newest first, each with its category splits. */
export function listTransactions(): Promise<Transaction[]> {
  return invoke<Transaction[]>('list_transactions');
}
/** Create a manual transaction (Rust parses the amount + signs it from the category kind). */
export function createTransaction(tx: NewTransaction): Promise<Transaction> {
  return invoke<Transaction>('create_transaction', { tx });
}
export function updateTransaction(tx: UpdateTransaction): Promise<Transaction> {
  return invoke<Transaction>('update_transaction', { tx });
}
export function deleteTransaction(id: number): Promise<void> {
  return invoke<void>('delete_transaction', { id });
}
