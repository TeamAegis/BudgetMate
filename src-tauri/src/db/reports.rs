//! Analytics aggregation query (FR-3.3). Joins `tx_splits -> transactions -> categories` for
//! EXPENSE splits only, excludes `pending_review` (unconfirmed dedup) rows, converts every split to
//! base-currency minor units via its parent transaction's `fx_rate`, and hands the resulting rows to
//! the pure aggregators in `domain::report`. All money conversion and date bucketing happens in
//! Rust; the SQL only selects and filters rows.

use std::str::FromStr;

use chrono::NaiveDate;
use rusqlite::{params, Connection};
use rust_decimal::Decimal;

use super::DbError;
use crate::domain::money::base_amount_minor;
use crate::domain::report::{
    choose_granularity, spend_by_category, spend_over_time, ReportData, ReportPeriod, SpendRow,
};

const ISO_DATE: &str = "%Y-%m-%d";

/// Run the Analytics aggregation for `period` (already resolved to `[start, end)` in `bounds`;
/// `None` for `AllTime`), optionally narrowed to one `category_id`. Returns the `ReportData` DTO
/// the frontend renders. `base_currency` is echoed back verbatim (read from vault settings by the
/// caller - it is NOT derived from the DB).
pub fn report(
    conn: &Connection,
    period: ReportPeriod,
    bounds: Option<(NaiveDate, NaiveDate)>,
    category_id: Option<i64>,
    base_currency: &str,
) -> Result<ReportData, DbError> {
    let (start_param, end_param) = match bounds {
        Some((start, end_excl)) => {
            (Some(start.format(ISO_DATE).to_string()), Some(end_excl.format(ISO_DATE).to_string()))
        }
        None => (None, None),
    };

    let sql = "SELECT s.category_id, c.name AS category_name, s.amount_minor, t.fx_rate, t.posted_date
               FROM tx_splits s
               JOIN transactions t ON t.id = s.transaction_id
               JOIN categories c ON c.id = s.category_id
               WHERE c.kind = 'expense' AND t.pending_review = 0
                 AND (?1 IS NULL OR t.posted_date >= ?1)
                 AND (?2 IS NULL OR t.posted_date < ?2)
                 AND (?3 IS NULL OR s.category_id = ?3)";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![start_param, end_param, category_id], |row| {
        let category_id: i64 = row.get("category_id")?;
        let category_name: String = row.get("category_name")?;
        let amount_minor: i64 = row.get("amount_minor")?;
        let fx_rate: String = row.get("fx_rate")?;
        let posted_date: String = row.get("posted_date")?;
        Ok((category_id, category_name, amount_minor, fx_rate, posted_date))
    })?;

    let mut spend_rows = Vec::new();
    for row in rows {
        let (category_id, category_name, amount_minor, fx_rate, posted_date) = row?;
        // fx_rate is stored as a decimal string (never a float - see domain::transaction).
        let rate = Decimal::from_str(fx_rate.trim()).map_err(|_| {
            DbError::Invalid(format!("invalid fx rate stored on a transaction: {fx_rate}"))
        })?;
        // Splits are signed (negative for expense); base_amount_minor preserves the sign, so take
        // the magnitude as the positive money-out figure the report displays.
        let base = base_amount_minor(amount_minor, rate).abs();
        let date = NaiveDate::parse_from_str(&posted_date, ISO_DATE).map_err(|_| {
            DbError::Invalid(format!("invalid posted date stored on a transaction: {posted_date}"))
        })?;
        spend_rows.push(SpendRow {
            category_id,
            category_name,
            base_amount_minor: base,
            posted_date: date,
        });
    }

    let granularity = choose_granularity(bounds);
    let by_category = spend_by_category(&spend_rows);
    let over_time = spend_over_time(&spend_rows, granularity);
    let total_spend_minor = by_category.iter().map(|c| c.amount_minor).sum();

    Ok(ReportData {
        base_currency: base_currency.to_string(),
        period,
        total_spend_minor,
        by_category,
        over_time,
        granularity,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::transactions::{self, SplitInput, TxInput};
    use crate::domain::report::Granularity;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        super::super::run_migrations(&conn, "2026-07-01T00:00:00Z").unwrap();
        super::super::seed_defaults(&conn).unwrap();
        conn
    }

    // Seeded defaults: account id 1 = Cash (MUR); category 1 = Groceries (expense),
    // 2 = Dining (expense), 9 = Salary (income).

    fn single<'a>(
        posted_date: &'a str,
        amount: &'a str,
        category_id: i64,
        currency: Option<&'a str>,
        fx_rate: Option<&'a str>,
    ) -> TxInput<'a> {
        TxInput {
            account_id: 1,
            posted_date,
            amount,
            currency,
            fx_rate,
            splits: Box::leak(Box::new([SplitInput { category_id, amount }])),
            payee: None,
            note: None,
        }
    }

    #[test]
    fn totals_expense_categories_only_within_bounds() {
        let conn = db();
        transactions::create(&conn, single("2026-07-05", "30.00", 1, None, None), "2026-07-05T00:00:00Z")
            .unwrap();
        transactions::create(&conn, single("2026-07-06", "20.00", 2, None, None), "2026-07-06T00:00:00Z")
            .unwrap();
        // Income must never appear in a spend report.
        transactions::create(&conn, single("2026-07-06", "5000.00", 9, None, None), "2026-07-06T00:00:00Z")
            .unwrap();
        // Outside the bounds - must be excluded.
        transactions::create(&conn, single("2026-06-01", "99.00", 1, None, None), "2026-06-01T00:00:00Z")
            .unwrap();

        let bounds =
            Some((NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(), NaiveDate::from_ymd_opt(2026, 8, 1).unwrap()));
        let data = report(&conn, ReportPeriod::ThisMonth, bounds, None, "MUR").unwrap();

        assert_eq!(data.base_currency, "MUR");
        assert_eq!(data.total_spend_minor, 5_000, "30.00 + 20.00 in minor units, income excluded");
        assert_eq!(data.by_category.len(), 2);
        assert_eq!(data.by_category[0].category_name, "Groceries");
        assert_eq!(data.by_category[0].amount_minor, 3_000);
        assert_eq!(data.by_category[1].category_name, "Dining");
        assert_eq!(data.by_category[1].amount_minor, 2_000);
        assert_eq!(data.granularity, Granularity::Day);
    }

    #[test]
    fn foreign_currency_split_converts_via_its_own_rate() {
        let conn = db();
        // 100.00 USD at rate 45.5 -> base 4550.00 MUR (455_000 minor).
        transactions::create(
            &conn,
            single("2026-07-05", "100.00", 1, Some("USD"), Some("45.5")),
            "2026-07-05T00:00:00Z",
        )
        .unwrap();

        let data = report(&conn, ReportPeriod::AllTime, None, None, "MUR").unwrap();
        assert_eq!(data.total_spend_minor, 455_000);
        assert_eq!(data.by_category[0].amount_minor, 455_000);
    }

    #[test]
    fn pending_review_transactions_are_excluded() {
        let conn = db();
        let t =
            transactions::create(&conn, single("2026-07-05", "30.00", 1, None, None), "2026-07-05T00:00:00Z")
                .unwrap();
        conn.execute("UPDATE transactions SET pending_review = 1 WHERE id = ?1", params![t.id]).unwrap();

        let data = report(&conn, ReportPeriod::AllTime, None, None, "MUR").unwrap();
        assert_eq!(data.total_spend_minor, 0);
        assert!(data.by_category.is_empty());
    }

    #[test]
    fn category_filter_narrows_results() {
        let conn = db();
        transactions::create(&conn, single("2026-07-05", "30.00", 1, None, None), "2026-07-05T00:00:00Z")
            .unwrap();
        transactions::create(&conn, single("2026-07-06", "20.00", 2, None, None), "2026-07-06T00:00:00Z")
            .unwrap();

        let data = report(&conn, ReportPeriod::AllTime, None, Some(1), "MUR").unwrap();
        assert_eq!(data.by_category.len(), 1);
        assert_eq!(data.by_category[0].category_name, "Groceries");
        assert_eq!(data.total_spend_minor, 3_000);
    }

    #[test]
    fn all_time_defaults_to_month_granularity() {
        let conn = db();
        transactions::create(&conn, single("2026-07-05", "30.00", 1, None, None), "2026-07-05T00:00:00Z")
            .unwrap();
        let data = report(&conn, ReportPeriod::AllTime, None, None, "MUR").unwrap();
        assert_eq!(data.granularity, Granularity::Month);
        assert_eq!(data.over_time.len(), 1);
        assert_eq!(data.over_time[0].start_date, "2026-07-01");
    }

    #[test]
    fn no_matching_rows_yields_empty_report() {
        let conn = db();
        let data = report(&conn, ReportPeriod::ThisMonth, None, None, "MUR").unwrap();
        assert_eq!(data.total_spend_minor, 0);
        assert!(data.by_category.is_empty());
        assert!(data.over_time.is_empty());
    }
}
