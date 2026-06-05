-- Migration 0001 — initial schema (architecture.md §4.1).
-- Forward-only. Money is ALWAYS integer minor units (*_minor); never REAL/float.
-- The runner wraps this file + the schema_migrations insert in ONE transaction.

CREATE TABLE accounts (
  id                    INTEGER PRIMARY KEY,
  name                  TEXT    NOT NULL,
  type                  TEXT    NOT NULL,
  currency              TEXT    NOT NULL,
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  archived              INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE categories (
  id        INTEGER PRIMARY KEY,
  name      TEXT    NOT NULL,
  parent_id INTEGER REFERENCES categories(id),
  kind      TEXT    NOT NULL CHECK (kind IN ('expense', 'income', 'transfer'))
);

CREATE TABLE transactions (
  id                INTEGER PRIMARY KEY,
  account_id        INTEGER NOT NULL REFERENCES accounts(id),
  posted_date       TEXT    NOT NULL,
  amount_minor      INTEGER NOT NULL,
  currency          TEXT    NOT NULL,
  fx_rate           TEXT    NOT NULL DEFAULT '1',          -- decimal stored as text (never float)
  base_amount_minor INTEGER NOT NULL,                      -- round(amount_minor * fx_rate)
  payee             TEXT,
  note              TEXT,
  source            TEXT    NOT NULL CHECK (source IN ('manual', 'ocr', 'import')),
  source_ref        TEXT,
  pending_review    INTEGER NOT NULL DEFAULT 0,            -- dedup flag (FR-2.4); never auto-deleted
  created_at        TEXT    NOT NULL
);
CREATE INDEX idx_transactions_account_date ON transactions(account_id, posted_date);
CREATE INDEX idx_transactions_pending_review ON transactions(pending_review);

CREATE TABLE tx_splits (
  id             INTEGER PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id    INTEGER NOT NULL REFERENCES categories(id),
  amount_minor   INTEGER NOT NULL                          -- sum == parent amount (enforced in Rust)
);
CREATE INDEX idx_tx_splits_transaction ON tx_splits(transaction_id);

CREATE TABLE recurring_rules (
  id                     INTEGER PRIMARY KEY,
  template_json          TEXT    NOT NULL,
  schedule               TEXT    NOT NULL,
  next_run_date          TEXT    NOT NULL,
  last_materialised_date TEXT,
  active                 INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE budgets (
  id          INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  period      TEXT    NOT NULL,
  cap_minor   INTEGER NOT NULL
);

CREATE TABLE goals (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  target_minor  INTEGER NOT NULL,
  current_minor INTEGER NOT NULL DEFAULT 0,
  target_date   TEXT
);

CREATE TABLE import_rules (
  id          INTEGER PRIMARY KEY,
  ordinal     INTEGER NOT NULL,
  match_field TEXT    NOT NULL,
  match_op    TEXT    NOT NULL,
  match_value TEXT    NOT NULL,
  set_field   TEXT    NOT NULL,
  set_value   TEXT    NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_import_rules_ordinal ON import_rules(ordinal);

CREATE TABLE imports (
  id          INTEGER PRIMARY KEY,
  filename    TEXT    NOT NULL,
  format      TEXT    NOT NULL,
  imported_at TEXT    NOT NULL,
  row_count   INTEGER NOT NULL
);
