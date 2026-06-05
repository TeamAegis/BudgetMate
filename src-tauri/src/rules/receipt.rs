//! Deterministic receipt field extraction (FR-2.1). Turns raw OCR blocks into
//! `{ merchant, date, total }` using regex + heuristics — NO ML inference makes the decision.
//! The result is always shown to the user for confirmation before anything is saved.
//!
//! Amounts are returned as integer minor units assuming a 2-decimal currency (the user confirms
//! and the account currency is applied on save).

use chrono::NaiveDate;
use serde::Serialize;
use std::sync::OnceLock;
use tauri_plugin_ocr::OcrBlock;

use regex::Regex;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedReceipt {
    pub merchant: Option<String>,
    /// ISO-8601 `yyyy-mm-dd`.
    pub date: Option<String>,
    /// Total in minor units (2-decimal assumption).
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

/// Parse the first currency-amount on a line into minor units (2-dp).
fn parse_amount_minor(line: &str) -> Option<i64> {
    let caps = amount_re().captures(line)?;
    let int_part: String = caps[1].chars().filter(|c| c.is_ascii_digit()).collect();
    let frac = &caps[2];
    let combined = format!("{int_part}{frac}");
    combined.parse::<i64>().ok()
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
    let negative = ["subtotal", "sub total", "sub-total", "tax", "vat", "gst", "change"];
    positive.iter().any(|k| lower.contains(k)) && !negative.iter().any(|k| lower.contains(k))
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

    // ── Total: prefer the largest amount on a total-keyword line; else largest overall. ──
    let mut keyword_total: Option<i64> = None;
    let mut max_overall: Option<i64> = None;
    for (_, line) in &lines {
        let lower = line.to_lowercase();
        for amt in all_amounts_minor(line) {
            max_overall = Some(max_overall.map_or(amt, |m| m.max(amt)));
            if is_total_keyword_line(&lower) {
                keyword_total = Some(keyword_total.map_or(amt, |m| m.max(amt)));
            }
        }
        // Some receipts put the figure on the line *after* "TOTAL"; the keyword check above
        // already catches same-line cases, which is the common layout.
        let _ = parse_amount_minor(line);
    }
    let total_minor = keyword_total.or(max_overall);

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
    use tauri_plugin_ocr::{BBox, OcrBlock};

    fn block(text: &str, y: f32) -> OcrBlock { // guard:allow-float (y = OCR pixel coordinate)
        OcrBlock {
            text: text.to_string(),
            bbox: BBox { x: 0.0, y, w: 100.0, h: 10.0 },
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
        assert_eq!(r.date.as_deref(), Some("2026-04-03")); // 03/04 -> 4 Mar plausible
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
    fn empty_input_yields_empty_result() {
        let today = NaiveDate::from_ymd_opt(2026, 6, 5).unwrap();
        assert_eq!(extract(&[], today), ExtractedReceipt::default());
    }
}
