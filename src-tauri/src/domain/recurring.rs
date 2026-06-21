//! Recurring-rule scheduling (FR-1.3). Pure date logic - no DB, no Tauri - so it is unit-testable.
//! Occurrences are materialised lazily on app open (never a background scheduler, NFR-Perf3); this
//! module computes WHICH dates are due and the next run date, idempotently.

use chrono::{Days, Months, NaiveDate};
use serde::{Deserialize, Serialize};

/// How often a recurring transaction repeats. Mirrors the DB `schedule` text + TS `Schedule`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Schedule {
    Daily,
    Weekly,
    Monthly,
}

impl Schedule {
    pub fn as_str(&self) -> &'static str {
        match self {
            Schedule::Daily => "daily",
            Schedule::Weekly => "weekly",
            Schedule::Monthly => "monthly",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "daily" => Some(Schedule::Daily),
            "weekly" => Some(Schedule::Weekly),
            "monthly" => Some(Schedule::Monthly),
            _ => None,
        }
    }

    /// The next occurrence strictly after `date`. Monthly clamps to the month end (e.g. Jan 31 →
    /// Feb 28/29). Returns `None` only at the extreme ends of the calendar range.
    pub fn next(&self, date: NaiveDate) -> Option<NaiveDate> {
        match self {
            Schedule::Daily => date.checked_add_days(Days::new(1)),
            Schedule::Weekly => date.checked_add_days(Days::new(7)),
            Schedule::Monthly => date.checked_add_months(Months::new(1)),
        }
    }
}

/// The outcome of planning a rule up to `today`: the occurrence dates to materialise now, and the
/// new `next_run_date` (the first occurrence strictly after `today`).
#[derive(Debug, PartialEq, Eq)]
pub struct Plan {
    pub due: Vec<NaiveDate>,
    pub next_run: NaiveDate,
}

/// Compute due occurrences from `next_run` up to and including `today`, skipping any already
/// covered by `last_materialised` (defensive - keeps it idempotent even if the pointers drift).
/// Stepping is bounded so malformed data can never loop forever.
pub fn plan(
    schedule: Schedule,
    next_run: NaiveDate,
    last_materialised: Option<NaiveDate>,
    today: NaiveDate,
) -> Plan {
    let mut due = Vec::new();
    let mut d = next_run;
    let mut guard = 0;
    while d <= today {
        // (avoid Option::is_none_or - newer than the project MSRV 1.80)
        if last_materialised.map_or(true, |lm| d > lm) {
            due.push(d);
        }
        match schedule.next(d) {
            Some(nd) if nd > d => d = nd,
            _ => break,
        }
        guard += 1;
        if guard > 100_000 {
            break;
        }
    }
    Plan { due, next_run: d }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn schedule_roundtrips() {
        for s in [Schedule::Daily, Schedule::Weekly, Schedule::Monthly] {
            assert_eq!(Schedule::parse(s.as_str()), Some(s));
        }
        assert_eq!(Schedule::parse("yearly"), None);
    }

    #[test]
    fn monthly_clamps_to_month_end() {
        assert_eq!(Schedule::Monthly.next(date("2026-01-31")), Some(date("2026-02-28")));
        assert_eq!(Schedule::Weekly.next(date("2026-01-01")), Some(date("2026-01-08")));
        assert_eq!(Schedule::Daily.next(date("2026-01-01")), Some(date("2026-01-02")));
    }

    #[test]
    fn catches_up_multiple_missed_periods() {
        // Weekly rule that hasn't run for ~4 weeks.
        let p = plan(Schedule::Weekly, date("2026-05-01"), None, date("2026-05-25"));
        assert_eq!(p.due, vec![date("2026-05-01"), date("2026-05-08"), date("2026-05-15"), date("2026-05-22")]);
        assert_eq!(p.next_run, date("2026-05-29"));
    }

    #[test]
    fn same_day_rerun_is_a_noop() {
        // After the catch-up above, re-running with the advanced pointers yields nothing new.
        let p = plan(Schedule::Weekly, date("2026-05-29"), Some(date("2026-05-22")), date("2026-05-25"));
        assert!(p.due.is_empty());
        assert_eq!(p.next_run, date("2026-05-29"), "next_run unchanged when nothing is due");
    }

    #[test]
    fn nothing_due_before_first_run() {
        let p = plan(Schedule::Daily, date("2026-06-10"), None, date("2026-06-06"));
        assert!(p.due.is_empty());
        assert_eq!(p.next_run, date("2026-06-10"));
    }

    #[test]
    fn last_materialised_skips_already_inserted() {
        // next_run points at a date already materialised (drift); it must be skipped.
        let p = plan(Schedule::Daily, date("2026-06-05"), Some(date("2026-06-05")), date("2026-06-06"));
        assert_eq!(p.due, vec![date("2026-06-06")]);
        assert_eq!(p.next_run, date("2026-06-07"));
    }
}
