-- Migration 0004 — one cap per category per period (FR-3.1 envelope budgeting). The `budgets`
-- table already exists from 0001 (id, category_id, period, cap_minor); no seed rows reference it
-- yet, so the unique index is safe to add outright. Forward DDL only; the runner records the
-- version inside one transaction.

CREATE UNIQUE INDEX idx_budgets_category_period ON budgets(category_id, period);
