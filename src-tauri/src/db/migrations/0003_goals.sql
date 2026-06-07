-- Migration 0003 — savings goals currency (FR-3.2). The `goals` table already exists from 0001
-- (id, name, target_minor, current_minor, target_date); savings goals are now user-managed, so
-- add a per-goal currency for display/parsing. Forward-only, additive ALTER (safe on bundled
-- SQLCipher); existing rows default to MUR. Runner wraps this in one transaction.

ALTER TABLE goals ADD COLUMN currency TEXT NOT NULL DEFAULT 'MUR';
