# 0007 - Encrypted local backup: JSON envelope, desktop-first save, restore deferred

Status: Accepted (2026-07-14)

## Context

FR-4.1 asks for an encrypted local backup of the whole vault to a user-chosen `.vaultbak` file. Two
things make this different from a bare file copy:

- The SQLCipher database file is already encrypted at rest, but the salt and the frozen Argon2id
  `KdfParams` needed to re-derive the key from the user's passphrase live in a separate, unencrypted
  sidecar (`vault-meta.json`), not inside the DB file itself (`vault::VaultMeta` doc comment). A bare
  copy of `budgetmate.db` is therefore not restore-portable on its own - the bootstrap material has
  to travel with it.
- Producing a *consistent* snapshot of an encrypted SQLite file without touching the in-memory key
  has two easy-to-reach-for but wrong tools: `VACUUM INTO` and rusqlite's online-backup API. Both
  write a **plaintext** SQLite file unless the destination connection is opened with the same
  SQLCipher key - exactly the kind of accidental plaintext-financial-data leak the product's hard
  rules forbid.

This mirrors the shape of `docs/adr/0006-export-desktop-first-android-saf-deferred.md`: split a
desktop-verifiable slice from an Android SAF slice that needs a device to prove, and be explicit
about what is and is not implemented.

## Decision

1. **The `.vaultbak` container is a JSON envelope, `formatVersion` 1** (`backup::VaultBackup`,
   `#[serde(rename_all = "camelCase")]`), bundling: `createdAt`, an informational `app` string,
   `metaVersion` (copied from `VaultMeta`), the non-secret `salt` and `kdf` (`KdfParams`), and the
   `db` bytes - the SQLCipher-encrypted `budgetmate.db`, verbatim. **No plaintext financial data is
   ever written**; `db` stays encrypted end to end. `salt` and `db` are base64-encoded via a small
   `#[serde(with = "b64_bytes")]` adapter rather than serde_json's default numeric-array encoding,
   which would bloat a multi-MB database roughly 3-4x. `VaultBackup` is a **file format, not an IPC
   DTO** - it never crosses `invoke()`, so it is listed in `DTO_SKIP` (`scripts/guards.mjs`) rather
   than mirrored in `core/models`.
2. **The snapshot is a copy of the already-encrypted DB bytes - no key access is needed.** The
   `create_backup` command takes the `DbState` mutex guard, runs a defensive
   `PRAGMA wal_checkpoint(TRUNCATE)` on the open connection (a no-op in the default DELETE journal
   mode, but robust if that ever changes), and reads `budgetmate.db` off disk **while still holding
   the guard** - the same "read under the lock" shape `commands::export` uses for consistency
   without a transaction. The guard is dropped before the blocking base64/JSON/`std::fs::write` work
   in `spawn_blocking`, so a `std::sync::Mutex` guard is never held across an `.await`.
   `VACUUM INTO` and rusqlite's `backup` cargo feature (the online-backup API) are deliberately never
   used - both emit a plaintext database unless the destination connection is keyed identically, and
   the feature is never enabled.
3. **`create_backup` is desktop-first**, mirroring ADR 0006: the frontend picks the destination via
   `tauri-plugin-dialog`'s `save()` (`dialog:allow-save`, already granted for export), and the
   command builds the envelope and writes it with `std::fs::write`. `tauri-plugin-android-fs` is not
   registered for this command and no android-fs capability is added; the Backup screen detects the
   platform via `getAppInfo()` and shows an `app-banner tone="info"` on Android instead of a control
   that would fail. Android's SAF-backed save is a separate, device-verified follow-up.
4. **Restore (FR-4.3) is out of scope** for this change (tracked as issue #21). The Backup screen
   omits any restore affordance cleanly - no button, no bridge wrapper, no command - rather than
   shipping a partial or unverified restore path.
5. **`base64 = "0.22"` is promoted from a transitive to a direct dependency.** It was already
   resolved in `Cargo.lock` at 0.22.1 (pulled in transitively), so this adds no new supply-chain
   surface (`dependency-audit` skill: permissive MIT/Apache-2.0 license, no build script, negligible
   binary-size cost).
6. **Restore-portability contract:** the same user passphrase plus the `salt`/`kdf` carried in the
   envelope re-derive the identical SQLCipher key (`crypto::derive_key_with_params`) that opens the
   embedded `db` bytes, on any device - proven in `commands::backup::tests::
   envelope_is_restore_portable_and_db_bytes_stay_encrypted` by writing the decoded bytes to a fresh
   path and opening them with a freshly re-derived key. A future restore command (#21) can rely on
   this without changing the envelope shape.

## Consequences

- The desktop slice is fully implemented and CI-verifiable: Rust unit tests for
  `build_envelope`/`to_bytes` (`backup::tests`), a DB-backed integration test that builds a real
  encrypted SQLCipher database, runs the same pipeline `create_backup` drives, and proves both
  "still encrypted" and "restore-portable with the same passphrase" (`commands::backup::tests`), and
  a Karma spec for the five screen states plus the Android info banner. The Android save path
  remains a tracked follow-up, not a stub silently registered here.
- A future Android change adds `tauri-plugin-android-fs` registration, its ACL capability, a bridge
  wrapper for the SAF picker, and replaces the info banner with the real control - the
  `backup::build_envelope`/`to_bytes` pipeline should not need to change.
- A future restore command (#21) reads the envelope, re-derives the key from the carried salt/kdf
  plus a passphrase prompt, and replaces or merges the DB inside a transaction; this ADR does not
  commit to that command's shape beyond the restore-portability contract above.
- The `.vaultbak` file is still sensitive: although the `db` payload is encrypted, the file as a
  whole is the only thing standing between an attacker and the user's data if they also know (or can
  guess) the passphrase. The UI tells the user to keep the backup file and the passphrase safe
  together, but does not add a second, backup-specific secret - that would only shift the
  keep-it-safe burden rather than removing it.

## Alternatives considered

- **A bare copy of `budgetmate.db`.** Rejected: not restore-portable, because the salt and
  `KdfParams` needed to re-derive the key live in the separate `vault-meta.json` sidecar, not inside
  the DB file.
- **`VACUUM INTO` / rusqlite's online-backup API for the snapshot.** Rejected: both require the
  destination connection to be opened with the same SQLCipher key to stay encrypted; without that,
  they silently write a plaintext SQLite file - an unacceptable risk for a feature whose whole point
  is producing an encrypted artifact.
- **A binary (non-JSON) container format** (e.g. a length-prefixed custom binary layout) to avoid
  the base64 overhead entirely. Rejected for this change: JSON keeps the format simple, human-
  inspectable (modulo the encrypted `db` field), and trivially forward-compatible via
  `formatVersion`; the base64 adapter already avoids the worse (numeric-array) alternative, and the
  remaining ~33% overhead on the DB payload is an acceptable, well-understood cost.
- **Build Android's SAF-backed save now, unverified.** Rejected for the same reason as ADR 0006: a
  native, permission-scoped path that cannot be exercised in this sandbox should not be landed
  speculatively.
- **Bundle a restore path in this same change.** Rejected: restore is a distinct, higher-risk
  operation (replace/merge semantics, wrong-passphrase handling, ACID replacement of a live DB) that
  deserves its own focused change and review (issue #21), rather than being rushed alongside the
  backup-creation slice.
