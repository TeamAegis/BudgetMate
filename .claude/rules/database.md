# Rules — Database (`src-tauri/src/db/`)

SQLite encrypted with SQLCipher. Read alongside `.claude/rules/rust.md`.

## Engine
- **SQLCipher, compiled into the binary** via `rusqlite` with the `sqlcipher` feature, or
  `sqlx` + `libsqlite3-sys` with `bundled-sqlcipher`. Do **not** use the official
  `tauri-plugin-sql` — it has no SQLCipher support.
- A C toolchain is required at build time for `aarch64-apple-ios` and `aarch64-linux-android`.
  Keep the bundled-SQLCipher build flags in the build config; don't switch to a system SQLite.

## Opening the DB
1. Resolve the DB path in the app sandbox.
2. Open the connection.
3. Set the key first thing: `PRAGMA key = '<derived-key>'` (key comes from `crypto/`, never
   hardcoded, never logged).
4. Verify with a cheap read; if it fails, treat as wrong passphrase / corruption.

## Transactions (ACID — mandatory)
- Any operation that writes more than one row or more than one table runs inside a single
  transaction: split inserts, import batches, recurrence materialisation, restore.
- Use the connection's transaction API and commit only after all invariants pass; otherwise
  roll back. A force-close mid-operation must leave the DB consistent.

## Invariants enforced at the DB layer
- Split amounts sum exactly to the parent transaction amount (reject otherwise).
- `base_amount_minor` recomputed from `amount_minor * fx_rate` on insert/update.
- Recurrence materialisation is idempotent (no double-insert for the same rule + occurrence
  date).
- Dedup sets a `pending_review` flag; it never deletes rows.

## Money
Columns store integer **minor units** (`*_minor`). Never store money as REAL/float.

## Migrations
- Use the `db-migration` skill (`.claude/skills/db-migration/`) for any schema change.
- Migrations are forward-only, versioned, recorded in `schema_migrations`, and run inside a
  transaction. Never edit a shipped migration — add a new one.

## Backups
- The SQLCipher file is already encrypted at rest; a backup can copy that file (or an
  encrypted JSON dump) to a user-chosen location via the save dialog. Restore validates and
  applies inside a transaction.
