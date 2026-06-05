-- Migration 0002 — add `archived` to categories (FR: archive never deletes; hide from pickers).
-- Forward DDL only; the runner records the version inside one transaction.

ALTER TABLE categories ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_categories_archived ON categories(archived);
