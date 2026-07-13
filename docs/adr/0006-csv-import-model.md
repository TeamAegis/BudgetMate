# 0006 - CSV bank-file import model

Status: Accepted (2026-07-13)

## Context

FR-2.2 (bank-file import) needed a first, real format wired end-to-end. The `imports` audit table
and the `StagedTx`/`ImportFormat` skeleton, the dedup predicate (`rules::dedup`), and the rule
engine (`rules::engine`) already existed but were unwired (`docs/design/screens.md` §4.5). Several
choices had to be made about how an imported row differs from a manually-entered one, and how much
state the import commands should carry.

## Decision

- **No new migration.** The `imports` audit table (`id, filename, format, imported_at, row_count`)
  already existed in `0001_init.sql` and is used as-is.
- **No new ACL, but the file read is a known Android gap.** Rust reads the picked file via
  `std::fs::read_to_string` given a path - the file dialog returns a path, Rust reads it, and the
  existing `dialog:allow-open` capability is sufficient (no `fs:` permission was added). This is
  **not** "exactly like the OCR flow": `extract_receipt(image_path)` forwards its path unopened to
  the native OCR plugin (ML Kit on Android via Kotlin), which is content-URI aware and never touches
  `std::fs` in Rust. CSV import has no such native forwarding step - it reads the path directly in
  Rust. That works on the **Windows desktop dev/test target**, where the dialog returns a real
  filesystem path. On **Android**, the picker returns a `content://` URI, which `std::fs` cannot
  open - `import_read_headers`/`import_preview`/`import_commit` will fail to read the file at all on
  a real device. A content-URI-aware read (`tauri-plugin-android-fs`, already a dependency) is
  required and is a **tracked follow-up**, not yet implemented; this is why the feature has not been
  verified on-device and needs a human to confirm the fix once it lands.
- **Imported rows store the file's SIGNED amount directly.** Manual entry derives the sign from the
  chosen category's kind (`domain::transaction::signed_amount`); an imported row has no such
  category at parse time; a raw CSV amount is already signed (negative = money out, positive =
  money in) by the bank's own convention. `domain::money::parse_minor` already preserves sign, so
  `import::csv::parse_rows` uses it directly and does no sign derivation. Each imported transaction
  still gets exactly one `tx_splits` row whose amount equals the parent, so the "splits sum to
  parent" DB invariant (`domain::money::splits_sum_to_parent`) holds trivially, and the manual-entry
  kind-vs-sign invariant (`validate_split_set`) is intentionally NOT invoked for imports - the
  dedicated `db::imports::commit` insert path does not call `db::transactions::create`/`prepare`.
- **Category for imported rows** is resolved by running the active rule engine
  (`db::rules::active_engine_rules` + `rules::engine::apply_rules_traced`) against
  `merchant = payee`, then taking the LAST category-setting rule in the trace (later rules override
  earlier ones - the same `.rev().find(set_field == "category")` convention `preview_rules` uses in
  `db/rules.rs`). If that rule's category NAME matches an existing category (case insensitive)
  **whose `kind` matches the row's sign**, that category is used; a rule never creates a category,
  and a kind/sign mismatch (e.g. a rule naming an income category for a negative-amount row) is
  never stored. Otherwise the row falls back to a sign-aware, get-or-create Uncategorized bucket:
  negative amounts to an expense-kind "Uncategorized", positive amounts to an income-kind
  "Uncategorized income" - so an imported income row never lands in an expense-kind category and
  vice versa. Both buckets are created lazily inside the commit transaction (not added to
  `db::seed_defaults`, keeping that function's existing idempotency test untouched). `preview` and
  `commit` share the exact same resolution function, so the review screen's suggested category is
  always the real name `commit` will store, never stale rule text.
- **One signed `amount` column; no separate debit/credit columns.** This matches the existing
  `transactions.amount_minor` schema and keeps the importer simple. Out of scope for this change;
  a bank export with separate debit/credit columns would need a small pre-merge step (a later
  ticket) rather than a schema change.
- **Commands are stateless and re-parse on demand.** `import_preview` and `import_commit` both take
  the file `path` + `format` + `mapping` and re-parse the file; nothing is cached in Rust state
  between the two calls. This keeps the two commands independent (a user can re-open the mapping
  step and preview again) and avoids adding managed state for a file that already lives on disk (the
  file IS the source of truth). Rows are identified by their stable 0-based data-row index (the
  position `csv::Reader::records()` yields, excluding the header row), which `import_commit`'s
  `skipRows` refers back to.
- **OFX/QFX are out of scope for this change** (tracked as issue #13). `ImportFormat` already has
  `Ofx`/`Qfx` variants for the TS union and future commands; all three import commands reject a
  non-CSV `format` with a plain-language `Validation` error rather than silently no-oping.
- **Foreign-currency imports do not convert for reporting (v1 limitation).** Every imported
  transaction is stored with `fx_rate = '1'` and `base_amount_minor = amount_minor` unconditionally,
  even when the account's currency differs from the base reporting currency
  (`getSettings().baseCurrency`) - identical to a same-currency import. This is honest, not silent:
  when the chosen account's currency differs from the base currency, the import wizard shows a
  plain-language warning banner on the idle/mapping step so the user knows up front that these
  amounts will not be converted for reporting yet. Building a full fx-rate input for import is out
  of scope for this change; a future change could ask for (or look up) a rate at import time,
  mirroring the per-transaction user-entered rate manual entry already has
  (`domain::transaction::signed_amount`).

## Consequences

- The importer is a thin, three-command surface (`import_read_headers`, `import_preview`,
  `import_commit`) with all parsing/rule/dedup/money logic in Rust (`import::csv`, `db::imports`);
  the Angular wizard (`features/import/import-file`) only marshals the column mapping and
  presents the result.
- Because `commit` re-parses instead of trusting client-supplied row data, a user cannot smuggle an
  arbitrary amount/date through the wizard - only what is actually in the picked file (plus the
  chosen mapping and skip list) can be inserted, and the ACID batch either fully commits or fully
  rolls back.
- A future OFX/QFX importer can reuse `db::imports::preview`/`commit` almost unchanged by producing
  the same `StagedTx`/`ColumnMapping`-shaped input from a different parser module
  (`import::ofx`), keeping the DB-facing pipeline shared across formats.

## Alternatives considered

- **Deriving sign from a category chosen up front** (mirroring manual entry) - rejected: a bank
  file's own sign is the ground truth for what actually happened on the statement, and forcing a
  category before parsing would block the preview step from ever showing an amount.
- **Committing based on the previewed rows** (client sends back the previewed data) - rejected:
  re-parsing keeps the Rust core as the single source of truth for money and avoids trusting
  round-tripped JSON for a financial write; the cost (parsing the file twice) is negligible for a
  bank-statement-sized CSV.
