//! Hand-rolled OFX 1.x (SGML) / OFX 2.x (XML) / QFX parser (FR-2.2), self-contained in this
//! module per `docs/adr/0009-hand-rolled-ofx-parser.md`. Normalises to `StagedTx`. Pure Rust,
//! offline, no XML/OFX crate, no new dependency.
//!
//! ## Why one scanner handles both dialects
//! A "container" (aggregate) tag - one that holds other tags, e.g. `<STMTTRN>...</STMTTRN>` -
//! always carries an explicit closing tag in BOTH OFX 1.x SGML and OFX 2.x XML. That is the one
//! structural fact this parser leans on: find `<STMTTRN>` ... `</STMTTRN>` (or the credit-card
//! alias `<CCSTMTTRN>...</CCSTMTTRN>`) and everything for one transaction is inside.
//!
//! A "leaf" tag - one that holds a value, e.g. `<DTPOSTED>` - is frequently left UNCLOSED in OFX
//! 1.x SGML (`<DTPOSTED>20260601` with no `</DTPOSTED>`, the value runs up to the next `<`). OFX
//! 2.x XML always closes it (`<DTPOSTED>20260601</DTPOSTED>`). Rather than branch on dialect, a
//! leaf's value is always defined the same way: "the text between the end of `<TAG>` and the
//! next `<`, trimmed" - which is correct whether that next `<` starts a sibling leaf (SGML) or the
//! matching `</TAG>` (XML). QFX is just OFX with extra Intuit tags (`INTU.BID`, `INTU.USERID`,
//! ...) interspersed; they are leaves like any other, simply never looked up by name, so they are
//! ignored for free.
//!
//! ## What this module does NOT do
//! - No DB writes, no IPC, no Tauri command. Wiring `parse_ofx` into the review/dedup/insert
//!   pipeline lands with the import command surface (issue #12).
//! - No fx conversion: only the transaction's own `amount_minor` + `currency` are emitted.
//!   `base_amount_minor` is computed by the DB layer on insert (`.claude/rules/database.md`).
//! - No `ORIGCURRENCY` handling: this is the spec-correct default, not a scope cut. Per the OFX
//!   spec, when `ORIGCURRENCY` is present on a transaction, `TRNAMT` is already expressed in the
//!   enclosing statement's `CURDEF` (or the transaction's own `CURRENCY.CURSYM` override);
//!   `ORIGCURRENCY` is informational only. Applying its rate on top of an already-converted
//!   `TRNAMT` would double-convert the amount - a real bug, not a missing feature.
//! - No CDATA support (OFX/QFX do not use it in practice).
//! - No encoding detection beyond UTF-8: bytes are decoded with `String::from_utf8_lossy`, so a
//!   CP1252-only bank export with accented payee/memo text (rare for Mauritius bank exports, which
//!   are ASCII-heavy) may degrade a few characters rather than fail the import. Adding
//!   `encoding_rs` to fix that is a deliberate non-goal here (no new dependency); revisit with a
//!   new ADR if it becomes a real complaint.

use std::collections::HashMap;

use chrono::NaiveDate;
use thiserror::Error;

use crate::domain::money::{parse_minor, MoneyParseError};

use super::{ParsedImport, RowError, StagedRow, StagedTx};

/// Hard cap on input size in bytes, rejected before any scanning. An offline app has no
/// server-side upload limit to lean on, so it must reject a pathological file itself. 32 MiB is
/// generously above any real single-account bank/card export (a multi-year, several-thousand-row
/// OFX file is typically well under 5 MiB).
const MAX_INPUT_BYTES: usize = 32 * 1024 * 1024;

/// Hard cap on the number of transaction blocks parsed from one file: defence in depth against a
/// crafted file trying to force an unbounded number of allocations via a huge repeated tag.
const MAX_TRANSACTIONS: usize = 50_000;

/// Longest span searched for a closing `;` when resolving an entity reference. Bounds the cost of
/// a stray, unterminated `&` in the input to a small constant instead of an O(n) rescan of the
/// remaining document (the longest valid entity here, `&#1114111;`, is 11 bytes).
const ENTITY_SEARCH_WINDOW: usize = 16;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum OfxError {
    /// The file is larger than `MAX_INPUT_BYTES`.
    #[error("file is larger than the supported import size")]
    TooLarge,
    /// No `<OFX>` root tag was found (also covers undecodable / non-OFX content: whatever bytes
    /// were given did not lossy-decode to anything containing the OFX root).
    #[error("file is not a recognisable OFX/QFX document")]
    NotOfx,
    /// More transaction blocks than `MAX_TRANSACTIONS`.
    #[error("file has more transactions than can be imported at once")]
    TooManyTransactions,
    /// Neither a statement-level `CURDEF` nor any per-transaction `CURRENCY.CURSYM` was found
    /// anywhere in the file, so no transaction's currency could be resolved. A transaction must
    /// never be assigned a guessed currency (never default to MUR or anything else).
    #[error("file has no currency information for its transactions")]
    NoCurrency,
}

/// Parse an OFX 1.x (SGML), OFX 2.x (XML), or QFX byte stream into normalised staged
/// transactions. The dialect is detected internally; callers never specify a format.
///
/// Malformed individual transaction blocks are reported as [`RowError`]s in
/// [`ParsedImport::row_errors`] and skipped - they are never silently dropped, and a single bad
/// row never fails the whole file. Only file-level structural problems (not OFX at all, absurdly
/// large, no resolvable currency anywhere) return `Err`.
///
/// ```
/// use app_lib::import::ofx::parse_ofx;
///
/// let ofx = "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MUR<BANKTRANLIST>\n\
///     <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260601<TRNAMT>-450.00<FITID>1001<NAME>Market</STMTTRN>\n\
///     </BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";
///
/// let parsed = parse_ofx(ofx.as_bytes()).unwrap();
/// assert_eq!(parsed.transactions.len(), 1);
/// assert!(parsed.row_errors.is_empty());
///
/// let row = &parsed.transactions[0];
/// assert_eq!(row.row, 0);
/// let tx = &row.staged;
/// assert_eq!(tx.amount_minor, -45_000);
/// assert_eq!(tx.currency, "MUR");
/// assert_eq!(tx.posted_date, "2026-06-01");
/// assert_eq!(tx.payee.as_deref(), Some("Market"));
/// assert_eq!(tx.source_ref.as_deref(), Some("1001"));
/// ```
pub fn parse_ofx(bytes: &[u8]) -> Result<ParsedImport, OfxError> {
    if bytes.len() > MAX_INPUT_BYTES {
        return Err(OfxError::TooLarge);
    }
    let text = String::from_utf8_lossy(bytes);
    if !text.contains("<OFX>") {
        return Err(OfxError::NotOfx);
    }

    let statements = collect_statements(&text)?;

    let total_tx: usize = statements.iter().map(|s| s.blocks.len()).sum();

    // Never guess a currency. If there is no resolvable currency (own CURRENCY.CURSYM or its
    // statement's CURDEF) for ANY transaction anywhere in the file, that is a file-level problem,
    // not a per-row one.
    let any_currency_resolvable = statements
        .iter()
        .any(|s| s.blocks.iter().any(|content| resolve_currency(content, s.currency.as_deref()).is_some()));
    if total_tx > 0 && !any_currency_resolvable {
        return Err(OfxError::NoCurrency);
    }

    let mut transactions = Vec::with_capacity(total_tx);
    let mut row_errors = Vec::new();
    let mut index = 0usize;
    for statement in statements {
        for content in statement.blocks {
            match parse_stmttrn(content, statement.currency.as_deref(), index) {
                Ok(tx) => transactions.push(StagedRow { row: index, staged: tx }),
                Err(err) => row_errors.push(err),
            }
            index += 1;
        }
    }

    Ok(ParsedImport { transactions, row_errors })
}

/// One statement aggregate (`STMTRS`/`CCSTMTRS`) reduced to its own currency default plus the
/// transaction blocks it contains. OFX/QFX files legitimately carry more than one statement (a
/// combined "download all accounts" export commonly mixes a bank account and a credit card, each
/// with its own `CURDEF`), so `CURDEF` must be resolved per statement, never once for the whole
/// document.
struct Statement<'a> {
    currency: Option<String>,
    blocks: Vec<&'a str>,
}

/// Split `text` into its statement aggregates and, within each, its transaction blocks - enforcing
/// `MAX_TRANSACTIONS` as a running total across ALL statements while doing it, so a pathological
/// file stops being scanned as soon as the cap is exceeded rather than after every block has been
/// collected.
///
/// Fallback: if no `STMTRS`/`CCSTMTRS` aggregate is found at all (a minimal or malformed file) but
/// transaction blocks exist directly, the whole document is treated as one statement using the
/// document-wide `CURDEF` - the pre-existing behaviour, so a file without statement wrappers still
/// parses.
fn collect_statements(text: &str) -> Result<Vec<Statement<'_>>, OfxError> {
    let statement_blocks = extract_blocks_multi(text, &["STMTRS", "CCSTMTRS"]);
    let mut statements = Vec::with_capacity(statement_blocks.len().max(1));
    let mut total = 0usize;

    let sources: Vec<&str> = if statement_blocks.is_empty() { vec![text] } else { statement_blocks };

    for block in sources {
        let cap = MAX_TRANSACTIONS.saturating_sub(total);
        let blocks = extract_blocks_multi_capped(block, &["STMTTRN", "CCSTMTTRN"], cap);
        total += blocks.len();
        if total > MAX_TRANSACTIONS {
            return Err(OfxError::TooManyTransactions);
        }
        let currency = find_first_leaf(block, "CURDEF").map(|c| c.to_uppercase());
        statements.push(Statement { currency, blocks });
    }

    Ok(statements)
}

/// Build one `StagedTx` from the raw content of a single `STMTTRN`/`CCSTMTTRN` block, or a
/// structural `RowError` if it cannot be normalised.
fn parse_stmttrn(content: &str, statement_currency: Option<&str>, index: usize) -> Result<StagedTx, RowError> {
    let leaves = parse_leaves(content);
    let source_ref = leaves.get("FITID").cloned();

    let err = |message: &str| RowError {
        index,
        source_ref: source_ref.clone(),
        message: message.to_string(),
    };

    let posted_date = leaves
        .get("DTPOSTED")
        .and_then(|raw| parse_ofx_date(raw))
        .ok_or_else(|| err("missing or invalid posting date"))?;

    let currency = resolve_currency(content, statement_currency)
        .ok_or_else(|| err("no currency available for this transaction"))?;

    let trnamt = leaves.get("TRNAMT").ok_or_else(|| err("missing amount"))?;
    let trimmed = trnamt.trim();
    let normalised = trimmed.strip_prefix('+').unwrap_or(trimmed);
    let amount_minor = parse_minor(normalised, &currency).map_err(|e| {
        err(match e {
            MoneyParseError::Malformed => "amount is not a valid number",
            MoneyParseError::TooPrecise => "amount has more decimal places than the currency allows",
            MoneyParseError::Overflow => "amount is out of range",
        })
    })?;

    let payee = leaves.get("NAME").cloned();
    let note = leaves.get("MEMO").cloned();

    Ok(StagedTx { posted_date, amount_minor, currency, payee, note, source_ref })
}

/// Resolve the currency for one transaction block: its own `CURRENCY.CURSYM` if present,
/// otherwise the statement-level default. Never guesses.
fn resolve_currency(stmttrn_content: &str, statement_currency: Option<&str>) -> Option<String> {
    if let Some(cur_block) = extract_single_block(stmttrn_content, "CURRENCY") {
        if let Some(sym) = parse_leaves(cur_block).get("CURSYM") {
            if !sym.is_empty() {
                return Some(sym.to_uppercase());
            }
        }
    }
    statement_currency.map(|c| c.to_uppercase())
}

/// Parse `DTPOSTED` into an ISO `yyyy-mm-dd` string: take the first 8 digit characters (yyyymmdd)
/// and validate them as a calendar date. Any time-of-day or timezone suffix (`120000[-5:EST]`) is
/// deliberately ignored - honouring a timezone offset could shift the calendar date by a day
/// around midnight and would need a tz database this build doesn't carry; a bank's posting date
/// is a date, and `StagedTx` has no time component.
fn parse_ofx_date(raw: &str) -> Option<String> {
    let digits: String = raw.chars().filter(char::is_ascii_digit).take(8).collect();
    if digits.len() < 8 {
        return None;
    }
    let year: i32 = digits[0..4].parse().ok()?;
    let month: u32 = digits[4..6].parse().ok()?;
    let day: u32 = digits[6..8].parse().ok()?;
    NaiveDate::from_ymd_opt(year, month, day).map(|d| d.format("%Y-%m-%d").to_string())
}

/// Find the value of the first `<TAG>value` occurrence anywhere in `text` (used for the
/// statement-level `CURDEF`, which appears once, before the transaction list).
fn find_first_leaf(text: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let start = text.find(&open)? + open.len();
    let rest = &text[start..];
    let end = rest.find('<').unwrap_or(rest.len());
    let raw = rest[..end].trim();
    if raw.is_empty() {
        None
    } else {
        Some(unescape(raw))
    }
}

/// Find the first `<TAG>...</TAG>` block inside `text` (used for the per-transaction `CURRENCY`
/// aggregate).
fn extract_single_block<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    extract_blocks_multi(text, &[tag]).into_iter().next()
}

/// Find every `<TAG>...</TAG>` block for any of `tags`, in document order. See
/// [`extract_blocks_multi_capped`] for the scan strategy; this is the uncapped form used where no
/// pathological-file defence is needed (a single `CURRENCY` aggregate per transaction block).
fn extract_blocks_multi<'a>(text: &'a str, tags: &[&str]) -> Vec<&'a str> {
    extract_blocks_multi_capped(text, tags, usize::MAX)
}

/// Find every `<TAG>...</TAG>` block for any of `tags`, in document order, stopping as soon as
/// more than `cap` blocks have been collected (returns `cap + 1` blocks in that case - enough for
/// the caller to detect "too many" without the scan continuing to the end of a pathological file).
/// Works for both dialects because a container tag always carries an explicit closing tag in SGML
/// and XML alike (see the module doc comment). An unterminated block (opening tag with no matching
/// close before end of input) stops the scan rather than including a truncated block.
///
/// Single forward pass over `<` characters (not a `find(open_tag)` scan repeated per candidate
/// tag): with `tags` containing one absent tag (e.g. `CCSTMTTRN` when the file has no credit-card
/// transactions), repeatedly re-scanning the whole remaining text for a tag that never occurs
/// would be quadratic in a file with many `STMTTRN` blocks. Advancing strictly past each `<` we
/// look at keeps the whole scan linear in the input size.
fn extract_blocks_multi_capped<'a>(text: &'a str, tags: &[&str], cap: usize) -> Vec<&'a str> {
    let delims: Vec<(String, String)> = tags.iter().map(|t| (format!("<{t}>"), format!("</{t}>"))).collect();
    let mut out = Vec::new();
    let mut pos = 0usize;
    while let Some(lt_rel) = text[pos..].find('<') {
        if out.len() > cap {
            break;
        }
        let lt = pos + lt_rel;
        match delims.iter().find(|(open, _)| text[lt..].starts_with(open.as_str())) {
            Some((open, close)) => {
                let after_open = lt + open.len();
                match text[after_open..].find(close.as_str()) {
                    Some(end_rel) => {
                        let end = after_open + end_rel;
                        out.push(&text[after_open..end]);
                        pos = end + close.len();
                    }
                    // Unterminated - stop scanning rather than include a truncated block.
                    None => break,
                }
            }
            None => pos = lt + 1,
        }
    }
    out
}

/// Parse every LEAF tag (`<TAG>value`, where `value` is text up to the next `<`, not another
/// tag immediately) inside `content` into a flat map keyed by tag name. Nested aggregates (e.g.
/// `CURRENCY` inside a transaction) are picked up "for free": a container tag is skipped without
/// skipping past its contents, so a leaf nested one level in is still found by the same flat scan.
/// Closing tags (`</TAG>`) are always skipped. First occurrence of a tag name wins.
fn parse_leaves(content: &str) -> HashMap<&str, String> {
    let mut out: HashMap<&str, String> = HashMap::new();
    let mut i = 0usize;
    while let Some(lt_rel) = content[i..].find('<') {
        let tag_start = i + lt_rel + 1;
        let Some(gt_rel) = content[tag_start..].find('>') else { break };
        let tag_end = tag_start + gt_rel;
        let tag_name = &content[tag_start..tag_end];
        let value_start = tag_end + 1;
        if tag_name.is_empty() || tag_name.starts_with('/') {
            i = value_start.min(content.len());
            continue;
        }
        match content[value_start..].find('<') {
            Some(0) => {
                // TAG is immediately followed by another tag: it's a container, not a leaf.
                // Continue scanning right after its opening tag so nested leaves are still found.
                i = value_start;
            }
            Some(rel) => {
                let raw = content[value_start..value_start + rel].trim();
                if !raw.is_empty() {
                    out.entry(tag_name).or_insert_with(|| unescape(raw));
                }
                i = value_start + rel;
            }
            None => {
                let raw = content[value_start..].trim();
                if !raw.is_empty() {
                    out.entry(tag_name).or_insert_with(|| unescape(raw));
                }
                break;
            }
        }
    }
    out
}

/// Unescape exactly the five XML predefined entities plus numeric character references
/// (`&#NN;` / `&#xHH;`) in a leaf value. Deliberately NOT recursive (an unescaped `&amp;amp;`
/// becomes `&amp;`, not `&`) - this is what makes the function immune to entity-expansion /
/// "billion laughs"-style blowup by construction, not by a depth limit. An unrecognised or
/// malformed entity (including a stray `&` with no `;` within `ENTITY_SEARCH_WINDOW`) is left
/// exactly as written. CDATA is not supported (OFX/QFX do not use it in practice).
fn unescape(value: &str) -> String {
    if !value.as_bytes().contains(&b'&') {
        return value.to_string();
    }
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let tail = &rest[amp..];
        // Search window is bounded by CHAR index, not raw byte offset: slicing at a fixed byte
        // count can land inside a multibyte UTF-8 character and panic. `char_indices` only ever
        // yields char-boundary offsets, so `semi` (if found) is always safe to slice at.
        let semi = tail
            .char_indices()
            .take_while(|(i, _)| *i < ENTITY_SEARCH_WINDOW)
            .find(|(_, c)| *c == ';')
            .map(|(i, _)| i);
        let Some(semi) = semi else {
            // No plausible entity terminator nearby - treat '&' as a literal character.
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let entity = &tail[..=semi];
        let resolved = match entity {
            "&amp;" => Some('&'),
            "&lt;" => Some('<'),
            "&gt;" => Some('>'),
            "&quot;" => Some('"'),
            "&apos;" => Some('\''),
            _ if entity.starts_with("&#") => {
                let inner = &entity[2..entity.len() - 1];
                let code = match inner.strip_prefix('x').or_else(|| inner.strip_prefix('X')) {
                    Some(hex) => u32::from_str_radix(hex, 16).ok(),
                    None => inner.parse::<u32>().ok(),
                };
                code.and_then(char::from_u32)
            }
            _ => None,
        };
        match resolved {
            Some(c) => out.push(c),
            // Unrecognised/malformed entity: keep it verbatim, no expansion, no recursion.
            None => out.push_str(entity),
        }
        rest = &tail[entity.len()..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- OFX 2.x XML (closed tags) --------------------------------------------------------

    const OFX2_XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<OFX>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <STMTRS>
        <CURDEF>MUR</CURDEF>
        <BANKTRANLIST>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20260601120000[-5:EST]</DTPOSTED>
            <TRNAMT>-450.00</TRNAMT>
            <FITID>2026060100123</FITID>
            <NAME>AT&amp;T Wireless</NAME>
            <MEMO>Monthly bill</MEMO>
          </STMTTRN>
          <STMTTRN>
            <TRNTYPE>CREDIT</TRNTYPE>
            <DTPOSTED>20260605</DTPOSTED>
            <TRNAMT>2000.00</TRNAMT>
            <FITID>2026060500456</FITID>
            <NAME>Salary</NAME>
          </STMTTRN>
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>"#;

    #[test]
    fn parses_ofx2_xml_dialect() {
        let parsed = parse_ofx(OFX2_XML.as_bytes()).unwrap();
        assert!(parsed.row_errors.is_empty(), "{:?}", parsed.row_errors);
        assert_eq!(parsed.transactions.len(), 2);

        let first = &parsed.transactions[0].staged;
        assert_eq!(first.amount_minor, -45_000);
        assert_eq!(first.currency, "MUR");
        // Time + tz suffix is ignored; only the yyyymmdd digits are used.
        assert_eq!(first.posted_date, "2026-06-01");
        assert_eq!(first.payee.as_deref(), Some("AT&T Wireless"));
        assert_eq!(first.note.as_deref(), Some("Monthly bill"));
        assert_eq!(first.source_ref.as_deref(), Some("2026060100123"));

        let second = &parsed.transactions[1].staged;
        assert_eq!(second.amount_minor, 200_000);
        assert_eq!(second.posted_date, "2026-06-05");
        assert_eq!(second.note, None);
    }

    // ---- OFX 1.x SGML (unclosed leaf tags) --------------------------------------------------

    const OFX1_SGML: &str = "OFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:102\r\n\r\n<OFX>\
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MUR\
<BANKTRANLIST>\
<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>20260603\n<TRNAMT>-125.50\n<FITID>SGML001\n<NAME>Supermarket\n<MEMO>groceries\n</STMTTRN>\n\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

    #[test]
    fn parses_ofx1_sgml_dialect_with_unclosed_leaves() {
        let parsed = parse_ofx(OFX1_SGML.as_bytes()).unwrap();
        assert!(parsed.row_errors.is_empty(), "{:?}", parsed.row_errors);
        assert_eq!(parsed.transactions.len(), 1);

        let tx = &parsed.transactions[0].staged;
        assert_eq!(tx.amount_minor, -12_550);
        assert_eq!(tx.currency, "MUR");
        assert_eq!(tx.posted_date, "2026-06-03");
        assert_eq!(tx.payee.as_deref(), Some("Supermarket"));
        assert_eq!(tx.note.as_deref(), Some("groceries"));
        assert_eq!(tx.source_ref.as_deref(), Some("SGML001"));
    }

    // ---- QFX (Intuit tags interspersed, ignored) --------------------------------------------

    const QFX_SAMPLE: &str = "<OFX><SIGNONMSGSRSV1><SONRS><INTU.BID>1234</SONRS></SIGNONMSGSRSV1>\
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD\
<BANKTRANLIST>\
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260610<TRNAMT>-19.99<FITID>QFX-1<NAME>Streaming Co<INTU.SC>1234</STMTTRN>\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

    #[test]
    fn parses_qfx_ignoring_intuit_tags() {
        let parsed = parse_ofx(QFX_SAMPLE.as_bytes()).unwrap();
        assert!(parsed.row_errors.is_empty(), "{:?}", parsed.row_errors);
        assert_eq!(parsed.transactions.len(), 1);

        let tx = &parsed.transactions[0].staged;
        assert_eq!(tx.amount_minor, -1_999);
        assert_eq!(tx.currency, "USD");
        assert_eq!(tx.payee.as_deref(), Some("Streaming Co"));
    }

    // ---- CCSTMTTRN alias ---------------------------------------------------------------------

    #[test]
    fn ccstmttrn_alias_is_parsed_like_stmttrn() {
        let ofx = "<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>MUR\
<BANKTRANLIST>\
<CCSTMTTRN><DTPOSTED>20260701<TRNAMT>-75.00<FITID>CC-1<NAME>Fuel</CCSTMTTRN>\
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>";

        let parsed = parse_ofx(ofx.as_bytes()).unwrap();
        assert_eq!(parsed.transactions.len(), 1);
        assert_eq!(parsed.transactions[0].staged.amount_minor, -7_500);
    }

    // ---- Multiple STMTTRN blocks (already covered above, explicit count check) --------------

    #[test]
    fn multiple_transactions_in_one_file_are_all_parsed() {
        let parsed = parse_ofx(OFX2_XML.as_bytes()).unwrap();
        assert_eq!(parsed.transactions.len(), 2);
    }

    // ---- Entity unescape ----------------------------------------------------------------------

    #[test]
    fn unescapes_predefined_entities_but_never_recurses() {
        assert_eq!(unescape("AT&amp;T"), "AT&T");
        assert_eq!(unescape("Tom &amp;&amp; Jerry"), "Tom && Jerry");
        assert_eq!(unescape("5 &lt; 10 &gt; 2"), "5 < 10 > 2");
        assert_eq!(unescape(r#"say &quot;hi&quot;"#), "say \"hi\"");
        assert_eq!(unescape("Rock &amp; Roll&apos;s"), "Rock & Roll's");
        assert_eq!(unescape("&#65;&#66;&#x43;"), "ABC");
        // No recursion: a double-escaped ampersand unescapes exactly one level.
        assert_eq!(unescape("&amp;amp;"), "&amp;");
        // Unknown / malformed entities pass through untouched, no panic.
        assert_eq!(unescape("Q&amp;A &foo; &amp"), "Q&A &foo; &amp");
    }

    #[test]
    fn unescape_never_panics_on_multibyte_char_inside_search_window() {
        // A stray '&' followed by 14 ASCII bytes then a multibyte char ('e' with an acute accent,
        // 2 bytes in UTF-8): byte offset 16 (ENTITY_SEARCH_WINDOW) lands inside that char, not on
        // a char boundary. Slicing the search window by raw byte count panics here; slicing by
        // char index does not. No unresolved entity terminator is found, so the '&' and everything
        // after it is left verbatim.
        let value = format!("&{}\u{e9}", "A".repeat(14));
        assert_eq!(unescape(&value), value);
    }

    #[test]
    fn unescape_finds_entity_terminator_that_is_itself_multibyte_adjacent() {
        // The ';' terminator sits right after a multibyte char, well inside the window: still
        // resolved correctly, no panic, no corruption of the preceding character.
        assert_eq!(unescape("caf\u{e9} &amp; croissant"), "caf\u{e9} & croissant");
    }

    #[test]
    fn multibyte_char_after_unresolved_ampersand_does_not_panic_end_to_end() {
        // Reproduces the reported crash through the full `parse_ofx` path: a <NAME> value with an
        // unresolved '&' followed by enough ASCII bytes that a multibyte character straddles the
        // fixed-byte-count search window. Must not panic, and the row is still parsed - payee
        // preserved best-effort (the stray '&' is left verbatim, matching `unescape`'s documented
        // fallback for an unrecognised/unterminated entity).
        let value = format!("&{}\u{e9}", "A".repeat(14));
        let ofx = format!(
            "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MUR<BANKTRANLIST>\
<STMTTRN><DTPOSTED>20260601<TRNAMT>-10.00<FITID>UNI-1<NAME>{value}</STMTTRN>\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"
        );

        let parsed = parse_ofx(ofx.as_bytes()).unwrap();
        assert!(parsed.row_errors.is_empty(), "{:?}", parsed.row_errors);
        assert_eq!(parsed.transactions.len(), 1);
        assert_eq!(parsed.transactions[0].staged.payee.as_deref(), Some(value.as_str()));
    }

    use proptest::prelude::*;

    proptest! {
        #[test]
        fn prop_unescape_never_panics_on_arbitrary_unicode_with_ampersands(
            chars in prop::collection::vec(prop_oneof![Just('&'), any::<char>()], 0..64)
        ) {
            // Must never panic regardless of where '&' falls relative to multibyte characters,
            // and must always produce valid UTF-8 (guaranteed by the type; asserting the final
            // byte index is a char boundary is a cheap sanity check that nothing corrupted it).
            let s: String = chars.into_iter().collect();
            let result = unescape(&s);
            prop_assert!(result.is_char_boundary(result.len()));
        }
    }

    // ---- Currency resolution ------------------------------------------------------------------

    #[test]
    fn per_transaction_cursym_overrides_statement_curdef() {
        let ofx = "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MUR\
<BANKTRANLIST>\
<STMTTRN><DTPOSTED>20260601<TRNAMT>-10.00<CURRENCY><CURSYM>USD<CURRATE>1.00</CURRENCY><FITID>1</STMTTRN>\
<STMTTRN><DTPOSTED>20260602<TRNAMT>-20.00<FITID>2</STMTTRN>\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

        let parsed = parse_ofx(ofx.as_bytes()).unwrap();
        assert!(parsed.row_errors.is_empty(), "{:?}", parsed.row_errors);
        assert_eq!(parsed.transactions[0].staged.currency, "USD");
        assert_eq!(parsed.transactions[1].staged.currency, "MUR");
    }

    #[test]
    fn no_currency_anywhere_is_a_structural_error() {
        let ofx = "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>\
<BANKTRANLIST>\
<STMTTRN><DTPOSTED>20260601<TRNAMT>-10.00<FITID>1</STMTTRN>\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

        assert_eq!(parse_ofx(ofx.as_bytes()), Err(OfxError::NoCurrency));
    }

    #[test]
    fn empty_statement_with_no_transactions_is_not_an_error() {
        let ofx = "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MUR\
<BANKTRANLIST></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";
        let parsed = parse_ofx(ofx.as_bytes()).unwrap();
        assert!(parsed.transactions.is_empty());
        assert!(parsed.row_errors.is_empty());
    }

    #[test]
    fn each_statement_aggregate_resolves_its_own_curdef() {
        // A combined "download all accounts" export: a MUR bank statement followed by a USD
        // credit-card statement, each with its own CURDEF and neither transaction carrying a
        // per-tx CURRENCY override. Every transaction after the first must NOT inherit the first
        // statement's CURDEF.
        let ofx = "<OFX>\
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MUR<BANKTRANLIST>\
<STMTTRN><DTPOSTED>20260601<TRNAMT>-10.00<FITID>BANK-1</STMTTRN>\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1>\
<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>USD<BANKTRANLIST>\
<CCSTMTTRN><DTPOSTED>20260602<TRNAMT>-20.00<FITID>CARD-1</CCSTMTTRN>\
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>\
</OFX>";

        let parsed = parse_ofx(ofx.as_bytes()).unwrap();
        assert!(parsed.row_errors.is_empty(), "{:?}", parsed.row_errors);
        assert_eq!(parsed.transactions.len(), 2);
        assert_eq!(parsed.transactions[0].staged.currency, "MUR");
        assert_eq!(parsed.transactions[1].staged.currency, "USD");
        // The running RowError/transaction index stays a single 0-based ordinal across the whole
        // file, in document order, regardless of which statement a transaction came from.
        assert_eq!(parsed.transactions[0].staged.source_ref.as_deref(), Some("BANK-1"));
        assert_eq!(parsed.transactions[1].staged.source_ref.as_deref(), Some("CARD-1"));
    }

    #[test]
    fn per_transaction_cursym_still_overrides_its_own_statements_curdef_in_multi_statement_file() {
        let ofx = "<OFX>\
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MUR<BANKTRANLIST>\
<STMTTRN><DTPOSTED>20260601<TRNAMT>-10.00<FITID>BANK-1</STMTTRN>\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1>\
<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>USD<BANKTRANLIST>\
<CCSTMTTRN><DTPOSTED>20260602<TRNAMT>-20.00<CURRENCY><CURSYM>EUR<CURRATE>1.00</CURRENCY><FITID>CARD-1</CCSTMTTRN>\
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>\
</OFX>";

        let parsed = parse_ofx(ofx.as_bytes()).unwrap();
        assert!(parsed.row_errors.is_empty(), "{:?}", parsed.row_errors);
        assert_eq!(parsed.transactions[0].staged.currency, "MUR");
        // Overrides the CCSTMTRS's own USD CURDEF, not the first statement's MUR.
        assert_eq!(parsed.transactions[1].staged.currency, "EUR");
    }

    #[test]
    fn statement_with_no_curdef_falls_back_to_row_error_when_another_statement_has_currency() {
        // The first statement resolves fine; the second has neither CURDEF nor a per-tx CURSYM, so
        // its transaction becomes a per-row error rather than failing the whole file (some other
        // row in the file DID resolve a currency).
        let ofx = "<OFX>\
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MUR<BANKTRANLIST>\
<STMTTRN><DTPOSTED>20260601<TRNAMT>-10.00<FITID>BANK-1</STMTTRN>\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1>\
<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>\
<CCSTMTTRN><DTPOSTED>20260602<TRNAMT>-20.00<FITID>CARD-1</CCSTMTTRN>\
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>\
</OFX>";

        let parsed = parse_ofx(ofx.as_bytes()).unwrap();
        assert_eq!(parsed.transactions.len(), 1);
        assert_eq!(parsed.transactions[0].staged.currency, "MUR");
        assert_eq!(parsed.row_errors.len(), 1);
        assert_eq!(parsed.row_errors[0].source_ref.as_deref(), Some("CARD-1"));
        // Global index continues across statements: this is the second tx in the file.
        assert_eq!(parsed.row_errors[0].index, 1);
    }

    // ---- Row-level errors: reported, never dropped, never panicking --------------------------

    #[test]
    fn too_precise_amount_is_a_row_error_not_a_panic() {
        let ofx = "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MUR\
<BANKTRANLIST>\
<STMTTRN><DTPOSTED>20260601<TRNAMT>-10.005<FITID>BAD-1</STMTTRN>\
<STMTTRN><DTPOSTED>20260602<TRNAMT>-10.00<FITID>OK-1</STMTTRN>\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

        let parsed = parse_ofx(ofx.as_bytes()).unwrap();
        assert_eq!(parsed.transactions.len(), 1);
        assert_eq!(parsed.row_errors.len(), 1);
        let row_err = &parsed.row_errors[0];
        assert_eq!(row_err.index, 0);
        assert_eq!(row_err.source_ref.as_deref(), Some("BAD-1"));
        // Structural message only - never echoes the malformed amount text.
        assert!(!row_err.message.contains("10.005"));
    }

    #[test]
    fn invalid_calendar_date_is_a_row_error() {
        let ofx = "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MUR\
<BANKTRANLIST>\
<STMTTRN><DTPOSTED>20260230<TRNAMT>-10.00<FITID>BADDATE</STMTTRN>\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

        let parsed = parse_ofx(ofx.as_bytes()).unwrap();
        assert!(parsed.transactions.is_empty());
        assert_eq!(parsed.row_errors.len(), 1);
        assert_eq!(parsed.row_errors[0].source_ref.as_deref(), Some("BADDATE"));
    }

    #[test]
    fn missing_fitid_is_kept_with_source_ref_none() {
        let ofx = "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MUR\
<BANKTRANLIST>\
<STMTTRN><DTPOSTED>20260601<TRNAMT>-10.00<NAME>Cash withdrawal</STMTTRN>\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

        let parsed = parse_ofx(ofx.as_bytes()).unwrap();
        assert_eq!(parsed.transactions.len(), 1);
        assert_eq!(parsed.transactions[0].staged.source_ref, None);
        assert_eq!(parsed.transactions[0].staged.payee.as_deref(), Some("Cash withdrawal"));
    }

    #[test]
    fn missing_amount_is_a_row_error() {
        let ofx = "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MUR\
<BANKTRANLIST>\
<STMTTRN><DTPOSTED>20260601<FITID>NOAMT</STMTTRN>\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

        let parsed = parse_ofx(ofx.as_bytes()).unwrap();
        assert!(parsed.transactions.is_empty());
        assert_eq!(parsed.row_errors.len(), 1);
    }

    #[test]
    fn missing_date_is_a_row_error() {
        let ofx = "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MUR\
<BANKTRANLIST>\
<STMTTRN><TRNAMT>-10.00<FITID>NODATE</STMTTRN>\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

        let parsed = parse_ofx(ofx.as_bytes()).unwrap();
        assert!(parsed.transactions.is_empty());
        assert_eq!(parsed.row_errors.len(), 1);
    }

    #[test]
    fn leading_plus_sign_is_stripped_before_parsing() {
        let ofx = "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MUR\
<BANKTRANLIST>\
<STMTTRN><DTPOSTED>20260601<TRNAMT>+50.00<FITID>PLUS-1</STMTTRN>\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

        let parsed = parse_ofx(ofx.as_bytes()).unwrap();
        assert!(parsed.row_errors.is_empty(), "{:?}", parsed.row_errors);
        assert_eq!(parsed.transactions[0].staged.amount_minor, 5_000);
    }

    #[test]
    fn zero_decimal_currency_amount_has_no_scaling_applied() {
        // JPY has 0 minor-unit decimal places: a whole-number TRNAMT (no decimal point) must map
        // 1:1 to amount_minor, exercising parse_minor's per-currency scale through the OFX path.
        let ofx = "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>JPY\
<BANKTRANLIST>\
<STMTTRN><DTPOSTED>20260601<TRNAMT>-450<FITID>JPY-1</STMTTRN>\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

        let parsed = parse_ofx(ofx.as_bytes()).unwrap();
        assert!(parsed.row_errors.is_empty(), "{:?}", parsed.row_errors);
        assert_eq!(parsed.transactions[0].staged.amount_minor, -450);
        assert_eq!(parsed.transactions[0].staged.currency, "JPY");
    }

    #[test]
    fn three_decimal_currency_amount_scales_correctly() {
        // BHD has 3 minor-unit decimal places.
        let ofx = "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BHD\
<BANKTRANLIST>\
<STMTTRN><DTPOSTED>20260601<TRNAMT>-1.234<FITID>BHD-1</STMTTRN>\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

        let parsed = parse_ofx(ofx.as_bytes()).unwrap();
        assert!(parsed.row_errors.is_empty(), "{:?}", parsed.row_errors);
        assert_eq!(parsed.transactions[0].staged.amount_minor, -1_234);
        assert_eq!(parsed.transactions[0].staged.currency, "BHD");
    }

    // ---- File-level structural failures --------------------------------------------------------

    #[test]
    fn not_ofx_content_is_rejected() {
        assert_eq!(parse_ofx(b"just some plain text, not a bank file at all"), Err(OfxError::NotOfx));
        assert_eq!(parse_ofx(b""), Err(OfxError::NotOfx));
    }

    #[test]
    fn oversized_input_is_rejected_before_scanning() {
        let mut huge = Vec::with_capacity(MAX_INPUT_BYTES + 1);
        huge.resize(MAX_INPUT_BYTES + 1, b'x');
        assert_eq!(parse_ofx(&huge), Err(OfxError::TooLarge));
    }

    #[test]
    fn too_many_transaction_blocks_is_rejected_before_normalising_rows() {
        let one = "<STMTTRN><DTPOSTED>20260601<TRNAMT>-1.00<FITID>1</STMTTRN>";
        let mut body = String::from("<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MUR<BANKTRANLIST>");
        for _ in 0..=MAX_TRANSACTIONS {
            body.push_str(one);
        }
        body.push_str("</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>");
        assert_eq!(parse_ofx(body.as_bytes()), Err(OfxError::TooManyTransactions));
    }

    // ---- Snapshot: representative multi-transaction file ----------------------------------------

    #[test]
    fn ofx2_multi_transaction_snapshot() {
        let parsed = parse_ofx(OFX2_XML.as_bytes()).unwrap();
        insta::assert_debug_snapshot!("ofx2_multi_transaction_parse", parsed);
    }

    // ---- Property: signed amount round-trips through parse_minor for a resolvable currency -----

    proptest! {
        #[test]
        fn prop_trnamt_roundtrips_through_parse_minor(minor in -1_000_000_000i64..1_000_000_000) {
            let sign = if minor < 0 { "-" } else { "" };
            let abs = minor.unsigned_abs();
            let major = format!("{sign}{}.{:02}", abs / 100, abs % 100);
            let ofx = format!(
                "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MUR\
<BANKTRANLIST><STMTTRN><DTPOSTED>20260601<TRNAMT>{major}<FITID>PROP-1</STMTTRN>\
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"
            );
            let parsed = parse_ofx(ofx.as_bytes()).unwrap();
            prop_assert_eq!(parsed.row_errors.len(), 0);
            prop_assert_eq!(parsed.transactions.len(), 1);
            prop_assert_eq!(parsed.transactions[0].staged.amount_minor, minor);
        }
    }
}
