-- Migration 0006: account-to-account transfers.
--
-- A transfer is NOT a new entity: it is a linked PAIR of ordinary transactions (money out of the
-- source account, money in to the destination) sharing a `transfer_group_id`. Modelling it this way
-- means every existing reader stays correct for free - per-account balances, the ledger list, the
-- balance trend, and export all read `transactions`, and a dedicated `transfers` table would have
-- forced each of them to learn about a second source of money movement.
--
-- Both legs carry a `kind = 'transfer'` category, and every spend query already filters
-- `categories.kind = 'expense'` (db::reports, db::budgets), so a transfer automatically stays out of
-- spend totals, budgets/envelopes, and the dashboard's this-month figure. That was the reason the
-- 'transfer' kind was in the schema CHECK from 0001 (see docs/architecture.md).
--
-- v1 is SAME-CURRENCY only (validated in Rust): both legs then carry equal and opposite
-- `base_amount_minor`, so a transfer provably cannot move the vault's total balance. Cross-currency
-- would need a user-entered rate and would let rounding on each leg drift that total.
--
-- Forward DDL only; the runner wraps this file + the schema_migrations insert in ONE transaction.

ALTER TABLE transactions ADD COLUMN transfer_group_id TEXT;
CREATE INDEX idx_transactions_transfer_group ON transactions(transfer_group_id);

-- The 'transfer'-kind category both legs are filed under is seeded by `db::seed_defaults`, NOT here.
-- Migrations run before seeding on a fresh vault, so inserting it here would claim category id 1 and
-- shift every default category's id (Groceries 1 -> 2, Salary 9 -> 10, ...). Ids are referenced by
-- existing rows and by tests, so seeding it last keeps them stable; seed_defaults runs on every open,
-- which is what gets the category into already-created vaults too.
