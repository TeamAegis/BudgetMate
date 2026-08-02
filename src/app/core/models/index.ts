// TypeScript mirrors of Rust DTOs (serde structs) crossing the Tauri IPC boundary.
// MUST stay 1:1 with the Rust structs in src-tauri/src/. When a Rust DTO changes, update the
// matching interface here in the SAME change (CLAUDE.md / new-feature skill).
//
// Money is always integer MINOR UNITS (e.g. cents) + a currency code. Never a float, and never
// do money arithmetic in TypeScript - format only.

export type Iso4217 = string; // e.g. "USD", "GBP"

/** Mirrors Rust `AppInfo` (commands::app). */
export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

/** Mirrors Rust `DbHealth` (commands::health). Proves the encrypted DB opened + migrated. */
export interface DbHealth {
  ok: boolean;
  schemaVersion: number;
  encrypted: boolean;
}

/** Mirrors Rust `AppState` (commands::vault). Drives shell routing: setup vs unlock vs app. */
export interface AppState {
  /** A passphrase has been set (vault meta exists). */
  initialized: boolean;
  /** The DB key is in memory and the connection is open. */
  unlocked: boolean;
  /** Biometric hardware is available on this platform (Android). */
  biometricAvailable: boolean;
  /** Biometric unlock has been enabled by the user. */
  biometricEnabled: boolean;
  /** Idle auto-lock timeout in seconds; 0 disables the idle timer. */
  idleTimeoutSecs: number;
}

/** Mirrors Rust `VaultSettings` (vault). Non-sensitive lock preferences, readable while locked. */
export interface VaultSettings {
  idleTimeoutSecs: number;
  biometricEnabled: boolean;
  /** Base (reporting) currency; foreign amounts convert to it via a per-transaction rate (FR-1.4). */
  baseCurrency: Iso4217;
  /** Dedup window in days (FR-2.4): how many days apart, at the same amount + account, an imported
   *  row is flagged as a possible duplicate. */
  dedupWindowDays: number;
}

/** Mirrors Rust `Money` (domain::money). */
export interface Money {
  amountMinor: number;
  currency: Iso4217;
}

/** Mirrors Rust `CurrencyDigits` (domain::money). One currency's minor-unit digit count. */
export interface CurrencyDigits {
  currency: Iso4217;
  digits: number;
}

/**
 * Mirrors Rust `CurrencyMinorUnits` (domain::money): the authoritative minor-unit scale table.
 * Single source of truth for money scale - fetched once via `currencyMinorUnits()` and cached by
 * `CurrencyService` (core/money). No currency-digit knowledge is hardcoded in TypeScript.
 */
export interface CurrencyMinorUnits {
  defaultDigits: number;
  exceptions: CurrencyDigits[];
}

// ── Accounts & Categories (mirror domain::account / domain::category) ──────────────

/** Mirrors Rust `AccountKind`. */
export type AccountKind = 'cash' | 'bank' | 'card' | 'wallet' | 'other';

/** Mirrors Rust `Account`. */
export interface Account {
  id: number;
  name: string;
  accountType: AccountKind;
  currency: Iso4217;
  openingBalanceMinor: number;
  archived: boolean;
  /** DERIVED in Rust, never stored: the balance right now in this account's own `currency` -
   *  `openingBalanceMinor` plus its confirmed, not-future-dated transactions. Show THIS on the
   *  Accounts screen; `openingBalanceMinor` is only where the account started. */
  balanceMinor: number;
}

/** Input for create_account (mirrors Rust `NewAccount`). */
export interface NewAccount {
  name: string;
  accountType: AccountKind;
  currency: Iso4217;
  openingBalanceMinor: number;
}

/** Input for update_account (mirrors Rust `UpdateAccount`). */
export interface UpdateAccount extends NewAccount {
  id: number;
}

/** Mirrors Rust `CategoryKind`. */
export type CategoryKind = 'expense' | 'income' | 'transfer';

/** Mirrors Rust `Category`. */
export interface Category {
  id: number;
  name: string;
  parentId: number | null;
  kind: CategoryKind;
  archived: boolean;
}

/** Input for create_category (mirrors Rust `NewCategory`). */
export interface NewCategory {
  name: string;
  parentId: number | null;
  kind: CategoryKind;
}

/** Input for update_category (mirrors Rust `UpdateCategory`). */
export interface UpdateCategory extends NewCategory {
  id: number;
}

// ── Transactions (mirror domain::transaction) ──────────────────────────────────────

/** How a transaction entered the ledger. Mirrors the Rust `source` CHECK column. */
export type TransactionSource = 'manual' | 'ocr' | 'import';

/** One category line of a transaction (mirrors Rust `TxSplit`). Amount is signed like the parent. */
export interface TxSplit {
  id: number;
  categoryId: number;
  categoryName: string;
  amountMinor: number;
}

/**
 * Mirrors Rust `Transaction`. `amountMinor` is SIGNED (expenses negative, income/transfers
 * positive) and is computed in Rust - never derive or re-sign it in TS. Categorisation is via
 * `splits` (one for a manual entry; ≥2 once FR-1.2 lands).
 */
export interface Transaction {
  id: number;
  accountId: number;
  postedDate: string;
  amountMinor: number;
  currency: Iso4217;
  /** fx rate as a decimal string (never a float); "1" for same-currency entries. */
  fxRate: string;
  baseAmountMinor: number;
  payee: string | null;
  note: string | null;
  source: TransactionSource;
  sourceRef: string | null;
  pendingReview: boolean;
  createdAt: string;
  /** Optional allowance envelope tag (FR-3.4); `null` for an untagged transaction. */
  allowanceId: number | null;
  /** Set on BOTH legs of an account-to-account transfer, linking them; `null` for an ordinary
   *  transaction. Its presence is what lets the UI label the row as a transfer and render the
   *  amount neutrally rather than as spending or income. */
  transferGroupId: string | null;
  splits: TxSplit[];
}

/** ── Transfers (linked transaction pair, migration 0006) ─────────────────────
 *  A transfer is not its own entity: it is two ordinary transactions sharing a `transferGroupId`,
 *  the source leg negative and the destination leg positive, both filed under the single
 *  `transfer`-kind category. Spend queries filter `kind = 'expense'`, so transfers never reach spend
 *  totals, budgets, or the dashboard's this-month figure. v1 is SAME-CURRENCY only (Rust rejects a
 *  mismatch), which is what guarantees a transfer cannot change your total balance. */
export interface Transfer {
  /** Shared id linking the two legs (also on each leg's `transferGroupId`). */
  groupId: string;
  /** The negative leg, on the source account. */
  fromLeg: Transaction;
  /** The positive leg, on the destination account. */
  toLeg: Transaction;
}

/** Input for create_transfer (mirrors Rust `NewTransfer`). No currency: it comes from the accounts
 *  themselves, and Rust rejects a mismatch between them. */
export interface NewTransfer {
  fromAccountId: number;
  toAccountId: number;
  /** Positive major-unit string (e.g. "5000.00"); Rust parses it to minor units. */
  amount: string;
  /** ISO `yyyy-mm-dd`. */
  postedDate: string;
  note?: string | null;
}

/** One category line of a new/updated transaction (mirrors Rust `NewSplit`). */
export interface NewSplit {
  categoryId: number;
  /** Non-negative major-unit string (e.g. "30.00"); Rust parses + signs it. */
  amount: string;
}

/**
 * Input for create_transaction (mirrors Rust `NewTransaction`). `amount` is the NON-NEGATIVE
 * major-unit total (e.g. "15.00"); `splits` allocate it across categories (one split for a simple
 * entry, ≥2 for a split transaction) and must sum to the total. Rust parses to minor units in the
 * account's currency, validates the sum, and applies the sign from the (shared) category kind. No
 * money math in TS.
 */
export interface NewTransaction {
  accountId: number;
  postedDate: string;
  amount: string;
  /** Transaction currency (defaults to the account's when omitted) + rate to base (FR-1.4). */
  currency?: Iso4217 | null;
  fxRate?: string | null;
  splits: NewSplit[];
  payee?: string | null;
  note?: string | null;
  /** Optional allowance envelope tag (FR-3.4). Omit/`null` for an untagged transaction. */
  allowanceId?: number | null;
}

/** Input for update_transaction (mirrors Rust `UpdateTransaction`). */
export interface UpdateTransaction extends NewTransaction {
  id: number;
}

// ── Recurring rules (mirror db::recurring) ─────────────────────────────────────────

/** How often a recurring transaction repeats. Mirrors Rust `Schedule`. */
export type Schedule = 'daily' | 'weekly' | 'monthly';

/** The fixed transaction a rule stamps out (mirrors Rust `RecurringTemplate`). One category. */
export interface RecurringTemplate {
  accountId: number;
  categoryId: number;
  /** Non-negative major-unit string (e.g. "1500.00"); Rust parses + signs it on materialisation. */
  amount: string;
  payee: string | null;
  note: string | null;
}

/** A recurring rule (mirrors Rust `RecurringRule`). Occurrences materialise lazily on app open. */
export interface RecurringRule {
  id: number;
  schedule: Schedule;
  nextRunDate: string;
  lastMaterialisedDate: string | null;
  active: boolean;
  template: RecurringTemplate;
}

/** Input for create_recurring_rule (mirrors Rust `NewRecurringRule`). */
export interface NewRecurringRule {
  schedule: Schedule;
  nextRunDate: string;
  template: RecurringTemplate;
}

/** Input for update_recurring_rule (mirrors Rust `UpdateRecurringRule`). */
export interface UpdateRecurringRule extends NewRecurringRule {
  id: number;
}

// ── Rule engine (mirror db::rules / rules::engine) ─────────────────────────────────

/** How a rule matches. Mirrors Rust `MatchOp`. */
export type MatchOp = 'contains' | 'equals';

/** Transaction fields a rule can read/write. Mirrors Rust `RULE_FIELDS`. */
export type RuleField = 'merchant' | 'category' | 'account';

/** A persisted if-then rule (mirrors Rust `ImportRule`). Evaluated top-down by `ordinal`. */
export interface ImportRule {
  id: number;
  ordinal: number;
  matchField: RuleField;
  matchOp: MatchOp;
  matchValue: string;
  setField: RuleField;
  setValue: string;
  active: boolean;
}

/** Input for create_rule (mirrors Rust `NewRule`). */
export interface NewRule {
  matchField: RuleField;
  matchOp: MatchOp;
  matchValue: string;
  setField: RuleField;
  setValue: string;
  active: boolean;
}

/** Input for update_rule (mirrors Rust `UpdateRule`). */
export interface UpdateRule extends NewRule {
  id: number;
}

/** One rule that fired during a preview (mirrors Rust `AppliedRule`). */
export interface AppliedRule {
  ordinal: number;
  setField: RuleField;
  setValue: string;
  matchField: RuleField;
  matchOp: MatchOp;
  matchValue: string;
}

/** Result of previewing the active rules over sample fields (mirrors Rust `RulePreview`). */
export interface RulePreview {
  merchant: string | null;
  category: string | null;
  account: string | null;
  applied: AppliedRule[];
  categoryReason: AppliedRule | null;
}

/** Sample fields to preview rules against (mirrors Rust `PreviewInput`). */
export interface RulePreviewInput {
  merchant?: string | null;
  category?: string | null;
  account?: string | null;
}

// ── OCR receipt extraction (FR-2.1) ────────────────────────────────────────────────

/**
 * Deterministically extracted receipt fields (mirrors Rust `rules::receipt::ExtractedReceipt`).
 * Suggestions only - the user confirms/edits before anything is saved. `totalMinor` is in a FIXED
 * 2-decimal print scale (printedValue * 100) - NOT necessarily the account/base-currency
 * minor-unit scale (0dp for JPY, 3dp for BHD, etc). The frontend rescales it to base-currency
 * minor units (see `receiptTotalToBaseMinor` in `features/import/import.ts`) before handing it off
 * as a `TransactionPrefill`. Any field can be `null` when nothing recognisable was found
 * (low-confidence/manual state).
 */
export interface ExtractedReceipt {
  merchant: string | null;
  /** ISO-8601 `yyyy-mm-dd`. */
  date: string | null;
  /** Total in a FIXED 2-decimal print scale (printedValue * 100); never a float. Not yet rescaled
   *  to any account/base currency's own minor-unit scale - see the interface doc above. */
  totalMinor: number | null;
}

/**
 * Result of `extract_receipt` (mirrors Rust `commands::ocr::ReceiptExtraction`). `engineAvailable`
 * is false when the native OCR engine is not built on this platform (desktop dev/test, iOS
 * deferred) - the UI shows an "OCR engine not available yet" state instead of an error.
 */
export interface ReceiptExtraction {
  engineAvailable: boolean;
  fields: ExtractedReceipt;
}

/**
 * A draft transaction handed to the manual-entry form to PREFILL it (e.g. from an OCR scan,
 * FR-2.1). Not an IPC DTO - purely a frontend hand-off via router state. The user must still
 * review/edit and explicitly Save; nothing is auto-committed. `totalMinor` is integer minor units.
 */
export interface TransactionPrefill {
  payee: string | null;
  postedDate: string | null;
  totalMinor: number | null;
  /** Currency the `totalMinor` is expressed in - the consumer form MUST honor this when decoding
   *  `totalMinor` and choosing the account default (see `patchForCreate` in `transaction-form.ts`),
   *  rather than reinterpreting the value against the default account's currency. */
  currency: Iso4217;
}

// ── Goals (FR-3.2) ───────────────────────────────────────────────────────────────

/** A savings goal (mirrors Rust `Goal`). `currentMinor` is the amount saved so far; `completed`
 *  is derived in Rust (currentMinor >= targetMinor). Amounts are integer minor units. */
export interface Goal {
  id: number;
  name: string;
  targetMinor: number;
  currentMinor: number;
  currency: string;
  targetDate: string | null;
  completed: boolean;
}

/** Input for create_goal (mirrors Rust `NewGoal`). `target`/`current` are major-unit strings
 *  (e.g. "10000.00"); Rust parses them to minor units. `current` defaults to "0". */
export interface NewGoal {
  name: string;
  target: string;
  current?: string;
  currency: string;
  targetDate?: string | null;
}

/** Input for update_goal (mirrors Rust `UpdateGoal`). */
export interface UpdateGoal extends NewGoal {
  id: number;
}

// ── Allowances (FR-3.4, mirror domain::allowance / db::allowances) ──────────────
// Savings-backed envelopes (docs/allowances.md, ADR 0005/0012). `Total`/`Available` are NEVER
// stored - `totalMinor`/`availableMinor` are computed fresh from the dashboard aggregation each
// call. Allowances are base-currency only (validated at creation); `reservedMinor`/`overspent`/
// `underfunded` are derived in Rust, never computed in TS.

/** `"recurring"` refreshes to `targetMinor` on a cadence; `"one_time"` never refreshes and
 *  auto-closes once spent to zero or below (mirrors Rust allowance `kind`). */
export type AllowanceKind = 'recurring' | 'one_time';

/** Refresh cadence for a recurring allowance - weekly or monthly only, never daily (mirrors the DB
 *  `period` CHECK column; NOT the same enum as `Schedule`, which also allows daily for FR-1.3). */
export type AllowancePeriod = 'weekly' | 'monthly';

/** A savings-backed allowance envelope (mirrors Rust `Allowance`). All money is integer minor units
 *  in `currency` (always the vault's base currency). `reservedMinor`/`overspent`/`underfunded` are
 *  DERIVED in Rust on every read, never stored. */
export interface Allowance {
  id: number;
  name: string;
  currency: Iso4217;
  targetMinor: number;
  balanceMinor: number;
  kind: AllowanceKind;
  /** Set only for `'recurring'`; `null` for `'one_time'`. */
  period: AllowancePeriod | null;
  /** ISO weekday the allowance refreshes on (Mon=1..Sun=7); set only for a `'weekly'` period. */
  weekStart: number | null;
  /** `YYYY-MM-DD`; `null` for a one-time allowance (it never refreshes). */
  nextRefreshDate: string | null;
  active: boolean;
  createdAt: string;
  /** Derived: `max(0, balanceMinor)` while active, else `0`. */
  reservedMinor: number;
  /** Derived: `balanceMinor < 0`. */
  overspent: boolean;
  /** Derived: active, recurring, and currently below target (a refresh would top it up). */
  underfunded: boolean;
}

/** The allowances-screen aggregate (mirrors Rust `AllowanceSummary`, from `listAllowances`/
 *  `getAllowanceSummary`). `totalMinor` is the base-currency savings total as of today (NEVER
 *  stored - ADR 0012); `reservedMinor`/`availableMinor` derive from it and the allowance list.
 *  `excludedAllowances` counts active allowances in a currency other than `baseCurrency` (defensive
 *  - allowances are base-currency only at creation - mirrors `DashboardData.excludedAccounts`). */
export interface AllowanceSummary {
  allowances: Allowance[];
  totalMinor: number;
  reservedMinor: number;
  availableMinor: number;
  /** Sum of `targetMinor` over ACTIVE, base-currency allowances - the period's total allowance. */
  targetTotalMinor: number;
  /** How much of `targetTotalMinor` has been spent. May EXCEED it when an allowance is overspent;
   *  floored at 0. Derived in Rust - never recompute it in TS. */
  usedMinor: number;
  baseCurrency: Iso4217;
  excludedAllowances: number;
}

/** Input for create_allowance (mirrors Rust `NewAllowance`). `target` is a non-negative major-unit
 *  string (e.g. "1500.00"); Rust parses it to minor units and gates the initial full-target
 *  allocation against Available (all-or-nothing). `currency` must equal the vault's base currency. */
export interface NewAllowance {
  name: string;
  target: string;
  currency: Iso4217;
  kind: AllowanceKind;
  /** Required for `'recurring'`, omitted for `'one_time'`. */
  period?: AllowancePeriod | null;
  /** ISO weekday (Mon=1..Sun=7); required for a `'weekly'` period, omitted otherwise. */
  weekStart?: number | null;
}

/** Input for update_allowance (mirrors Rust `UpdateAllowance`). Currency, kind, period, and
 *  weekStart are fixed at creation - delete and recreate to change them. A target increase or a
 *  resume (`active: false -> true`) is gated all-or-nothing against Available; a decrease or a
 *  pause is never gated. */
export interface UpdateAllowance {
  id: number;
  name: string;
  target: string;
  active: boolean;
}

// ── Bank-file import (FR-2.2, mirrors import:: / db::imports / commands::import) ──

/** Supported bank-file formats (mirrors Rust `import::ImportFormat`). All three are wired
 *  end-to-end (`docs/adr/0011-ofx-import-wiring.md`). */
export type ImportFormat = 'csv' | 'ofx' | 'qfx';

/** Header row + a few sample data rows for the column-mapping step (mirrors Rust
 *  `commands::import::ImportHeaders`). */
export interface ImportHeaders {
  headers: string[];
  sampleRows: string[][];
}

/** Which source column (0-based index into `ImportHeaders.headers`) feeds each target field
 *  (mirrors Rust `commands::import::ColumnMappingInput`). `date`/`amount` are required; the rest
 *  are optional - omit (or pass `null`) a column that has no source in the file. */
export interface ColumnMappingInput {
  date: number;
  amount: number;
  payee?: number | null;
  note?: number | null;
  sourceRef?: number | null;
}

/** A data row that failed to parse - reported to the user, never silently dropped (mirrors Rust
 *  `import::csv::RowError`). `row` is the stable 0-based data-row index (excludes the header row);
 *  it is the same index `preview`/`commit` use for `ImportCommitInput.skipRows`. */
export interface RowError {
  row: number;
  message: string;
}

/** Input for `importPreview` (mirrors Rust `commands::import::ImportPreviewInput`). `mapping` is
 *  required for `'csv'` (the file's column layout is not self-describing) and omitted for
 *  `'ofx'`/`'qfx'` (the file already names its own fields). */
export interface ImportPreviewInput {
  path: string;
  format: ImportFormat;
  accountId: number;
  mapping?: ColumnMappingInput;
}

/**
 * One parsed row annotated for the review screen (mirrors Rust `db::imports::PreviewRow`).
 * `amountMinor` is the file's SIGNED amount (sign comes from the data, NOT a category kind - the
 * one place imports differ from manual entry, see `docs/adr/0010-csv-import-model.md`).
 * `suggestedCategory` is always the ACTUAL category NAME `importCommit` will store (a fired rule's
 * category when it names an existing, sign-matching category, else the sign-correct
 * "Uncategorized"/"Uncategorized income" fallback) - never stale rule text, and preview always
 * agrees with commit. `suggestedCategoryReason` is the deterministic reason (e.g. "matched rule:
 * merchant contains 'winners'"), `null` when it is the Uncategorized fallback. `duplicate` is
 * advisory only (FR-2.4 never deletes) - the reviewing step lets the user keep or skip each row;
 * `duplicateReason` names the matched row's date (e.g. "same amount as a transaction on
 * 2026-06-01"), `null` when not a duplicate.
 */
export interface PreviewRow {
  row: number;
  postedDate: string;
  amountMinor: number;
  currency: Iso4217;
  payee: string | null;
  note: string | null;
  sourceRef: string | null;
  suggestedCategory: string;
  suggestedCategoryReason: string | null;
  duplicate: boolean;
  duplicateReason: string | null;
}

/** Result of `importPreview` (mirrors Rust `db::imports::ImportPreviewData`). Nothing is written -
 *  the user reviews and confirms before `importCommit`. `errors` holds only genuinely-malformed
 *  rows (bad date, unparsable amount, ...); `currencyMismatches` is a SEPARATE, non-error list of
 *  rows that were read fine but deliberately excluded because their OWN currency differs from the
 *  account's (OFX/QFX only - imports carry no fx rate yet). Never conflate the two: a currency
 *  mismatch is not "could not be read". */
export interface ImportPreviewData {
  rows: PreviewRow[];
  errors: RowError[];
  currencyMismatches: RowError[];
  duplicateCount: number;
  currency: Iso4217;
}

/** Input for `importCommit` (mirrors Rust `commands::import::ImportCommitInput`). `skipRows` are
 *  the 0-based row ordinals the user chose not to import (e.g. a flagged duplicate) - a data-row
 *  index for CSV, a transaction-block index for OFX/QFX. `mapping` is required for `'csv'`, omitted
 *  for `'ofx'`/`'qfx'`. */
export interface ImportCommitInput {
  path: string;
  format: ImportFormat;
  accountId: number;
  mapping?: ColumnMappingInput;
  skipRows: number[];
}

/** Result of committing an import (mirrors Rust `db::imports::ImportResultData`). `malformed`
 *  counts only genuinely-malformed rows; `currencySkipped` (always 0 for CSV) counts rows excluded
 *  solely for a currency mismatch - see `ImportPreviewData`. */
export interface ImportResultData {
  inserted: number;
  skipped: number;
  malformed: number;
  currencySkipped: number;
}

// ── Budgets / envelopes (FR-3.1) ──────────────────────────────────────────────────

/** v1 supports monthly budgets only. Mirrors Rust `domain::budget::MONTHLY_PERIOD`. */
export type BudgetPeriod = 'monthly';

/** A cap on spend for one category in one period - the raw row (mirrors Rust `Budget`). Used to
 *  preload the edit form. */
export interface Budget {
  id: number;
  categoryId: number;
  period: BudgetPeriod;
  capMinor: number;
}

/** Where an envelope sits against its cap (mirrors Rust `EnvelopeStatus`). NEVER render this by
 *  colour alone - always pair with an icon + a plain-language label. */
export type EnvelopeStatus = 'under' | 'approaching' | 'over';

/** One envelope's spend-vs-cap for the current period (mirrors Rust `EnvelopeSummary`) - the
 *  budgets-screen read model returned by `list_envelopes`. `spentMinor` is always a positive
 *  "money out" figure; `remainingMinor` goes negative once over budget. `id` is the underlying
 *  `budgets` row id, so the UI can route to `/budgets/:id/edit`. */
export interface EnvelopeSummary {
  id: number;
  categoryId: number;
  categoryName: string;
  period: BudgetPeriod;
  capMinor: number;
  spentMinor: number;
  remainingMinor: number;
  /** The base (reporting) currency both `capMinor` and `spentMinor` are expressed in. */
  currency: Iso4217;
  status: EnvelopeStatus;
}

/** Input for create_budget (mirrors Rust `NewBudget`). `cap` is a non-negative major-unit string
 *  (e.g. "100.00"), in the vault's base currency; Rust parses it to minor units (no money math in
 *  TS - mirrors `NewGoal.target`). */
export interface NewBudget {
  categoryId: number;
  period: BudgetPeriod;
  cap: string;
}

/** Input for update_budget (mirrors Rust `UpdateBudget`). Category and period are not editable in
 *  v1 - delete and recreate instead. */
export interface UpdateBudget {
  id: number;
  cap: string;
}

// ── Reporting (FR-3.3, mirror domain::report) ────────────────────────────────────

/** Analytics period preset (mirrors Rust `ReportPeriod`). Drives the period filter. */
export type ReportPeriod = 'thisMonth' | 'last3Months' | 'thisYear' | 'allTime';

/** Spend-over-time bucket size (mirrors Rust `Granularity`), chosen by Rust from the period span. */
export type Granularity = 'day' | 'week' | 'month';

/** Total spend for one expense category over the report period (mirrors Rust `CategorySpend`). */
export interface CategorySpend {
  categoryId: number;
  categoryName: string;
  amountMinor: number;
}

/**
 * Total spend for one time bucket (mirrors Rust `TimeBucket`). `label` is a short Rust-formatted
 * display string (e.g. "13 Jul", "Wk of 07 Jul", "Jul 2026") - never re-derive date formatting in
 * TS. `startDate` is the bucket's first day in ISO `YYYY-MM-DD`.
 */
export interface TimeBucket {
  label: string;
  startDate: string;
  amountMinor: number;
}

/**
 * The Analytics report (mirrors Rust `ReportData`, from `get_report`). `byCategory` feeds the pie
 * chart, `overTime` the line chart; `totalSpendMinor` is the sum of `byCategory` in
 * `baseCurrency` (the vault's reporting currency, not necessarily every transaction's own
 * currency). EXPENSE splits only; income/transfers and `pendingReview` transactions never appear.
 */
export interface ReportData {
  baseCurrency: Iso4217;
  period: ReportPeriod;
  totalSpendMinor: number;
  byCategory: CategorySpend[];
  overTime: TimeBucket[];
  granularity: Granularity;
}

// ── Home dashboard (issue #50, mirror domain::dashboard) ─────────────────────────

/**
 * One point on the trailing balance-trend chart (mirrors Rust `BalancePoint`): a short
 * Rust-formatted month label (e.g. "Jul") and the TOTAL balance (never usable balance - goals have
 * no history table, so only total balance is exactly reconstructable) as of that month's end.
 */
export interface BalancePoint {
  label: string;
  amountMinor: number;
}

/**
 * The Home dashboard aggregate (mirrors Rust `DashboardData`, from `get_dashboard`). All money is
 * integer minor units in `baseCurrency`. `usableBalanceMinor` MAY be negative (over-committed to
 * goals) - never clamp it. `excludedAccounts`/`excludedGoals` count non-archived accounts / ongoing
 * goals in a currency other than `baseCurrency` (their openings/reservations can't be honestly
 * converted, so they are left out of the totals) - the UI shows a caveat note when either is > 0.
 */
export interface DashboardData {
  baseCurrency: Iso4217;
  totalBalanceMinor: number;
  usableBalanceMinor: number;
  /** The amount netted out of totalBalanceMinor to reach usableBalanceMinor ("set aside for goals"). */
  goalsReservedMinor: number;
  thisMonthSpendMinor: number;
  /** Trailing 6 months, oldest first, last point = the current month. */
  balanceTrend: BalancePoint[];
  /** Top few ongoing goals for the Home preview. */
  goals: Goal[];
  excludedAccounts: number;
  excludedGoals: number;
  /** True when there is nothing to show yet - drives the Home teaching-empty state. */
  isEmpty: boolean;
}

// ── Export (FR-4.2, mirrors Rust `export::ExportFormat` / `commands::export::ExportSummary`) ────
// Desktop-first slice: the frontend picks a destination via the save dialog (`core/bridge`) and
// hands the path to `export_transactions`; Android's SAF-backed save is a separate change (the
// export screen shows an info banner on Android instead of calling this command).

/** Which file format to export to. The UI only ever offers `'csv'` / `'xlsx'`. */
export type ExportFormat = 'csv' | 'xlsx' | 'json';

/** Result of a successful export (mirrors Rust `ExportSummary`). */
export interface ExportSummary {
  path: string;
  format: ExportFormat;
  rowCount: number;
  byteLen: number;
}

// ── Backup (FR-4.1, mirrors Rust `commands::backup::BackupSummary`) ──────────────────────────────
// Desktop-first slice (mirrors Export above): the frontend picks a destination via the save dialog
// (`core/bridge`) and hands the path to `create_backup`; Android's SAF-backed save is a separate
// change (the backup screen shows an info banner on Android instead of calling this command).
// The `.vaultbak` FILE FORMAT itself (Rust `backup::VaultBackup`) never crosses IPC, so it has no
// TS mirror (listed in `DTO_SKIP`, `scripts/guards.mjs`) - its `baseCurrency` field lives only in
// the file, never in an IPC DTO.

/** Result of a successful encrypted backup (mirrors Rust `commands::backup::BackupSummary`). */
export interface BackupSummary {
  path: string;
  byteLen: number;
  formatVersion: number;
}

// ── Restore (FR-4.3, mirrors Rust `commands::backup::RestoreSummary` / `RestoreMode`) ────────────
// Desktop-first, REPLACE mode only (ADR 0008) - merge and Android's SAF file-pick are a deferred
// follow-up. The frontend picks the `.vaultbak` file via the open dialog (`core/bridge`) and hands
// its path + the backup's own passphrase to `restore_backup`.

/** How to reconcile a restore with existing local data. `'merge'` is a deferred follow-up - the UI
 *  only ever sends `'replace'` (mirrors Rust `commands::backup::RestoreMode`). */
export type RestoreMode = 'replace';

/** Result of a successful restore (mirrors Rust `commands::backup::RestoreSummary`). */
export interface RestoreSummary {
  formatVersion: number;
  /** The RESTORED backup's own creation timestamp (when the source vault was snapshotted). */
  createdAt: string;
  transactionCount: number;
  /** The ADOPTED base (reporting) currency, trimmed + uppercased Rust-side - every report now
   *  adds up in this currency, not necessarily the one the app used before the restore. */
  baseCurrency: string;
}

// Errors (IPC rejections) ----------------------------------------------------------

/** Discriminant of an `AppError` (mirrors Rust `error::AppError`, adjacently tagged on `kind`). */
export type AppErrorKind =
  | 'locked'
  | 'keyVerificationFailed'
  | 'validation'
  | 'database'
  | 'internal';

/**
 * The rejection payload of every bridge `invoke<T>()` call (mirrors Rust `AppError`). Switch on
 * `kind`; `message` is present on the data-carrying kinds. Narrow an unknown rejection with
 * `asAppError`.
 */
export type AppError =
  | { kind: 'locked' }
  | { kind: 'keyVerificationFailed' }
  | { kind: 'validation'; message: string }
  | { kind: 'database'; message: string }
  | { kind: 'internal'; message: string };

/** Narrow an unknown `invoke` rejection (rejections arrive as `unknown`) to a typed `AppError`. */
export function asAppError(e: unknown): AppError {
  if (e && typeof e === 'object' && 'kind' in e) {
    const kind = (e as { kind: unknown }).kind;
    if (kind === 'locked' || kind === 'keyVerificationFailed') {
      return { kind };
    }
    if (kind === 'validation' || kind === 'database' || kind === 'internal') {
      const raw = (e as { message?: unknown }).message;
      return { kind, message: typeof raw === 'string' ? raw : '' };
    }
  }
  return { kind: 'internal', message: typeof e === 'string' ? e : '' };
}
