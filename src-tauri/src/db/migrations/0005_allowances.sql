-- Migration 0005 — allowances (imprest reservation engine, FR-3.4). ADR 0012 pins the model: an
-- allowance stores a refresh ANCHOR (anchor_balance_minor + last_refresh_date), never a live
-- balance - the current balance is DERIVED on read from anchor_balance_minor plus tagged,
-- confirmed, not-future-dated transactions posted since last_refresh_date (see
-- db::allowances::derived_balance). Money stays integer minor units throughout. Forward DDL only;
-- the runner wraps this file + the schema_migrations insert in ONE transaction.

CREATE TABLE allowances (
  id                   INTEGER PRIMARY KEY,
  name                 TEXT    NOT NULL,
  currency             TEXT    NOT NULL,                  -- must equal the vault's base currency (ADR 0012 decision 4)
  target_minor         INTEGER NOT NULL,
  anchor_balance_minor INTEGER NOT NULL,                   -- balance as of last_refresh_date (set at allocation/refresh/resume)
  kind                 TEXT    NOT NULL CHECK (kind IN ('recurring', 'one_time')),
  period               TEXT    CHECK (period IN ('weekly', 'monthly')),  -- NULL for one_time
  week_start           TEXT    NOT NULL DEFAULT 'monday',  -- ISO-8601 week start for weekly refresh boundaries
  last_refresh_date    TEXT    NOT NULL,                   -- the anchor's "as of" date
  next_refresh_date    TEXT,                                -- NULL for one_time; next due calendar boundary
  active               INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT    NOT NULL,
  CHECK (
    (kind = 'recurring' AND period IS NOT NULL AND next_refresh_date IS NOT NULL) OR
    (kind = 'one_time'  AND period IS NULL     AND next_refresh_date IS NULL)
  )
);

-- transactions.allowance_id: an optional tag (FR-3.4) linking a transaction to an allowance for the
-- derived-balance draw-down. Deliberately a PLAIN nullable INTEGER with NO enforced foreign key
-- (no REFERENCES clause): deleting an allowance (FR-3.4 delete, docs/allowances.md §11) must leave
-- tagged historical transactions' allowance_id DANGLING (pointing at an id that no longer exists)
-- so the tag survives for reporting, rather than being nulled (ON DELETE SET NULL, which would
-- lose the link) or the delete being blocked outright. With PRAGMA foreign_keys = ON (set on every
-- connection - db::open_encrypted) a real "REFERENCES allowances(id)" clause and no ON DELETE
-- action is NO ACTION/RESTRICT: SQLite refuses to delete a still-referenced parent row (verified
-- empirically) - the opposite of the required behaviour. Tagging itself only ever sets this
-- column; it never mutates an allowances row (ADR 0012 decision 3).
ALTER TABLE transactions ADD COLUMN allowance_id INTEGER;
CREATE INDEX idx_transactions_allowance ON transactions(allowance_id, posted_date);
