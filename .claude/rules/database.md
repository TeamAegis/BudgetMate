# Rules - Database (`src-tauri/src/db/`)

SQLite encrypted with SQLCipher. Read alongside `.claude/rules/rust.md`.

## Engine
- **SQLCipher, compiled into the binary** via `rusqlite` with the `sqlcipher` feature, or
  `sqlx` + `libsqlite3-sys` with `bundled-sqlcipher`. **Either driver is fine - do not mandate
  one.** Do **not** use the official `tauri-plugin-sql` - it still has no SQLCipher support
  (encryption is tracked upstream but unmerged; don't rely on it).
- A C toolchain is required at build time for `aarch64-apple-ios` and `aarch64-linux-android`.
  Keep the bundled-SQLCipher build flags in the build config; don't switch to a system SQLite.
- **Android:** use the `bundled-sqlcipher-vendored-openssl` feature (compiles OpenSSL from source
  for the NDK target) - OpenSSL cross-compilation is the #1 Android SQLCipher blocker. Expose both
  features and select per platform. The bundled `libsqlcipher.so` must meet 16KB page alignment -
  build with NDK r28+ / AGP 8.5.1+ (see `.claude/rules/android.md`).
- If using `sqlx`, the `sqlx 0.8.x` ↔ `libsqlite3-sys 0.30.1` pairing is brittle (sqlx pins a
  range internally) - confirm the exact pair before pinning.

## Opening the DB
1. Resolve the DB path in the app sandbox.
2. Open the connection.
3. Set the key **first, before any other statement or PRAGMA**: `PRAGMA key = '<derived-key>'`
   (key comes from `crypto/`, never hardcoded, never logged). With `sqlx`, set it via the
   connect-options `.pragma("key", …)` so it's guaranteed first.
4. **Validate by reading** - e.g. `SELECT count(*) FROM sqlite_master`. SQLCipher does
   just-in-time key derivation: a wrong key does **not** error on `PRAGMA key` itself, only on the
   first read/write. A failed read means wrong passphrase / corruption.

## Transactions (ACID - mandatory)
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
Columns store integer **minor units** (`*_minor`). Never store money as REAL/float. (Rationale and
MUR conventions: `docs/financial-knowledge.md` §1, §8.) The canonical expense **category taxonomy**
seeded/modelled here is `docs/financial-knowledge.md` §2.

## Migrations
- Use the `db-migration` skill (`.claude/skills/db-migration/`) for any schema change.
- Migrations are forward-only, versioned, recorded in `schema_migrations`, and run inside a
  transaction. Never edit a shipped migration - add a new one.

## Backups
- The SQLCipher file is already encrypted at rest; a backup can copy that file (or an
  encrypted JSON dump) to a user-chosen location via the save dialog. Restore validates and
  applies inside a transaction.
