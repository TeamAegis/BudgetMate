// TypeScript mirrors of Rust DTOs (serde structs) crossing the Tauri IPC boundary.
// MUST stay 1:1 with the Rust structs in src-tauri/src/. When a Rust DTO changes, update the
// matching interface here in the SAME change (CLAUDE.md / new-feature skill).
//
// Money is always integer MINOR UNITS (e.g. cents) + a currency code. Never a float, and never
// do money arithmetic in TypeScript — format only.

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
 * positive) and is computed in Rust — never derive or re-sign it in TS. Categorisation is via
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
}

/** Result of previewing the active rules over sample fields (mirrors Rust `RulePreview`). */
export interface RulePreview {
  merchant: string | null;
  category: string | null;
  account: string | null;
  applied: AppliedRule[];
}

/** Sample fields to preview rules against (mirrors Rust `PreviewInput`). */
export interface RulePreviewInput {
  merchant?: string | null;
  category?: string | null;
  account?: string | null;
}
