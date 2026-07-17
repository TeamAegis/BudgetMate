# 0011 - Wiring OFX/QFX import through the shared CSV pipeline

Status: Accepted (2026-07-17)

## Context

ADR 0009 landed a hand-rolled OFX 1.x/2.x/QFX parser (`import::ofx::parse_ofx`), self-contained and
not yet wired to the command surface. ADR 0010 landed the CSV import pipeline end-to-end
(`import::csv` parse, `db::imports::preview`/`commit`, the three `import_*` commands, the
`ImportFile` wizard), explicitly leaving OFX/QFX wiring as a follow-up: all three commands rejected
any `format` other than `'csv'`. This change (issue #13) wires OFX and QFX through that existing
pipeline rather than building a second one.

Two things had to be reconciled before the two parsers could share one DB-facing core:

- `import::csv::ParsedRows.rows` carried a CSV-only `StagedRow { row, staged }` (0-based data-row
  index); `import::ofx::ParsedImport.transactions` carried bare `StagedTx` values with no row index
  at all, even though `parse_ofx` already computed a block ordinal internally for `RowError.index`.
- CSV import already established (ADR 0010) that every imported row is stored at `fx_rate = '1'`,
  identical to the account's own currency. OFX/QFX transactions can each carry their own currency
  (a per-transaction `CURRENCY.CURSYM` overriding the statement's `CURDEF`), which may legitimately
  differ from the destination account's currency - something a CSV import, driven entirely by the
  chosen account's currency, cannot produce.

## Decision

1. **A shared `StagedRow` moved up to `import::mod`.** `import::StagedRow { row, staged }` replaces
   csv's module-local copy; `import::csv::ParsedRows` and `import::ofx::ParsedImport.transactions`
   both use it. `parse_ofx` now stamps each kept transaction with the same block ordinal it was
   already using for `RowError.index`, so OFX/QFX rows sit in the same index space as their own
   row-errors, exactly like CSV's data-row index does for `csv::RowError`.
2. **`db/imports.rs` splits its CSV-only `preview`/`commit` into a format-agnostic core** -
   `preview_rows`/`commit_rows` - taking an already-parsed `&[StagedRow]` plus a row-error list.
   `preview`/`commit` become thin CSV wrappers (`csv::parse_rows` then the core, byte-for-byte the
   same behaviour as before this change - the CSV integration tests were not touched). `preview_ofx`/
   `commit_ofx` are new entry points that call `ofx::parse_ofx` then the same core.
3. **Money correctness: an OFX/QFX row whose OWN currency differs from the account's is reported and
   never imported**, rather than being force-stored at the account's currency (which would silently
   misattribute the amount) or stored at its own currency with `fx_rate = '1'` anyway (which would
   misrepresent reporting totals, since imports still carry no fx-rate input - ADR 0010).
   `db::imports::split_by_account_currency` partitions parsed rows into "kept" (currency matches the
   account), "malformed" (genuinely unparsable - bad date, unreadable amount, converted from the OFX
   parser's own `RowError`), and **a third, separate list: currency mismatches**
   (`ImportPreviewData.currencyMismatches` / `ImportResultData.currencySkipped`). A currency mismatch
   is **not** folded into the malformed/error list: the row parsed fine and is deliberately excluded
   for money-safety, which is a materially different fact than "this file is corrupt" - conflating
   the two under one "could not be read" heading is factually wrong and, per finance/design review
   of issue #13, actively misleading for a low-literacy user. The message names both currency codes
   (e.g. "This transaction is in USD; this account is in MUR.") - currency codes are not sensitive
   data (unlike amounts/payees) and naming both lets the user act (pick a different account, or
   accept the partial import). This keeps the CSV-import invariant - every imported row's
   `base_amount_minor == amount_minor` at rate 1 - true for OFX/QFX too, rather than creating a
   second, looser invariant for the new formats.
4. **No mapping step for OFX/QFX.** `ImportPreviewInput.mapping`/`ImportCommitInput.mapping` become
   `Option<ColumnMappingInput>`: required (validated in the command, not the DB layer) for
   `'csv'`, ignored for `'ofx'`/`'qfx'` (the file already names its own fields - `DTPOSTED`,
   `TRNAMT`, `NAME`, ...). `import_read_headers` stays CSV-only; a header/sample-rows preview is
   meaningless for a self-describing format.
5. **`commands/import.rs` dispatches on `format`.** CSV keeps its existing `read_file` (`String`)
   path; OFX/QFX use a new `read_file_bytes` (`Vec<u8>`) with the same desktop/`android-fs`
   platform split as `read_file` (`docs/adr/0010`) - no new ACL permission, same rationale as the
   CSV read (Rust-side `AppHandle` methods, not a JS-invoked plugin command).
6. **Frontend:** `ImportFile` gains a `format` signal driven by a `SegmentedToggle` (CSV/OFX/QFX) on
   the idle step; `pickImportFile(format)` picks the matching picker filter/extensions. `chooseFile()`
   only reads CSV headers and enters the `mapping` phase for `'csv'`; for `'ofx'`/`'qfx'` it calls
   `preview()` directly after picking the file. `preview()`/`commit()` pass `mapping` only for
   `'csv'`. No new bridge command was added - only the existing three wrappers' input shapes
   widened (`mapping` optional) and `pickImportFile` gained a `format` parameter. The reviewing step
   renders currency mismatches as their OWN section ("Not imported: different currency", info tone),
   separate from the "Rows that could not be read" malformed section, and the idle-step's account
   `SelectField`/format `SegmentedToggle` are disabled while the idle-step preview read is in flight
   (`[disabled]="busy()"`) so the user cannot change the account the reviewed data was computed
   against out from under an in-flight preview.

## Consequences

- OFX and QFX reuse every CSV-import guarantee for free: one ACID transaction, one split per row
  summing to the parent, sign-aware Uncategorized fallback, rule-engine categorisation, and dedup
  review - because they run through the exact same `preview_rows`/`commit_rows` core, not a
  parallel implementation.
- The two Rust row-error types (`import::RowError`, keyed by block ordinal + `FITID`; and
  `import::csv::RowError`, keyed by data-row index) stay deliberately distinct per ADR 0009/0010;
  `db::imports` adapts an OFX `RowError` into the wire `csv::RowError` shape at the boundary. Fully
  unifying them remains a follow-up, not something this change forces.
- A multi-currency OFX/QFX statement (e.g. a combined bank + card export with different `CURDEF`s)
  imports only the rows matching the chosen destination account's currency; the rest are visible,
  named-reason "not imported (different currency)" rows the user can act on (pick a different
  account, or accept the partial import) rather than a silent partial success, a whole-file
  rejection, or - the specific bug this ADR's follow-up fix corrects - being told those rows
  "could not be read" when they parsed perfectly well.
- No new dependency, no new Tauri command, no new ACL entry - the three-file rule (crate, `lib.rs`
  registration, capability JSON) is untouched; only the existing `import_*` commands' input shapes
  and internal dispatch changed.

## Alternatives considered

- **Converting the destination account's currency to the OFX row's currency at import time (an
  implicit fx rate).** Rejected: the app has no fx-rate input at import (ADR 0010's explicit v1
  limitation); inventing a rate (e.g. 1) for a mismatched currency would silently misrepresent
  reporting totals - a real correctness bug, not a UX shortcut.
- **Rejecting the whole file when any row's currency doesn't match the account.** Rejected: a
  combined multi-account bank export legitimately mixes currencies across statements; failing the
  entire import over one non-matching statement is worse for the user than importing what does
  match and naming what doesn't, mirroring how a malformed OFX transaction block is already reported
  per-row rather than failing the file (ADR 0009).
- **A second, OFX-specific DB pipeline instead of extracting a shared core.** Rejected: `preview`/
  `commit` were already almost entirely format-agnostic (rule lookup, dedup, category resolution,
  the ACID insert loop) - duplicating that logic for OFX/QFX would double the surface needing the
  same invariants (split-sum, sign-aware Uncategorized, idempotent bucket creation) re-verified.
- **A mapping step for OFX/QFX mirroring CSV's.** Rejected: OFX/QFX are self-describing by the
  format's own tag names (`DTPOSTED`, `TRNAMT`, `NAME`, `MEMO`, `FITID`) - there is nothing for a
  user to map, and asking them to would be a needless extra step contradicting the "fewer steps,
  plain language" design principle.

## Deferred / follow-up

Two items were identified during the finance/design review that produced the `currencyMismatches`/
`currencySkipped` split above but are deliberately **not** addressed by this change - out of scope,
not forgotten:

- **The pre-existing CSV parser (`import/csv.rs`) echoes raw amount/date text in its `RowError`
  messages**, inconsistent with the "structural only, no secrets" convention the OFX path
  (`import/ofx.rs`) follows for its own `RowError`. This is a pre-existing ADR-0010 CSV concern, not
  introduced or worsened here; fixing it is a separate, scoped change.
- **The site-wide `SelectField`/`SegmentedToggle` accessible-name-vs-visible-label pattern**
  ("Label in Name", WCAG 2.2 SC 2.5.3) affects every existing use of these two components across the
  app, not just the import wizard. This ADR's fix adds a `disabled` input to both (import-wizard
  need only) without touching their labelling; a full accessible-name audit/fix is its own dedicated
  a11y pass.
