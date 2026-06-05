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
