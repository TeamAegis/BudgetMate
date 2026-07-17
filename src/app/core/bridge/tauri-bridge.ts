// The ONE place in the app that talks to Tauri. Feature code imports typed wrappers from here,
// never `@tauri-apps/api` directly (enforced by eslint no-restricted-imports). This keeps the
// IPC surface auditable and the capability/ACL minimal.
//
// All business logic lives in Rust; these wrappers only marshal arguments and return DTOs.

import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import type {
  AppInfo,
  AppState,
  DbHealth,
  VaultSettings,
  CurrencyMinorUnits,
  Account,
  NewAccount,
  UpdateAccount,
  Category,
  NewCategory,
  UpdateCategory,
  Transaction,
  NewTransaction,
  UpdateTransaction,
  RecurringRule,
  NewRecurringRule,
  UpdateRecurringRule,
  ImportRule,
  NewRule,
  UpdateRule,
  RulePreview,
  RulePreviewInput,
  Goal,
  NewGoal,
  UpdateGoal,
  Budget,
  NewBudget,
  UpdateBudget,
  EnvelopeSummary,
  ReceiptExtraction,
  ImportFormat,
  ImportHeaders,
  ImportPreviewInput,
  ImportPreviewData,
  ImportCommitInput,
  ImportResultData,
  ReportData,
  ReportPeriod,
  DashboardData,
  ExportFormat,
  ExportSummary,
  BackupSummary,
  RestoreMode,
  RestoreSummary,
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
/** Set the base (reporting) currency (FR-1.4); validated as a 3-letter ISO-4217 code in Rust. */
export function setBaseCurrency(currency: string): Promise<VaultSettings> {
  return invoke<VaultSettings>('set_base_currency', { currency });
}
/** Authoritative currency minor-unit-digit table from Rust (single source of truth for money scale). */
export function currencyMinorUnits(): Promise<CurrencyMinorUnits> {
  return invoke<CurrencyMinorUnits>('currency_minor_units');
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

// ── Recurring rules (FR-1.3) ────────────────────────────────────────────────────
// Materialisation runs server-side on unlock; these manage the rules themselves.

export function listRecurringRules(): Promise<RecurringRule[]> {
  return invoke<RecurringRule[]>('list_recurring_rules');
}
export function createRecurringRule(rule: NewRecurringRule): Promise<RecurringRule> {
  return invoke<RecurringRule>('create_recurring_rule', { rule });
}
export function updateRecurringRule(rule: UpdateRecurringRule): Promise<RecurringRule> {
  return invoke<RecurringRule>('update_recurring_rule', { rule });
}
export function setRecurringActive(id: number, active: boolean): Promise<RecurringRule> {
  return invoke<RecurringRule>('set_recurring_active', { id, active });
}

// ── Rule engine (FR-2.3) ─────────────────────────────────────────────────────────

export function listRules(): Promise<ImportRule[]> {
  return invoke<ImportRule[]>('list_rules');
}
export function createRule(rule: NewRule): Promise<ImportRule> {
  return invoke<ImportRule>('create_rule', { rule });
}
export function updateRule(rule: UpdateRule): Promise<ImportRule> {
  return invoke<ImportRule>('update_rule', { rule });
}
export function setRuleActive(id: number, active: boolean): Promise<ImportRule> {
  return invoke<ImportRule>('set_rule_active', { id, active });
}
export function deleteRule(id: number): Promise<void> {
  return invoke<void>('delete_rule', { id });
}
/** Reassign rule precedence to match this id order (1-based ordinals). */
export function reorderRules(ids: number[]): Promise<ImportRule[]> {
  return invoke<ImportRule[]>('reorder_rules', { ids });
}
/** Run the active rules over sample fields; returns the result + which rules fired (the "why"). */
export function previewRules(input: RulePreviewInput): Promise<RulePreview> {
  return invoke<RulePreview>('preview_rules', { input });
}

// ── Goals (FR-3.2) ───────────────────────────────────────────────────────────────
// Active goals first, then completed. Rust parses major-unit amounts + derives `completed`.

export function listGoals(): Promise<Goal[]> {
  return invoke<Goal[]>('list_goals');
}
export function createGoal(goal: NewGoal): Promise<Goal> {
  return invoke<Goal>('create_goal', { goal });
}
export function updateGoal(goal: UpdateGoal): Promise<Goal> {
  return invoke<Goal>('update_goal', { goal });
}
export function deleteGoal(id: number): Promise<void> {
  return invoke<void>('delete_goal', { id });
}

// ── Budgets / envelopes (FR-3.1) ────────────────────────────────────────────────
// Spend aggregation (splits, base-currency conversion, period bounds, status) is computed in
// Rust; the frontend only renders `EnvelopeSummary` and formats via the money pipe.

/** Every budgeted category's cap/spend/status for the CURRENT calendar month. */
export function listEnvelopes(): Promise<EnvelopeSummary[]> {
  return invoke<EnvelopeSummary[]>('list_envelopes');
}
/** The raw budget row, for the edit form to preload. */
export function getBudget(id: number): Promise<Budget> {
  return invoke<Budget>('get_budget', { id });
}
export function createBudget(budget: NewBudget): Promise<Budget> {
  return invoke<Budget>('create_budget', { budget });
}
export function updateBudget(budget: UpdateBudget): Promise<Budget> {
  return invoke<Budget>('update_budget', { budget });
}
export function deleteBudget(id: number): Promise<void> {
  return invoke<void>('delete_budget', { id });
}

// ── OCR receipt scan (FR-2.1) ──────────────────────────────────────────────────────

/**
 * Open the native picker for a receipt image and return its local path (or `null` if cancelled).
 * Images stay on-device; no network is ever touched. Routed through the bridge so the dialog ACL
 * stays auditable.
 */
export async function pickReceiptImage(): Promise<string | null> {
  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'bmp'] }],
  });
  // The dialog returns a path string (or null); array form is only for multiple:true.
  return typeof selected === 'string' ? selected : null;
}

/**
 * Run on-device OCR over a local receipt image and deterministically extract merchant/date/total
 * (FR-2.1). Heavy work happens off the UI thread in Rust/native. Suggestions only - the caller
 * prefills the manual-entry form and the user confirms before any save. `engineAvailable` is false
 * where the native engine isn't built (desktop dev/test).
 */
export function extractReceipt(imagePath: string): Promise<ReceiptExtraction> {
  return invoke<ReceiptExtraction>('extract_receipt', { imagePath });
}

// ── Bank-file import (FR-2.2) ────────────────────────────────────────────────────
// CSV and OFX/QFX are both wired end-to-end (docs/adr/0011-ofx-import-wiring.md). Nothing is
// written until `importCommit` - the wizard always shows a reviewing step first.

/** Native file-picker filter per format, so the dialog only offers files that make sense for the
 *  chosen import format. */
const IMPORT_FILE_FILTERS: Record<ImportFormat, { name: string; extensions: string[] }> = {
  csv: { name: 'Bank statement (CSV)', extensions: ['csv', 'txt'] },
  ofx: { name: 'Bank statement (OFX)', extensions: ['ofx', 'txt'] },
  qfx: { name: 'Bank statement (QFX)', extensions: ['qfx', 'txt'] },
};

/**
 * Open the native picker for a bank-statement file and return its local path (or `null` if
 * cancelled). The file stays on-device; nothing is uploaded. Routed through the bridge so the
 * dialog ACL stays auditable.
 */
export async function pickImportFile(format: ImportFormat = 'csv'): Promise<string | null> {
  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [IMPORT_FILE_FILTERS[format]],
  });
  return typeof selected === 'string' ? selected : null;
}

/** Read the header row + a few sample data rows of a picked file, for the column-mapping step. */
export function importReadHeaders(path: string, format: ImportFormat): Promise<ImportHeaders> {
  return invoke<ImportHeaders>('import_read_headers', { path, format });
}

/**
 * Parse the file against a column mapping, apply the active rules + dedup, and return the rows
 * for review. Writes nothing - the user confirms on the reviewing step (`importCommit`).
 */
export function importPreview(input: ImportPreviewInput): Promise<ImportPreviewData> {
  return invoke<ImportPreviewData>('import_preview', { input });
}

/**
 * Commit the import as one ACID batch, skipping any rows the user chose not to import. Malformed
 * rows are never included - they were already excluded and reported at the preview step.
 */
export function importCommit(input: ImportCommitInput): Promise<ImportResultData> {
  return invoke<ImportResultData>('import_commit', { input });
}

// ── Reporting (FR-3.3) ───────────────────────────────────────────────────────────

/**
 * Spend-by-category + spend-over-time aggregation for `period`, optionally narrowed to one
 * category. All money conversion (fx), date bucketing, and pending-review exclusion happen in
 * Rust; this only marshals the call.
 */
export function getReport(period: ReportPeriod, categoryId?: number | null): Promise<ReportData> {
  return invoke<ReportData>('get_report', { period, categoryId: categoryId ?? null });
}

// ── Home dashboard (issue #50) ───────────────────────────────────────────────────

/**
 * The Home dashboard aggregate: total/usable balance, the goals-reserved figure, this-month
 * spend, the trailing 6-month balance trend, and a goals preview. All money math (fx-aware
 * summing, goal netting, month bucketing) happens in Rust; this only marshals the call.
 */
export function getDashboard(): Promise<DashboardData> {
  return invoke<DashboardData>('get_dashboard');
}

// ── Export (FR-4.2) ──────────────────────────────────────────────────────────────
// Desktop-first: the save destination is picked here (the only place that touches
// `@tauri-apps/plugin-dialog`) and handed to Rust, which reads the DB, builds the file bytes, and
// writes them with `std::fs::write`. Android's SAF-backed save is a separate, device-verified
// change; the export screen detects the platform via `getAppInfo()` and doesn't call these on
// Android.

const EXPORT_EXTENSION: Record<'csv' | 'xlsx', string> = { csv: 'csv', xlsx: 'xlsx' };

/**
 * Open the native save picker for an export destination (CSV/XLSX only - JSON is never offered).
 * Returns the chosen path, or `null` if the user cancelled.
 */
export async function pickExportDestination(format: 'csv' | 'xlsx'): Promise<string | null> {
  const ext = EXPORT_EXTENSION[format];
  const today = new Date().toISOString().slice(0, 10);
  const selected = await saveDialog({
    defaultPath: `budgetmate-export-${today}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  return selected ?? null;
}

/**
 * Export every transaction to `format` at `destPath` (already chosen via `pickExportDestination`).
 * Rust reads the DB, assembles the rows, renders the file, and writes it; this only marshals the
 * call. Desktop-first (see the export ADR) - never called on Android.
 */
export function exportTransactions(format: ExportFormat, destPath: string): Promise<ExportSummary> {
  return invoke<ExportSummary>('export_transactions', { format, destPath });
}

// ── Backup (FR-4.1) ───────────────────────────────────────────────────────────────
// Desktop-first: the save destination is picked here (the only place that touches
// `@tauri-apps/plugin-dialog`) and handed to Rust, which copies the already-encrypted SQLCipher DB
// bytes, bundles them with the non-secret salt/KDF params, and writes the `.vaultbak` envelope with
// `std::fs::write`. Android's SAF-backed save is a separate, device-verified change; the backup
// screen detects the platform via `getAppInfo()` and doesn't call these on Android.

/**
 * Open the native save picker for a backup destination. Returns the chosen path, or `null` if the
 * user cancelled.
 */
export async function pickBackupDestination(): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10);
  const selected = await saveDialog({
    defaultPath: `budgetmate-backup-${today}.vaultbak`,
    filters: [{ name: 'Vault backup', extensions: ['vaultbak'] }],
  });
  return selected ?? null;
}

/**
 * Write an encrypted `.vaultbak` snapshot at `destPath` (already chosen via
 * `pickBackupDestination`). Rust copies the already-encrypted DB bytes, bundles the non-secret
 * salt/KDF params, and writes the file; this only marshals the call. Desktop-first (see the backup
 * ADR) - never called on Android.
 */
export function createBackup(destPath: string): Promise<BackupSummary> {
  return invoke<BackupSummary>('create_backup', { destPath });
}

// ── Restore (FR-4.3) ─────────────────────────────────────────────────────────────
// Desktop-first, REPLACE mode only (ADR 0008) - Merge mode and Android's SAF file-pick are a
// deferred follow-up. The frontend picks the `.vaultbak` file via the open dialog (the only place
// besides `pickReceiptImage`/`pickBackupDestination` that touches `@tauri-apps/plugin-dialog`) and
// hands its path + the backup's own passphrase to `restore_backup`, which validates, swaps the live
// database + meta sidecar for the backup's, and reopens it - all inside Rust.

/**
 * Open the native open picker for a `.vaultbak` file to restore. Returns the chosen path, or
 * `null` if the user cancelled.
 */
export async function pickBackupFile(): Promise<string | null> {
  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: 'Vault backup', extensions: ['vaultbak'] }],
  });
  return typeof selected === 'string' ? selected : null;
}

/**
 * Restore the vault from the `.vaultbak` file at `backupPath` (already chosen via
 * `pickBackupFile`) using the BACKUP's own passphrase (which may differ from the current one).
 * `mode` defaults to `'replace'` - the only mode implemented so far (merge is deferred). Rust
 * validates the envelope, swaps the live database + meta sidecar for the backup's inside a
 * crash-safe copy/rename sequence, and reopens the connection; this only marshals the call.
 */
export function restoreBackup(
  backupPath: string,
  passphrase: string,
  mode: RestoreMode = 'replace',
): Promise<RestoreSummary> {
  return invoke<RestoreSummary>('restore_backup', { backupPath, passphrase, mode });
}
