# 0009 - OFX/QFX import: hand-rolled parser, isolated behind import/ofx.rs

Status: Accepted (2026-07-15)

## Context

FR-2.2 asks for bank-file import covering OFX 1.x (SGML), OFX 2.x (XML), and QFX (Intuit's OFX
variant used by many card issuers). `CLAUDE.md` names `ofx-rs` as the expected crate for this.
Two things push against using it as-is:

- `ofx-rs` is an early-stage, thinly-maintained crate. It does not cleanly cover all three
  dialects (in particular OFX 1.x SGML's unclosed leaf tags and QFX's Intuit-specific tags), and
  pulling in an XML/SGML parsing dependency adds supply-chain surface and binary size in a
  strictly offline, size-budgeted app for a format that is, in practice, a very small and regular
  tag grammar.
- The issue tracking this work explicitly permits an alternative to `ofx-rs` if it proves
  inadequate, provided OFX/QFX handling stays isolated behind `import/ofx.rs` so the rest of the
  import pipeline (dedup, rules, CSV) does not depend on the choice.

## Decision

1. **A hand-rolled, lenient tag scanner lives entirely in `src-tauri/src/import/ofx.rs`.** No XML
   or SGML crate is added; the only dependencies used are already-present `chrono` (dates),
   `rust_decimal` (via `domain::money::parse_minor` for amounts), `thiserror` (the `OfxError`
   enum), and `std`.
2. **One scanner handles all three dialects** by leaning on the one structural fact that holds
   across OFX 1.x SGML, OFX 2.x XML, and QFX: a container ("aggregate") tag always carries an
   explicit closing tag (`<STMTTRN>...</STMTTRN>`), while a leaf tag's value is simply the text
   between the end of its opening tag and the next `<` - whether that next `<` is a sibling leaf
   (SGML, routinely unclosed) or the tag's own closing tag (XML, always closed). QFX's Intuit tags
   (`INTU.BID`, `INTU.USERID`, ...) are ordinary leaves that are never looked up by name, so they
   are ignored without any special-casing.
3. **Money stays on the Rust money path.** The transaction's currency is resolved first (per-
   transaction `CURRENCY.CURSYM` if present, else the statement's `CURDEF`; never a guessed
   default), then `TRNAMT` is parsed via `domain::money::parse_minor`, the same function the rest
   of the app uses for user-entered amounts - no bespoke `f64` or ad-hoc `*100` scaling.
   `DTPOSTED` is reduced to an ISO calendar date via `chrono::NaiveDate`; any time-of-day/timezone
   suffix is deliberately discarded (see the module's doc comment for why).
4. **A malformed transaction block is reported, never dropped or panicked on.** `parse_ofx` returns
   `Result<ParsedImport, OfxError>`; `ParsedImport` carries both the successfully normalised
   `StagedTx` rows and a `Vec<RowError>` (structural, no-financial-data messages) for rows that
   could not be normalised (bad amount, bad/missing date, no resolvable currency). Only file-level
   problems (not OFX at all, absurdly large, no currency information anywhere in the file) fail
   the whole parse.
5. **Input is bounded before it is scanned**: a byte-size cap (`MAX_INPUT_BYTES`, 32 MiB) and a
   transaction-count cap (`MAX_TRANSACTIONS`, 50,000) reject a pathological file up front, since an
   offline app has no server-side upload limit to lean on. Entity unescaping is bounded per-call
   too (`ENTITY_SEARCH_WINDOW`) rather than scanning unboundedly for a missing `;`.
6. **No new IPC/DB surface in this change.** `parse_ofx` does no database writes and is not wired
   to a `#[tauri::command]`; `error.rs` gains a `From<OfxError> for AppError` mapping (all variants
   are user-fixable, so `AppError::Validation`) so the eventual import command can use `?`
   directly, but wiring the command, the dedup/rule pass, and the review UI is a separate change
   (issue #12), matching how `rules/dedup.rs` and `import/mod.rs` already describe themselves as
   skeletons pending that wiring.

## Consequences

- Zero new supply-chain surface and zero binary-size cost from an XML/SGML crate
  (`dependency-audit` skill: nothing to audit here at all).
- Immune to XML entity-expansion ("billion laughs") and XXE-style attacks by construction, not by
  a depth limit or an entity-count budget: the unescape step recognises only the five predefined
  XML entities plus numeric character references, and is explicitly non-recursive, and there is no
  DTD/external-entity concept in this scanner at all to exploit.
- We own every edge case ourselves: encoding (bytes are decoded with `String::from_utf8_lossy`, so
  a CP1252-only export with accented payee/memo text may degrade a few characters rather than fail
  - acceptable for v1, and rare for Mauritius bank exports, which are ASCII-heavy), entity
  handling, and dialect quirks. A future complaint about encoding loss or an OFX quirk this
  scanner doesn't handle is a bug against `import/ofx.rs`, not a crate upgrade.
- `ORIGCURRENCY` (a bank's own conversion note on a transaction) is deliberately not read; only the
  transaction's own currency and amount are used. This is the spec-correct default, not an open
  scope cut: per the OFX spec, when `ORIGCURRENCY` is present, `TRNAMT` is already expressed in the
  enclosing statement's `CURDEF` (or the transaction's own `CURRENCY.CURSYM` override) -
  `ORIGCURRENCY` is informational only, and applying its rate on top of an already-converted
  `TRNAMT` would double-convert the amount, a real correctness bug rather than a missing feature.
  If a future need requires reading it for a different purpose (e.g. surfacing the original amount
  as extra context), that is a new, separate decision - not a silent extension of this one.
- The scanner's block/leaf search is a small number of linear passes over the input per
  transaction block; this is adequate for realistic bank/card export sizes (low thousands of
  rows, well under the `MAX_TRANSACTIONS` cap) but is not asymptotically optimal for a
  worst-case adversarial file at the cap - acceptable given the hard byte- and row-count ceilings
  already in place.

## Alternatives considered

- **`ofx-rs` as originally named in `CLAUDE.md`.** Rejected for this change: immature coverage of
  OFX 1.x SGML's unclosed-tag convention and QFX's Intuit tags, and it would still need to be
  isolated behind `import/ofx.rs` to avoid leaking a not-fully-trusted parsing crate's failure
  modes into the rest of the import pipeline - at which point a small hand-rolled scanner with the
  same isolation is simpler and has a smaller trust surface. Revisit with a new ADR if `ofx-rs`
  matures or a real-world file this scanner cannot handle is found.
- **A general-purpose XML crate (e.g. `quick-xml`) plus separate hand-rolled SGML handling.**
  Rejected: OFX 1.x SGML is not well-formed XML (unclosed leaves, no single root-closing
  discipline in older exports), so a real XML parser would only cover the 2.x/QFX-XML case and
  the SGML case would need its own scanner anyway - two code paths instead of one, for a format
  simple enough that one lenient scanner covers both.
- **Defaulting an unresolvable transaction's currency to the app's base currency (MUR).** Rejected:
  would silently misattribute a foreign-currency transaction's amount under the wrong currency
  code - a real correctness bug, not a UX shortcut. An unresolvable currency is either a per-row
  `RowError` (if some other row in the file does have currency information) or a file-level
  `OfxError::NoCurrency` (if none does).
- **Honouring `DTPOSTED`'s timezone suffix.** Rejected: correctly shifting the calendar date around
  a timezone offset needs a tz database this build does not carry, and a bank's posted date is
  conventionally read as the calendar date on the statement, not a timestamp - so the suffix is
  read for its date digits only and otherwise ignored.
