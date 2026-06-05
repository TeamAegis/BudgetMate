---
name: db-migration
description: Create and apply a safe, forward-only, versioned SQLCipher schema migration for Vault. Use whenever the database schema must change - adding or altering tables/columns/indexes - so changes stay transactional, recorded in schema_migrations, and never break encryption or existing data.
---

# Database migrations (SQLCipher)

Vault uses SQLite encrypted with SQLCipher (bundled, via `rusqlite`/`sqlx` — **not**
`tauri-plugin-sql`). Migrations are forward-only and versioned.

## Rules
- **Never edit a migration that has shipped.** Always add a new, higher-versioned migration.
- Each migration is **idempotent-safe to record**: wrap the schema change + the
  `schema_migrations` insert in **one transaction**, so a crash can't leave a half-applied
  version.
- Migrations run at startup, in version order, after the SQLCipher key is set (`PRAGMA key`).
- Money columns are integer minor units (`*_minor`). Never add REAL/float money columns.
- Preserve invariants: split sums, `base_amount_minor` derivation, idempotent recurrence,
  dedup `pending_review` flag.

## Recipe
1. Pick the next version number `N` (max existing + 1).
2. Add the migration (e.g. `db/migrations/NNNN_description.sql` or a Rust migration entry,
   matching the project's chosen mechanism).
3. Write forward DDL. For column changes SQLite can't do in place, use the
   create-new-table → copy → drop-old → rename pattern, all inside the transaction.
4. Record `INSERT INTO schema_migrations(version, applied_at) VALUES (N, <now>)` in the **same
   transaction**.
5. If a DTO is affected, update the Rust struct **and** its `src/app/core/models` mirror.
6. Test: run on a fresh DB (all migrations from zero) **and** on a DB seeded at version N-1
   (upgrade path). Confirm the encrypted DB still opens with the key afterwards.

## Checklist before committing
- [ ] Version is new and higher than all existing.
- [ ] Whole migration + version record is one transaction.
- [ ] No shipped migration was edited.
- [ ] No float money columns introduced.
- [ ] Invariants preserved; indexes added for new query paths.
- [ ] DTO ↔ TS model updated if shape changed.
- [ ] Fresh-install and upgrade paths both tested; DB still decrypts.
