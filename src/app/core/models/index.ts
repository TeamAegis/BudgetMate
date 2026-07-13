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
  splits: TxSplit[];
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
