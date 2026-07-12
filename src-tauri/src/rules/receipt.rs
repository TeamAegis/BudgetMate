//! Deterministic receipt field extraction (FR-2.1). Turns raw OCR blocks into
//! `{ merchant, date, total }` using regex + heuristics - NO ML inference makes the decision.
//! The result is always shown to the user for confirmation before anything is saved.
//!
//! Amounts are returned as integer minor units in a FIXED 2-decimal print scale (the regex requires
//! exactly two fraction digits, so `total_minor == printedReceiptValue * 100` regardless of the
//! account currency). The frontend rescales this to the base currency's own minor-unit scale (0
//! decimals for currencies like JPY, 3 for BHD, and so on) before handing it to the transaction
//! form; the user confirms the value and the account currency is applied on save.

use chrono::NaiveDate;
use serde::Serialize;
use std::sync::OnceLock;
use tauri_plugin_ocr::{BBox, OcrBlock};

use regex::Regex;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedReceipt {
    pub merchant: Option<String>,
    /// ISO-8601 `yyyy-mm-dd`.
    pub date: Option<String>,
    /// Total in minor units, in a FIXED 2-decimal print scale (printedValue * 100) - NOT
    /// necessarily the account currency's own minor-unit scale. The frontend rescales this to
    /// the base currency's minor units before use (see the module doc above).
    pub total_minor: Option<i64>,
}

fn amount_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // Optional currency symbol, grouped integer part, required 2-decimal fraction.
    RE.get_or_init(|| {
        Regex::new(r"(?:[$£€]\s?)?(\d{1,3}(?:[,\s]\d{3})+|\d+)[.,](\d{2})\b").unwrap()
    })
}

fn iso_date_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\b(\d{4})-(\d{2})-(\d{2})\b").unwrap())
}

fn slashed_date_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b").unwrap())
}

/// All amounts on a line (minor units), in order.
fn all_amounts_minor(line: &str) -> Vec<i64> {
    amount_re()
        .captures_iter(line)
        .filter_map(|caps| {
            let int_part: String = caps[1].chars().filter(|c| c.is_ascii_digit()).collect();
            format!("{int_part}{}", &caps[2]).parse::<i64>().ok()
        })
        .collect()
}

fn normalise_year(y: i32) -> i32 {
    if y < 100 {
        2000 + y
    } else {
        y
    }
}

/// Pick the most recent plausible date (not in the future, within ~2 years) from a line.
fn parse_plausible_date(line: &str, today: NaiveDate) -> Option<NaiveDate> {
    let earliest = today - chrono::Duration::days(730);
    let mut best: Option<NaiveDate> = None;
    let mut consider = |d: NaiveDate| {
        if d <= today && d >= earliest && best.map(|b| d > b).unwrap_or(true) {
            best = Some(d);
        }
    };

    if let Some(c) = iso_date_re().captures(line) {
        if let (Ok(y), Ok(m), Ok(d)) =
            (c[1].parse::<i32>(), c[2].parse::<u32>(), c[3].parse::<u32>())
        {
            if let Some(date) = NaiveDate::from_ymd_opt(y, m, d) {
                consider(date);
            }
        }
    }

    if let Some(c) = slashed_date_re().captures(line) {
        let a: u32 = c[1].parse().ok()?;
        let b: u32 = c[2].parse().ok()?;
        let y = normalise_year(c[3].parse::<i32>().ok()?);
        // Ambiguous: try day/month and month/day; keep whichever is valid + plausible.
        for (d, m) in [(a, b), (b, a)] {
            if let Some(date) = NaiveDate::from_ymd_opt(y, m, d) {
                consider(date);
            }
        }
    }
    best
}

fn is_total_keyword_line(lower: &str) -> bool {
    let positive = ["total", "amount due", "balance due", "grand total"];
    positive.iter().any(|k| lower.contains(k)) && !is_excluded_line(lower)
}

/// Lines whose amounts must never be treated as the total: tax/subtotal breakdowns and,
/// crucially, cash-tendered / change lines (e.g. Mauritian "ESPECES" / "Rendu").
fn is_excluded_line(lower: &str) -> bool {
    const EXCLUDED: &[&str] = &[
        "subtotal", "sub total", "sub-total", "tax", "vat", "gst", "change", "especes", "espèces",
        "cash", "tendered", "rendered", "rendu", "paid",
    ];
    EXCLUDED.iter().any(|k| lower.contains(k))
}

fn looks_like_address_or_noise(lower: &str) -> bool {
    let digit_count = lower.chars().filter(|c| c.is_ascii_digit()).count();
    let len = lower.chars().count().max(1);
    // Mostly digits (phone/receipt no.), or obvious address/contact noise.
    digit_count * 2 >= len
        || ["tel", "phone", "receipt", "invoice", "www.", "@", "street", "ave", "road", "st."]
            .iter()
            .any(|k| lower.contains(k))
}

/// Two blocks are on the same printed row when their vertical bbox spans overlap. We require a
/// real overlap (not mere proximity) so item rows above/below the TOTAL row are not mis-paired.
fn rows_aligned(a: &BBox, b: &BBox) -> bool { // guard:allow-float (OCR bbox coordinates)
    let a_top = a.y;
    let a_bot = a.y + a.h;
    let b_top = b.y;
    let b_bot = b.y + b.h;
    a_top < b_bot && b_top < a_bot
}

/// Pick the receipt total from OCR blocks using their geometry.
///
/// 1. If a total-keyword block carries an amount inline (the classic "TOTAL 20.00" layout), use
///    the largest such amount.
/// 2. Otherwise, for each keyword block with no inline amount, find amount-bearing blocks whose
///    bbox row overlaps the keyword's row, preferring the nearest one to its right (the amount
///    column). Take the largest amount among row-aligned candidates.
/// 3. Fall back to the largest amount anywhere, ignoring excluded (tax/cash/change) lines.
fn extract_total(blocks: &[OcrBlock]) -> Option<i64> {
    let mut keyword_total: Option<i64> = None;
    let mut max_overall: Option<i64> = None;

    for kb in blocks {
        let lower = kb.text.to_lowercase();
        if !is_total_keyword_line(&lower) {
            continue;
        }
        // Same-block / same-line case (e.g. "TOTAL 20.00").
        let inline = all_amounts_minor(&kb.text);
        if let Some(&m) = inline.iter().max() {
            keyword_total = Some(keyword_total.map_or(m, |k| k.max(m)));
            continue;
        }
        // Keyword block with no amount: associate the amount on its row, preferring the right.
        let mut best: Option<(f32, i64)> = None; // guard:allow-float (bbox x for right-preference)
        for ab in blocks {
            if std::ptr::eq(ab, kb) || !rows_aligned(&kb.bbox, &ab.bbox) {
                continue;
            }
            if is_excluded_line(&ab.text.to_lowercase()) {
                continue;
            }
            for amt in all_amounts_minor(&ab.text) {
                // Prefer the rightmost candidate to the right of the keyword; among equals, the
                // larger amount. Candidates to the left are still allowed but ranked behind.
                let to_right = ab.bbox.x >= kb.bbox.x;
                let rank = if to_right { ab.bbox.x } else { f32::MIN }; // guard:allow-float
                let better = match best {
                    None => true,
                    Some((br, ba)) => rank > br || (rank == br && amt > ba),
                };
                if better {
                    best = Some((rank, amt));
                }
            }
        }
        if let Some((_, amt)) = best {
            keyword_total = Some(keyword_total.map_or(amt, |k| k.max(amt)));
        }
    }

    for b in blocks {
        if is_excluded_line(&b.text.to_lowercase()) {
            continue;
        }
        for amt in all_amounts_minor(&b.text) {
            max_overall = Some(max_overall.map_or(amt, |m| m.max(amt)));
        }
    }

    keyword_total.or(max_overall)
}

/// Extract merchant/date/total from OCR blocks. `today` is injected for deterministic tests.
pub fn extract(blocks: &[OcrBlock], today: NaiveDate) -> ExtractedReceipt {
    // Flatten into (y, line) pairs so we can reason top-to-bottom.
    let mut lines: Vec<(f32, String)> = Vec::new(); // guard:allow-float (OCR bbox y-coordinate)
    for b in blocks {
        for raw in b.text.split('\n') {
            let line = raw.trim();
            if !line.is_empty() {
                lines.push((b.bbox.y, line.to_string()));
            }
        }
    }

    // ── Total: prefer the amount on/aligned-with a total-keyword block; else largest overall. ──
    //
    // Real receipts (and ML Kit's block output) often split the "TOTAL" label and its amount
    // into separate OcrBlocks because of the wide left-label/right-amount column gap, so the
    // keyword block carries no amount of its own. We therefore reason over blocks (keeping their
    // geometry) and, for a keyword block with no inline amount, spatially associate the amount
    // block sharing its row. Cash-tendered / change lines (ESPECES, Rendu, …) are excluded so
    // they never win - neither as a keyword total nor via the largest-overall fallback.
    let total_minor = extract_total(blocks);

    // ── Date: most recent plausible date anywhere on the receipt. ──
    let mut date: Option<NaiveDate> = None;
    for (_, line) in &lines {
        if let Some(d) = parse_plausible_date(line, today) {
            if date.map(|cur| d > cur).unwrap_or(true) {
                date = Some(d);
            }
        }
    }

    // ── Merchant: top-most non-noise line. ──
    let mut sorted = lines.clone();
    sorted.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let merchant = sorted
        .iter()
        .map(|(_, l)| l)
        .find(|l| !looks_like_address_or_noise(&l.to_lowercase()))
        .cloned();

    ExtractedReceipt {
        merchant,
        date: date.map(|d| d.format("%Y-%m-%d").to_string()),
        total_minor,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(text: &str, y: f32) -> OcrBlock { // guard:allow-float (y = OCR pixel coordinate)
        block_at(text, 0.0, y)
    }

    /// A block at an explicit (x, y) - used to model left-label / right-amount column layouts.
    fn block_at(text: &str, x: f32, y: f32) -> OcrBlock { // guard:allow-float (OCR coordinates)
        OcrBlock {
            text: text.to_string(),
            bbox: BBox { x, y, w: 100.0, h: 10.0 },
            confidence: 0.9,
        }
    }

    #[test]
    fn extracts_merchant_date_total_from_typical_receipt() {
        let blocks = vec![
            block("WHOLE FOODS MARKET", 0.0),
            block("123 Main Street", 12.0),
            block("Date: 03/04/2026", 40.0),
            block("Subtotal  18.00", 60.0),
            block("Tax        2.00", 70.0),
            block("TOTAL     20.00", 80.0),
        ];
        let today = NaiveDate::from_ymd_opt(2026, 6, 5).unwrap();
        let r = extract(&blocks, today);
        assert_eq!(r.merchant.as_deref(), Some("WHOLE FOODS MARKET"));
        assert_eq!(r.total_minor, Some(2000)); // 20.00, not the 18.00 subtotal
        assert_eq!(r.date.as_deref(), Some("2026-04-03")); // 03/04 = 3 April or 4 March; algorithm picks most-recent = April 3 (2026-04-03)
    }

    #[test]
    fn falls_back_to_largest_amount_without_total_keyword() {
        let blocks = vec![block("Coffee 3.50", 0.0), block("Muffin 2.25", 10.0)];
        let today = NaiveDate::from_ymd_opt(2026, 6, 5).unwrap();
        let r = extract(&blocks, today);
        assert_eq!(r.total_minor, Some(350));
    }

    #[test]
    fn ignores_future_and_implausible_dates() {
        let blocks = vec![block("Date 01/01/2099", 0.0), block("TOTAL 9.99", 10.0)];
        let today = NaiveDate::from_ymd_opt(2026, 6, 5).unwrap();
        let r = extract(&blocks, today);
        assert_eq!(r.date, None);
        assert_eq!(r.total_minor, Some(999));
    }

    #[test]
    fn winners_receipt_keyword_and_amount_in_separate_blocks() {
        // Real Mauritian WINNERS receipt: ML Kit splits the left label column and the right
        // amount column into separate blocks. The TOTAL is 138.00 Rs; 200.00 is ESPECES (cash
        // tendered) and 62.00 is Rendu (change) - neither must win.
        let blocks = vec![
            block("WINNERS", 0.0),
            // Item lines (label left, amount right) on their own rows.
            block_at("Bread", 0.0, 30.0),
            block_at("22.00 Rs", 200.0, 30.0),
            block_at("Milk", 0.0, 40.0),
            block_at("22.00 Rs", 200.0, 40.0),
            block_at("Rice", 0.0, 50.0),
            block_at("94.00 Rs", 200.0, 50.0),
            // VAT breakdown lines (excluded).
            block_at("VAT 0%", 0.0, 60.0),
            block_at("44.00 0.00", 200.0, 60.0),
            block_at("VAT 15%", 0.0, 70.0),
            block_at("94.00 12.26", 200.0, 70.0),
            // The crux: TOTAL label and its amount in SEPARATE blocks, same row.
            block_at("TOTAL", 0.0, 90.0),
            block_at("138.00 Rs", 200.0, 90.0),
            // Cash tendered + change, also split across blocks, on lower rows.
            block_at("ESPECES", 0.0, 100.0),
            block_at("200.00 Rs", 200.0, 100.0),
            block_at("Rendu ESPECES", 0.0, 110.0),
            block_at("62.00 Rs", 200.0, 110.0),
        ];
        let today = NaiveDate::from_ymd_opt(2026, 6, 5).unwrap();
        let r = extract(&blocks, today);
        // Must be the TOTAL row's amount, not the larger cash-tendered 200.00.
        assert_eq!(r.total_minor, Some(13800));
    }

    #[test]
    fn total_label_block_with_amount_block_to_the_right() {
        // Minimal "label left, amount right" layout - exercises row-alignment association
        // distinctly from the same-block case.
        let blocks = vec![
            block_at("Item A", 0.0, 10.0),
            block_at("50.00", 200.0, 10.0),
            block_at("TOTAL", 0.0, 20.0),
            block_at("75.00", 200.0, 20.0),
        ];
        let today = NaiveDate::from_ymd_opt(2026, 6, 5).unwrap();
        let r = extract(&blocks, today);
        assert_eq!(r.total_minor, Some(7500));
    }

    #[test]
    fn empty_input_yields_empty_result() {
        let today = NaiveDate::from_ymd_opt(2026, 6, 5).unwrap();
        assert_eq!(extract(&[], today), ExtractedReceipt::default());
    }
}
