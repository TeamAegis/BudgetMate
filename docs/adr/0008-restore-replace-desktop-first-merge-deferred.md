# 0008 - Restore from encrypted backup: REPLACE mode, desktop-first, merge and Android deferred

Status: Accepted (2026-07-14)

## Context

FR-4.3 asks for restoring a previously created `.vaultbak` backup (ADR 0007), after passphrase
entry, replacing or merging local data. Issue #21 splits that scope: this change lands REPLACE mode
only, desktop-first, mirroring the split ADR 0006 and ADR 0007 already made for export and backup.

Restore is higher-risk than backup: it swaps the live, already-in-use SQLCipher database file for
another one, from inside a running app. Two things make it money- and safety-critical:

- **The backup carries the SOURCE device's own base (reporting) currency.** Every
  `base_amount_minor` in the database was computed against the base currency in force when that row
  was written (`domain::money`). Restoring the database while keeping the CURRENT install's base
  currency would silently mislabel every base-currency total on screen - a correctness bug, not a
  cosmetic one.
- **A crash or power-loss mid-swap must never leave the app with a missing or half-written
  database.** The live db file and the file that replaces it briefly coexist during the swap; the
  window between "the old file is gone" and "the new file is in place" must not exist as an
  observable state on disk.

## Decision

1. **`backup::VaultBackup` (the `.vaultbak` envelope) gains a `baseCurrency` field, `formatVersion`
   stays 1** (additive, `#[serde(default = "default_base_currency")]` so a backup written before
   this field existed still parses, defaulting to MUR). `build_envelope` now reads it straight off
   `meta.settings.base_currency`, so `create_backup`'s call site needs no change. On restore the new
   meta ADOPTS the backup's `base_currency` rather than keeping the current install's - the
   restored database's `base_amount_minor` values are only meaningful against the currency they were
   computed in. The envelope's `base_currency` is untrusted input (an attacker- or hand-edited
   `.vaultbak` file), so `validate_envelope` trims + uppercases it and rejects anything that fails
   `domain::account::is_iso4217` - the SAME check `commands::vault::set_base_currency` applies -
   BEFORE it can be written into the new meta; the normalised code (never the raw envelope string)
   is what `swap_in_restored_copy` writes and what `RestoreOutcome`/`RestoreSummary` disclose to the
   UI.
2. **REPLACE mode only.** `commands::backup::RestoreMode` is a one-variant enum (`Replace`) that the
   command exhaustively matches, so adding `Merge` later forces a deliberate decision here rather
   than silently falling through. Merge needs an ID-remap strategy (category/account/goal ids from
   two independent databases can collide), a dedup pass, and FK-consistency handling that REPLACE
   sidesteps entirely - out of scope for this change (issue #21 follow-up).
3. **Key re-derivation uses the ENVELOPE's own `salt`/`kdf`, never the local install's.** A restore
   opens with the SOURCE vault's key: `crypto::derive_key_with_params(passphrase, &env.salt,
   &env.kdf)`. The envelope's `KdfParams` are validated (`algorithm == "argon2id"`, `output_len ==
   32`, and `m_cost`/`t_cost`/`p_cost` bounded to sane maxima) BEFORE that derivation runs, because
   the envelope is an attacker-suppliable file and an unbounded `m_cost` is an Argon2 memory-
   exhaustion DoS vector.
4. **Crash-safe swap: copy-to-`.prev`, a `restore.pending` marker, then an atomic rename commit.**
   `backup::restore::restore_replace` (`src-tauri/src/backup/restore.rs`, unit-tested without a live
   `AppHandle` - it takes an app-data directory, a `DbState`, a parsed envelope, and a passphrase):
   - Validates the envelope on a `<db>.restore` temp copy first - opens it with the re-derived key,
     rejects a schema newer than this build's `db::latest_migration_version()`, and migrates an
     OLDER schema up to current. The LIVE db is never touched by this step; a wrong passphrase or a
     corrupt embedded database both fail here as the same generic `KeyVerificationFailed` (no
     wrong-key-vs-corrupt oracle, mirroring `db::DbError`), and the app is left exactly as it was.
   - Only once that validation succeeds does it take the `DbState` mutex (dropping the live
     connection releases its file handle, required for the rename to succeed on Windows), COPY (not
     move) the live db and meta to `.prev` siblings, write the `restore.pending` marker, write the
     new meta, and `rename` the validated temp db over the live one (atomic on the same filesystem).
   - The reopened connection re-runs migrations (idempotent - already applied during validation) and
     lazily materialises due recurring occurrences, mirroring `commands::vault::open_and_unlock`.
   - **On any failure during the swap itself, `restore_replace` rolls back synchronously** (same
     logic as point 5) and leaves the app LOCKED: the post-restore key was never retained, but the
     user's ORIGINAL passphrase still matches the rolled-back meta, so they unlock normally. A
     failure during the earlier validation-only step leaves the currently-unlocked app untouched
     and still unlocked - nothing was ever touched.
   - The db `rename` is the point after which the swap can no longer corrupt anything - past it,
     the live files are the restored ones. A crash strictly between that successful rename and the
     marker/`.prev` cleanup still leaves the `restore.pending` marker on disk, so
     `recover_interrupted_restore` will roll an ALREADY-SUCCEEDED restore back to the pre-restore
     state on the next launch. That is still safe (never a corrupted or half-swapped vault) but not
     forward-healing - the user just needs to run the restore again.
5. **`recover_interrupted_restore` self-heals a crash/power-loss mid-swap.** If the process dies
   anywhere from the marker write onward, the `restore.pending` marker plus the `.prev` copies are
   exactly what is needed to roll back to the pre-restore state on the next launch - it is called at
   the top of `restore_backup` AND at the top of `commands::vault::unlock` (before reading meta), so
   the boot/unlock path always self-heals first. The app can never come up silently empty or
   half-swapped; idempotent (a no-op when no marker is present) and cheap (one `Path::exists` check)
   in the common case.
6. **`restore_backup` is a SYNC command, not `async`** (mirroring `commands::vault::unlock`): the
   Argon2id derivation and the blocking file I/O run on the command's own worker thread, and there
   is no `.await` for a `std::sync::Mutex` guard to be held across.
7. **Biometric is forced off on restore; the local idle timeout is preserved.** The restored meta's
   `biometric_enabled` is always `false` - a biometric enrolment wraps the PREVIOUS install's key,
   which restore just replaced, so keeping it enabled would silently break biometric unlock next
   launch. `idle_timeout_secs` is kept from the CURRENT install (a device preference, not vault
   data).
8. **Desktop-first**, mirroring ADR 0006/0007: the frontend picks the `.vaultbak` file via
   `tauri-plugin-dialog`'s `open()` (`dialog:allow-open`, already granted for the receipt picker) -
   `core/bridge::pickBackupFile`. Android's SAF-backed open picker is a separate, device-verified
   follow-up; the Backup screen's existing Android info banner covers restore too (no restore
   affordance is shown there).
9. **After a successful restore, the frontend reloads the whole webview**
   (`window.location.reload()`, wrapped in a small `reload()` method on `Backup` so tests can spy on
   it). Rust's `DbState` stays unlocked across a webview reload - it lives in the Rust process, not
   the frontend - so reloading simply re-bootstraps the Angular app, and every cached
   signal/service (accounts, categories, base currency, dashboard totals, ...) re-fetches against the
   RESTORED data instead of stale pre-restore state, without hand-auditing every cached signal for a
   manual refresh path.

## Consequences

- Restore is fully implemented and CI-verifiable for the desktop, REPLACE-mode slice: Rust unit
  tests build two independent encrypted vaults on a temp dir (no `AppHandle` needed) and exercise
  the round trip, a wrong passphrase, an older-schema backup, a newer-format/newer-meta-version
  rejection, an absurd `KdfParams` rejection, a corrupt embedded database, and the interrupted-
  restore recovery helper in isolation; a Karma spec covers the five states, the confirm-gated flow,
  the double-tap guards, and that `reload()` fires only on success.
- A future Merge mode (issue #21 follow-up) needs its own ID-remap/dedup design and is a new
  `RestoreMode` variant the command must be updated to handle (the current exhaustive `match`
  enforces that).
- A future Android restore change adds `tauri-plugin-android-fs`'s open picker, its ACL capability,
  and a bridge wrapper, replacing the info banner with the real control; `backup::restore` should
  not need to change.
- `restore.pending`/`.prev`/`.restore` are internal, undocumented sidecar files in the app-data
  directory (never in the `.vaultbak` file itself) - a user manually deleting them mid-restore is a
  narrow, self-inflicted edge case outside this ADR's scope (the same trust boundary as manually
  editing `vault-meta.json`).

## Alternatives considered

- **Ship Merge mode in this same change.** Rejected: merge needs an ID-remap strategy across two
  independent databases, a dedup pass, and FK-consistency handling that REPLACE does not need at
  all - a distinct, higher-risk design deserving its own focused change and review.
- **`VACUUM INTO` / an in-place `ATTACH` + copy for the swap.** Rejected for the same reason ADR
  0007 rejected them for backup: correctness aside, neither gives the same crash-safety guarantee as
  copy-to-`.prev` + atomic rename: a mid-operation crash could leave a partially-written live
  database with no automatic path back to the original.
- **Keep the CURRENT install's base currency on restore instead of adopting the backup's.**
  Rejected: `base_amount_minor` is bound to the currency it was computed against at write time: a
  restored ledger under the wrong base currency would silently show materially wrong totals - a
  correctness bug the whole `no-float-money` /`rust_decimal` discipline exists to prevent.
- **Re-derive the key from local `vault-meta.json` instead of the envelope's own salt/kdf.**
  Rejected: the restored database was encrypted with the SOURCE vault's key; only the salt/kdf
  carried IN the envelope (ADR 0007's restore-portability contract) can re-derive it.
- **Build Android's SAF-backed restore now, unverified.** Rejected for the same reason as ADR
  0006/0007: a native, permission-scoped path that cannot be exercised in this sandbox should not be
  landed speculatively.
