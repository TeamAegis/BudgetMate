---
name: db-migration
description: Create and apply a safe, forward-only, versioned SQLCipher schema migration for Vault. Use whenever the database schema must change - adding or altering tables/columns/indexes - so changes stay transactional, recorded in schema_migrations, and never break encryption or existing data.
---

# Database migrations (SQLCipher)

Vault uses SQLite encrypted with SQLCipher (bundled `rusqlite` 0.37 with the
`bundled-sqlcipher-vendored-openssl` feature — **not** `tauri-plugin-sql`). Migrations are
forward-only and versioned.

## This project's mechanism (concrete)
Implemented in [`src-tauri/src/db/mod.rs`](../../../src-tauri/src/db/mod.rs):
- Each migration is a SQL file in `src-tauri/src/db/migrations/NNNN_description.sql`, embedded at
  compile time via `include_str!` and listed in the ordered `MIGRATIONS` const:
  ```rust
  const MIGRATIONS: &[(i64, &str)] = &[
      (1, include_str!("migrations/0001_init.sql")),
      // (2, include_str!("migrations/0002_xxx.sql")),  // add new ones here
  ];
  ```
- `run_migrations(conn, now_iso)` creates `schema_migrations` if needed, reads
  `MAX(version)`, and applies every higher migration — each inside its **own** transaction
  together with its `INSERT INTO schema_migrations(version, applied_at)`. It runs at startup
  **after** `open_encrypted` sets `PRAGMA key`.
- The SQL file contains **only** the forward DDL — the runner records the version; do **not** put
  the `schema_migrations` insert or `BEGIN/COMMIT` in the `.sql` file.

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
1. Pick the next version `N` (max existing + 1; `0001_init.sql` is the baseline).
2. Create `src-tauri/src/db/migrations/000N_description.sql` with **forward DDL only**. For column
   changes SQLite can't do in place, use create-new-table → copy → drop-old → rename (the runner
   wraps the whole file in one transaction).
3. Add `(N, include_str!("migrations/000N_description.sql"))` to the `MIGRATIONS` const in
   `db/mod.rs` (the runner does the `schema_migrations` insert + transaction).
4. If a DTO is affected, update the Rust struct **and** its `src/app/core/models` mirror (same change).
5. Test (pattern: see `db::tests` in `db/mod.rs`): a fresh in-memory DB applies all migrations and
   is idempotent on re-run; extend `encrypted_roundtrip_and_wrong_key_rejected` if the change
   affects the encrypted on-disk path. Confirm the encrypted DB still opens with the key.

## Checklist before committing
- [ ] Version is new and higher than all existing.
- [ ] Whole migration + version record is one transaction.
- [ ] No shipped migration was edited.
- [ ] No float money columns introduced.
- [ ] Invariants preserved; indexes added for new query paths.
- [ ] DTO ↔ TS model updated if shape changed.
- [ ] Fresh-install and upgrade paths both tested; DB still decrypts.
