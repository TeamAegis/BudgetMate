-- Migration 0005: savings-backed allowances (FR-3.4, docs/allowances.md, ADR 0005/0012).
-- `balance_minor` is STORED (not derived) because a set-to-target refresh is non-invertible from
-- the ledger alone. `target_minor`/`balance_minor` are integer minor units in `currency`, which
-- must equal the vault's base currency at creation time (validated in Rust, not enforced here -
-- SQLite has no cross-table CHECK). `period`/`week_start` are NULL for a one-time allowance;
-- `next_refresh_date` is NULL for one-time (never refreshes) and is advanced by
-- `db::allowances::refresh_due` on app open (no background scheduler, NFR-Perf3).
-- Forward DDL only; the runner wraps this file + the schema_migrations insert in ONE transaction.

CREATE TABLE allowances (
  id                 INTEGER PRIMARY KEY,
  name               TEXT    NOT NULL,
  currency           TEXT    NOT NULL,
  target_minor       INTEGER NOT NULL,
  balance_minor      INTEGER NOT NULL,
  kind               TEXT    NOT NULL CHECK (kind IN ('recurring', 'one_time')),
  period             TEXT    CHECK (period IN ('weekly', 'monthly')), -- NULL for one_time
  week_start         INTEGER,                                        -- ISO weekday 1-7 (Mon=1); NULL unless weekly
  next_refresh_date  TEXT,                                           -- YYYY-MM-DD; NULL for one_time
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT    NOT NULL
);

-- Optional per-transaction allowance tag (FR-3.4). Deleting the allowance detaches the tag rather
-- than touching ledger history (`db::allowances::delete` / `db::transactions`).
ALTER TABLE transactions ADD COLUMN allowance_id INTEGER REFERENCES allowances(id) ON DELETE SET NULL;
CREATE INDEX idx_transactions_allowance ON transactions(allowance_id);
