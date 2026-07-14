# 0006 - Transaction export: desktop-first save, Android SAF deferred, amounts as strings

Status: Accepted (2026-07-14)

## Context

FR-4.2 asks for CSV/XLSX export of the transaction ledger to a user-chosen destination. The two
platforms in scope get there very differently:

- **Desktop** (Windows dev/test target): the `dialog` plugin's save picker returns a plain
  filesystem path, and `std::fs::write` can write straight to it. This is fully exercisable and
  verifiable in a normal CI/dev sandbox with no device.
- **Android**: a plain filesystem path from a save dialog does not work the same way (scoped
  storage) - the real mechanism is `tauri-plugin-android-fs`'s SAF (Storage Access Framework)
  picker plus a persistable URI permission. That is native, device/emulator-only behaviour that
  cannot be honestly verified without an Android target, and registering the plugin/ACL for a path
  never actually exercised would be exactly the kind of unverified surface CLAUDE.md warns against.

Splitting the work needed a boundary that keeps the writers platform-agnostic while being explicit
about what is and isn't proven.

## Decision

1. **The writers are pure and platform-agnostic.** `export::rows::build_rows` assembles one
   `ExportRow` per category split (lossless for a split transaction) from `Transaction` + id-to-name
   lookup maps; `export::csv::to_csv` / `export::xlsx::to_xlsx` turn rows into bytes. None of this
   code touches a filesystem or a dialog, so it is unit/insta-snapshot-tested without Tauri and will
   be reused unchanged for the Android slice.
2. **The `export_transactions` command is desktop-first.** The frontend picks the destination via
   `tauri-plugin-dialog`'s `save()` (already granted `dialog:allow-open`; this change adds
   `dialog:allow-save`), and the command reads the DB, builds the rows, renders bytes, and writes
   them with `std::fs::write`. This is the whole implemented slice; `tauri-plugin-android-fs` is
   **not** registered and no android-fs capability is added.
3. **Android's save path is a separate, device-verified change.** Until then, the Export screen
   detects the platform via the existing `getAppInfo()` bridge call and, on Android, shows an
   `app-banner tone="info"` ("Export is available on the desktop app for now") instead of a button
   that would fail. No broken affordance ships.
4. **Every amount is emitted as a STRING**, via a new `domain::money::minor_to_major_string`
   (integer minor units -> a fixed-decimal string using `rust_decimal::Decimal::set_scale`, never a
   float). `rust_xlsxwriter::write_number` (which takes an `f64`) is never called; XLSX amount cells
   use `write_string`/`write_string_with_format`. This keeps the `no-float-money` guard (which scans
   `export/`) satisfied and preserves exact minor-unit precision, at the cost of the exported XLSX
   amount column being text rather than a numeric cell a spreadsheet can sum directly.
5. **`ExportRow` carries the split's own category kind**, not just its name. `TxSplit` (the IPC DTO)
   only denormalises `category_name`; it does not carry `kind`. Because income and transfer splits
   are both stored as positive `amount_minor` (`domain::transaction::signed_amount`), the sign alone
   cannot tell them apart, so the command builds a second `category_id -> CategoryKind` lookup map
   (from `db::categories::list`) alongside the existing `account_id -> name` map and passes both into
   `build_rows`. This is a deliberate widening of the row-assembler's signature beyond a single
   lookup map.

## Consequences

- The desktop slice is fully implemented and CI-verifiable: Rust unit/insta tests for
  `minor_to_major_string`, `build_rows`, `to_csv`, `to_xlsx`, a DB-backed integration test through
  the same pipeline the command drives, and a Karma spec for the five screen states. The Android
  save path remains a tracked follow-up (its own issue/PR), not a stub silently registered here.
- Exported XLSX amount cells are text, not numbers - a spreadsheet's SUM() won't work on them
  as-is. This is an accepted, documented tradeoff; moving to numeric cells (still built from
  `rust_decimal`, converted once at the writer boundary with an explicit rounding contract) is a
  finance-validated follow-up, not bundled into this change.
- JSON is a defined `ExportFormat` variant (for forward-compatibility / IPC completeness) but has no
  writer - `write_bytes` rejects it with `ExportError::Unsupported`. The UI never offers it
  (`screens.md` §7.4).
- A future Android change adds `tauri-plugin-android-fs` registration, its ACL capability (Android
  platform-scoped, per `.claude/rules/tauri.md`), a bridge wrapper for the SAF picker, and replaces
  the info banner with the real control - the Rust `build_rows`/`write_bytes` pipeline should not
  need to change.

## Alternatives considered

- **Build the Android SAF path now, unverified.** Rejected: native, permission-scoped behaviour that
  cannot be exercised in this sandbox is exactly the kind of change CLAUDE.md asks to flag rather
  than land speculatively; a broken or untested Android affordance is worse than an honest "not yet"
  banner.
- **Numeric XLSX cells now, converting the decimal string to `f64` only at the `write_number` call.**
  Rejected for this change: even a boundary-only float conversion needs a finance-validated rounding
  contract (which minor-unit edge cases can lose a cent in an `f64` round-trip) - left as a follow-up
  rather than rushed alongside the desktop-first save-path work.
- **Derive `kind` from the split amount's sign alone.** Rejected: income and transfer are both
  positive, so sign alone mislabels a transfer as income; the category-kind lookup map is the
  correct, if slightly wider, signature.
