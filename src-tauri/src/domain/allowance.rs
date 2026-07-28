//! Savings-backed allowance (envelope) entity + the imprest reservation math (FR-3.4). Pure logic -
//! no DB, no Tauri - so every invariant in `docs/allowances.md` is unit-testable without a running
//! app. The full behavioral spec lives in `docs/allowances.md`; the load-bearing decisions (why
//! set-to-target, why the savings gate, why `Total` is derived) are `docs/adr/0005-...md` and
//! `docs/adr/0012-allowance-total-is-derived-savings.md`.
//!
//! Three balances (`docs/allowances.md` §4): `Total` (the base-currency savings total, computed by
//! `db::dashboard::total_balance_minor` - NEVER stored here), `Reserved = sum(max(0, balance_i))`
//! over active, base-currency allowances, and `Available = Total - Reserved`. `balance_minor` IS
//! stored per allowance (a set-to-target refresh is not invertible from the ledger alone).
//!
//! Allowances are base-currency only (validated at creation); a savings gate (§6.2) makes any
//! operation that would RAISE Reserved all-or-nothing against Available, while operations that
//! LOWER Reserved are never gated.

use chrono::{Datelike, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};

/// A savings-backed allowance envelope (mirrors TS `Allowance`). `reserved_minor`, `overspent`, and
/// `underfunded` are DERIVED on read, never stored (`db::allowances::row_to_allowance`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Allowance {
    pub id: i64,
    pub name: String,
    pub currency: String,
    pub target_minor: i64,
    pub balance_minor: i64,
    /// `"recurring"` or `"one_time"`.
    pub kind: String,
    /// `"weekly"` / `"monthly"` for a recurring allowance; `None` for one-time.
    pub period: Option<String>,
    /// ISO weekday (Mon=1..Sun=7) a weekly allowance refreshes on; `None` otherwise.
    pub week_start: Option<i64>,
    /// `YYYY-MM-DD`; `None` for a one-time allowance (it never refreshes).
    pub next_refresh_date: Option<String>,
    pub active: bool,
    pub created_at: String,
    /// Derived: `max(0, balance_minor)` while active, else `0` (docs/allowances.md §4.2 point 3).
    pub reserved_minor: i64,
    /// Derived: `balance_minor < 0`.
    pub overspent: bool,
    /// Derived: active, recurring, and currently below target (a refresh would top it up).
    pub underfunded: bool,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("name must not be empty")]
    EmptyName,
    #[error("target must be greater than zero")]
    NonPositiveTarget,
    #[error("currency must be a 3-letter ISO-4217 code (e.g. MUR)")]
    BadCurrency,
    #[error("allowances must be in the vault's base currency")]
    CurrencyNotBase,
    #[error("kind must be 'recurring' or 'one_time'")]
    BadKind,
    #[error("period must be 'weekly' or 'monthly' for a recurring allowance, and absent for a one-time allowance")]
    BadPeriod,
    #[error("week_start must be an ISO weekday 1-7 (Mon=1) for a weekly allowance, and absent otherwise")]
    BadWeekStart,
}

/// How a recurring allowance refreshes (mirrors DB `period`/`week_start`, NOT `domain::recurring::
/// Schedule` - allowances only ever support weekly/monthly, never daily; see docs/allowances.md §9.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cadence {
    Weekly { week_start: Weekday },
    Monthly,
}

/// Validate user-supplied allowance fields before persisting. `kind` is `"recurring"` |
/// `"one_time"`; `period`/`week_start` are validated together against `kind` (docs/allowances.md
/// §6.1 point 7, §9.1).
pub fn validate_allowance(
    name: &str,
    target_minor: i64,
    currency: &str,
    base_currency: &str,
    kind: &str,
    period: Option<&str>,
    week_start: Option<i64>,
) -> Result<(), ValidationError> {
    if name.trim().is_empty() {
        return Err(ValidationError::EmptyName);
    }
    if target_minor <= 0 {
        return Err(ValidationError::NonPositiveTarget);
    }
    if !crate::domain::account::is_iso4217(currency) {
        return Err(ValidationError::BadCurrency);
    }
    if currency != base_currency {
        return Err(ValidationError::CurrencyNotBase);
    }
    match kind {
        "one_time" => {
            if period.is_some() {
                return Err(ValidationError::BadPeriod);
            }
            if week_start.is_some() {
                return Err(ValidationError::BadWeekStart);
            }
        }
        "recurring" => match period {
            Some("weekly") => match week_start {
                Some(w) if (1..=7).contains(&w) => {}
                _ => return Err(ValidationError::BadWeekStart),
            },
            Some("monthly") => {
                if week_start.is_some() {
                    return Err(ValidationError::BadWeekStart);
                }
            }
            _ => return Err(ValidationError::BadPeriod),
        },
        _ => return Err(ValidationError::BadKind),
    }
    Ok(())
}

/// `Reserved` contribution of one allowance (docs/allowances.md §4.2 point 3): a negative balance
/// reserves nothing, and an inactive allowance never contributes.
pub fn reserved_of(balance_minor: i64, active: bool) -> i64 {
    if active {
        balance_minor.max(0)
    } else {
        0
    }
}

/// `Available = Total - Reserved` (docs/allowances.md §4.1). May be negative (over-committed).
pub fn available(total_minor: i64, reserved_minor: i64) -> i64 {
    total_minor - reserved_minor
}

/// The `Reserved` cost of topping `balance_minor` up to `target_minor` (docs/allowances.md §5.3):
/// `target - max(0, balance)`. May be negative (a refund pushed the balance above target - the
/// excess returns to Available, never gated).
pub fn reserved_increase(target_minor: i64, balance_minor: i64) -> i64 {
    target_minor - balance_minor.max(0)
}

/// Outcome of a top-up attempt (docs/allowances.md §9.2). `reserved_delta` is how much `Reserved`
/// changes (positive = more reserved, negative = excess returned) - the caller does
/// `available -= reserved_delta`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TopUp {
    Apply {
        new_balance: i64,
        reserved_delta: i64,
    },
    Skip,
}

/// The set-to-target refresh algorithm (docs/allowances.md §9.2 / §5). Trims down to target for
/// free (a decrease is never gated); heals/tops up to target only if the increase fits in
/// `available_minor` (the savings gate, §6.2) - otherwise the allowance is left unchanged
/// (`TopUp::Skip`, "warn and do not refill", §6.1 point 2).
pub fn top_up(target_minor: i64, balance_minor: i64, available_minor: i64) -> TopUp {
    let increase = reserved_increase(target_minor, balance_minor);
    if increase <= 0 || increase <= available_minor {
        TopUp::Apply {
            new_balance: target_minor,
            reserved_delta: increase,
        }
    } else {
        TopUp::Skip
    }
}

/// Apply an edited target as an immediate delta to the current balance (docs/allowances.md §8):
/// `new_balance = balance + (new_target - old_target)`. Gated ONLY if this actually raises
/// `Reserved` (`max(0, new_balance) > max(0, balance)`), using the ACTUAL reserved change rather
/// than the raw delta so a negative-balance allowance being raised back toward positive is gated
/// correctly too; a reduction in `Reserved` is never gated (`Err(())` on a failed gate; the caller
/// leaves the allowance unchanged and surfaces a warning).
#[allow(clippy::result_unit_err)] // the caller only branches on ok/err - see the doc above.
pub fn apply_target_delta(
    old_target_minor: i64,
    new_target_minor: i64,
    balance_minor: i64,
    available_minor: i64,
) -> Result<i64, ()> {
    let delta = new_target_minor - old_target_minor;
    let new_balance = balance_minor + delta;
    let increase = new_balance.max(0) - balance_minor.max(0);
    if increase > 0 && increase > available_minor {
        return Err(());
    }
    Ok(new_balance)
}

/// Parse the stored `period`/`week_start` into a `Cadence`. `None` for a malformed/one-time row
/// (defensive - the DB layer should never construct one, but this must never panic on bad data).
pub fn cadence_of(period: &str, week_start: Option<i64>) -> Option<Cadence> {
    match period {
        "monthly" => Some(Cadence::Monthly),
        "weekly" => iso_weekday(week_start?).map(|week_start| Cadence::Weekly { week_start }),
        _ => None,
    }
}

fn iso_weekday(w: i64) -> Option<Weekday> {
    match w {
        1 => Some(Weekday::Mon),
        2 => Some(Weekday::Tue),
        3 => Some(Weekday::Wed),
        4 => Some(Weekday::Thu),
        5 => Some(Weekday::Fri),
        6 => Some(Weekday::Sat),
        7 => Some(Weekday::Sun),
        _ => None,
    }
}

/// Add (or subtract) whole calendar months to the first of `date`'s month, rolling over year
/// boundaries correctly. Local copy of the same small helper in `domain::dashboard`/`domain::report`
/// (kept private and separately testable rather than sharing a `pub(crate)` across modules).
fn add_months(date: NaiveDate, months: i32) -> NaiveDate {
    let total = date.year() * 12 + (date.month() as i32 - 1) + months;
    let year = total.div_euclid(12);
    let month = total.rem_euclid(12) + 1;
    NaiveDate::from_ymd_opt(year, month as u32, 1).expect("first-of-month date is always valid")
}

/// The next calendar boundary STRICTLY AFTER `date` (docs/allowances.md §9.1): for `Monthly`, the
/// 1st of the month after `date`'s month (even if `date` IS the 1st); for `Weekly`, the next date
/// whose weekday is `week_start` (even if `date` already IS that weekday - "strictly after").
pub fn next_boundary_after(cadence: Cadence, date: NaiveDate) -> NaiveDate {
    match cadence {
        Cadence::Monthly => {
            let first_of_this_month = date.with_day(1).expect("day 1 is always valid");
            add_months(first_of_this_month, 1)
        }
        Cadence::Weekly { week_start } => {
            let mut d = date
                .succ_opt()
                .expect("date is far from the chrono range limit");
            while d.weekday() != week_start {
                d = d
                    .succ_opt()
                    .expect("date is far from the chrono range limit");
            }
            d
        }
    }
}

/// The outcome of planning a recurring allowance's refresh up to `today` (docs/allowances.md §9.4):
/// missed periods collapse into AT MOST one top-up, and the pointer always advances to the next
/// boundary strictly after `today` when a top-up is due - never stacking multiple periods.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RefreshPlan {
    pub should_top_up: bool,
    pub next_refresh: NaiveDate,
}

/// Whether (and to where) a recurring allowance should refresh, lazily evaluated on app open (no
/// background scheduler, NFR-Perf3). Idempotent: re-running with the already-advanced
/// `next_refresh_date` on the same `today` reports `should_top_up = false` and an unchanged pointer.
pub fn plan_refresh(
    cadence: Cadence,
    next_refresh_date: NaiveDate,
    today: NaiveDate,
) -> RefreshPlan {
    let should_top_up = next_refresh_date <= today;
    let next_refresh = if should_top_up {
        next_boundary_after(cadence, today)
    } else {
        next_refresh_date
    };
    RefreshPlan {
        should_top_up,
        next_refresh,
    }
}

/// A one-time allowance auto-closes once its balance is spent down to zero or below
/// (docs/allowances.md §10) - never re-opens (forward-only; `db::allowances::apply_tag_delta`).
pub fn one_time_closed(balance_minor: i64) -> bool {
    balance_minor <= 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn date(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    // ── validate_allowance ──────────────────────────────────────────────────────────

    #[test]
    fn valid_recurring_weekly_passes() {
        assert!(validate_allowance(
            "Personal",
            150_000,
            "MUR",
            "MUR",
            "recurring",
            Some("weekly"),
            Some(1)
        )
        .is_ok());
    }

    #[test]
    fn valid_recurring_monthly_passes() {
        assert!(validate_allowance(
            "Rent float",
            100_000,
            "MUR",
            "MUR",
            "recurring",
            Some("monthly"),
            None
        )
        .is_ok());
    }

    #[test]
    fn valid_one_time_passes() {
        assert!(validate_allowance("Trip", 500_000, "MUR", "MUR", "one_time", None, None).is_ok());
    }

    #[test]
    fn empty_name_rejected() {
        assert_eq!(
            validate_allowance("  ", 1_000, "MUR", "MUR", "one_time", None, None),
            Err(ValidationError::EmptyName)
        );
    }

    #[test]
    fn non_positive_target_rejected() {
        assert_eq!(
            validate_allowance("X", 0, "MUR", "MUR", "one_time", None, None),
            Err(ValidationError::NonPositiveTarget)
        );
        assert_eq!(
            validate_allowance("X", -1, "MUR", "MUR", "one_time", None, None),
            Err(ValidationError::NonPositiveTarget)
        );
    }

    #[test]
    fn bad_currency_format_rejected() {
        assert_eq!(
            validate_allowance("X", 1_000, "mur", "mur", "one_time", None, None),
            Err(ValidationError::BadCurrency)
        );
    }

    #[test]
    fn foreign_currency_rejected() {
        assert_eq!(
            validate_allowance("X", 1_000, "USD", "MUR", "one_time", None, None),
            Err(ValidationError::CurrencyNotBase)
        );
    }

    #[test]
    fn unknown_kind_rejected() {
        assert_eq!(
            validate_allowance("X", 1_000, "MUR", "MUR", "yearly", None, None),
            Err(ValidationError::BadKind)
        );
    }

    #[test]
    fn one_time_with_period_or_week_start_rejected() {
        assert_eq!(
            validate_allowance("X", 1_000, "MUR", "MUR", "one_time", Some("monthly"), None),
            Err(ValidationError::BadPeriod)
        );
        assert_eq!(
            validate_allowance("X", 1_000, "MUR", "MUR", "one_time", None, Some(1)),
            Err(ValidationError::BadWeekStart)
        );
    }

    #[test]
    fn recurring_requires_weekly_or_monthly_period() {
        assert_eq!(
            validate_allowance("X", 1_000, "MUR", "MUR", "recurring", None, None),
            Err(ValidationError::BadPeriod)
        );
        assert_eq!(
            validate_allowance("X", 1_000, "MUR", "MUR", "recurring", Some("daily"), None),
            Err(ValidationError::BadPeriod)
        );
    }

    #[test]
    fn recurring_weekly_requires_week_start_1_to_7() {
        assert_eq!(
            validate_allowance("X", 1_000, "MUR", "MUR", "recurring", Some("weekly"), None),
            Err(ValidationError::BadWeekStart)
        );
        assert_eq!(
            validate_allowance(
                "X",
                1_000,
                "MUR",
                "MUR",
                "recurring",
                Some("weekly"),
                Some(0)
            ),
            Err(ValidationError::BadWeekStart)
        );
        assert_eq!(
            validate_allowance(
                "X",
                1_000,
                "MUR",
                "MUR",
                "recurring",
                Some("weekly"),
                Some(8)
            ),
            Err(ValidationError::BadWeekStart)
        );
    }

    #[test]
    fn recurring_monthly_rejects_a_week_start() {
        assert_eq!(
            validate_allowance(
                "X",
                1_000,
                "MUR",
                "MUR",
                "recurring",
                Some("monthly"),
                Some(1)
            ),
            Err(ValidationError::BadWeekStart)
        );
    }

    // ── docs/allowances.md §7: worked example - overspend ───────────────────────────

    #[test]
    fn worked_example_overspend() {
        // Total = 5,000, no allowances -> Reserved = 0, Available = 5,000.
        let total = 5_000i64;
        // 1. Create "Groceries" target 1,000 - allocation gated: 1,000 <= 5,000, ok.
        let available_before_create = available(total, 0);
        assert_eq!(reserved_increase(1_000, 0), 1_000);
        assert!(reserved_increase(1_000, 0) <= available_before_create);
        let balance = 1_000i64; // allocated
        assert_eq!(reserved_of(balance, true), 1_000);
        assert_eq!(available(total, reserved_of(balance, true)), 4_000);

        // 2. Spend 600 (tagged). Total -> 4_400, balance -> 400.
        let total = total - 600;
        let balance = balance - 600;
        assert_eq!(total, 4_400);
        assert_eq!(balance, 400);
        assert_eq!(reserved_of(balance, true), 400);
        assert_eq!(
            available(total, reserved_of(balance, true)),
            4_000,
            "unchanged - spent from reserved money"
        );

        // 3. Spend 600 again (only 400 remains -> overspend of 200). Total -> 3_800, balance -> -200.
        let total = total - 600;
        let balance = balance - 600;
        assert_eq!(total, 3_800);
        assert_eq!(balance, -200);
        assert_eq!(
            reserved_of(balance, true),
            0,
            "a negative balance reserves nothing"
        );
        assert_eq!(
            available(total, reserved_of(balance, true)),
            3_800,
            "dropped by exactly the 200 over-envelope portion"
        );
    }

    // ── docs/allowances.md §8: worked example - editing the target mid-period ──────

    #[test]
    fn worked_example_target_edit_raise_gated_and_applies_delta() {
        // Raise 1,000 -> 1,500, balance 400 (600 already spent). delta = +500.
        let available = 10_000; // plenty
        let new_balance = apply_target_delta(1_000, 1_500, 400, available).unwrap();
        assert_eq!(
            new_balance, 900,
            "already-spent money is not refunded, only +500 headroom"
        );
    }

    #[test]
    fn worked_example_target_edit_raise_rejected_when_available_too_small() {
        // Same raise, but Available < 500 needed -> gate fails.
        assert_eq!(apply_target_delta(1_000, 1_500, 400, 499), Err(()));
        assert_eq!(
            apply_target_delta(1_000, 1_500, 400, 500),
            Ok(900),
            "exactly enough is allowed"
        );
    }

    #[test]
    fn worked_example_target_edit_lower_never_gated() {
        // Lower 1,000 -> 800, balance 400. delta = -200 -> balance 200. Never gated (even Available
        // deeply negative).
        assert_eq!(apply_target_delta(1_000, 800, 400, -1_000_000), Ok(200));
    }

    #[test]
    fn worked_example_target_edit_lower_below_spent_goes_negative() {
        // Lower 1,000 -> 500, balance 400 (600 already spent). delta = -500 -> balance -100.
        assert_eq!(apply_target_delta(1_000, 500, 400, -1_000_000), Ok(-100));
    }

    // ── docs/allowances.md §9: refresh behaviour ────────────────────────────────────

    #[test]
    fn worked_example_refresh_carryover_sufficient_savings() {
        // balance 400, target 1,000, Available 4,000 -> reserved_increase = 600 <= 4,000.
        assert_eq!(
            top_up(1_000, 400, 4_000),
            TopUp::Apply {
                new_balance: 1_000,
                reserved_delta: 600
            }
        );
    }

    #[test]
    fn worked_example_refresh_heals_overspend_when_funded() {
        // balance -200, target 1,000 -> reserved_increase = 1,000; funded -> heals to target.
        assert_eq!(
            top_up(1_000, -200, 1_000),
            TopUp::Apply {
                new_balance: 1_000,
                reserved_delta: 1_000
            }
        );
    }

    #[test]
    fn worked_example_refresh_skips_when_underfunded() {
        // Same overspend, but Available < 1,000 -> warn and leave unchanged.
        assert_eq!(top_up(1_000, -200, 999), TopUp::Skip);
    }

    #[test]
    fn worked_example_refund_above_target_trims_for_free() {
        // A refund pushed balance to 1,200 against a 1,000 target - trimming is never gated (even
        // deeply negative Available).
        assert_eq!(
            top_up(1_000, 1_200, -1_000_000),
            TopUp::Apply {
                new_balance: 1_000,
                reserved_delta: -200
            }
        );
    }

    // ── docs/allowances.md §14: edge-case catalogue ─────────────────────────────────

    #[test]
    fn edge_allocate_more_than_available_at_creation_is_gated_in_reserved_increase() {
        // Creation allocates the full target from a balance of 0 - the gate is the plain
        // reserved_increase(target, 0) = target check the DB layer performs against Available.
        assert_eq!(reserved_increase(1_000, 0), 1_000);
    }

    #[test]
    fn edge_overspend_then_refresh_with_enough_savings_heals() {
        // reserved_increase(1_000, -500) = 1_000 - max(0, -500) = 1_000; Available must cover the
        // FULL 1_000 (not just the 500 magnitude of the overspend) to heal it.
        assert_eq!(
            top_up(1_000, -500, 1_000),
            TopUp::Apply {
                new_balance: 1_000,
                reserved_delta: 1_000
            }
        );
    }

    #[test]
    fn edge_overspend_then_refresh_without_enough_savings_skips() {
        assert_eq!(top_up(1_000, -500, 999), TopUp::Skip);
    }

    #[test]
    fn edge_leftover_at_refresh_carries_over_tops_only_spent_portion() {
        // balance 700 of a 1,000 target -> only 300 is topped up (reserved_delta), balance still
        // set to target (no compounding of the 700 leftover).
        assert_eq!(
            top_up(1_000, 700, 1_000_000),
            TopUp::Apply {
                new_balance: 1_000,
                reserved_delta: 300
            }
        );
    }

    #[test]
    fn edge_lower_target_below_already_spent_goes_negative() {
        assert_eq!(apply_target_delta(1_000, 500, 400, 1_000_000), Ok(-100));
    }

    #[test]
    fn edge_app_unopened_for_several_periods_single_top_up_and_pointer_advances() {
        let cadence = Cadence::Weekly {
            week_start: Weekday::Mon,
        };
        // Rule hasn't run since three Mondays ago; today is well past all of them.
        let plan = plan_refresh(cadence, date("2026-06-01"), date("2026-06-22"));
        assert!(plan.should_top_up);
        // The pointer advances to the boundary strictly after TODAY, not after the missed date -
        // three missed weeks still yield ONE top-up.
        assert_eq!(plan.next_refresh, date("2026-06-29"));
    }

    #[test]
    fn edge_one_time_overspent_auto_closes_at_or_below_zero() {
        assert!(!one_time_closed(1));
        assert!(one_time_closed(0));
        assert!(one_time_closed(-50));
    }

    #[test]
    fn edge_pause_resume_reserved_returns_and_regates() {
        // Pause: reserved_of goes to 0 regardless of balance (never gated).
        assert_eq!(reserved_of(500, false), 0);
        // Resume: re-allocating the same balance is gated like any other increase.
        assert_eq!(reserved_increase(500, 0), 500); // conceptually: resuming re-reserves the balance
    }

    // ── docs/allowances.md §15: two-weekly end-to-end scenario ──────────────────────

    #[test]
    fn worked_example_two_weekly_allowances_end_to_end() {
        // Total = 10,000. Create Personal (1,500) + Transport (800).
        let total = 10_000i64;
        assert_eq!(reserved_increase(1_500, 0), 1_500);
        assert_eq!(reserved_increase(800, 0), 800);
        let (mut personal, mut transport) = (1_500i64, 800i64);
        let reserved = reserved_of(personal, true) + reserved_of(transport, true);
        assert_eq!(reserved, 2_300);
        assert_eq!(available(total, reserved), 7_700);

        // Week 1: Personal -1,200 (tagged), Transport -900 (tagged, overspend by 100).
        let total = total - 1_200 - 900;
        personal -= 1_200;
        transport -= 900;
        assert_eq!(total, 7_900);
        assert_eq!(personal, 300);
        assert_eq!(transport, -100);
        let reserved = reserved_of(personal, true) + reserved_of(transport, true);
        assert_eq!(reserved, 300, "transport's overspend reserves nothing");
        assert_eq!(available(total, reserved), 7_600);

        // Start of week 2: refresh both, Available 7,600 covers both top-ups in sequence.
        let mut running_available = available(total, reserved);
        let personal_topup = top_up(1_500, personal, running_available);
        let TopUp::Apply {
            new_balance: new_personal,
            reserved_delta: personal_delta,
        } = personal_topup
        else {
            panic!("expected personal to be funded");
        };
        running_available -= personal_delta;
        personal = new_personal;
        assert_eq!(personal, 1_500);
        assert_eq!(
            personal_delta, 1_200,
            "only the spent 300->1,500 gap, the 300 carryover is preserved"
        );

        let transport_topup = top_up(800, transport, running_available);
        let TopUp::Apply {
            new_balance: new_transport,
            reserved_delta: transport_delta,
        } = transport_topup
        else {
            panic!("expected transport to be funded");
        };
        running_available -= transport_delta;
        transport = new_transport;
        assert_eq!(transport, 800, "heals the -100 overspend");
        assert_eq!(transport_delta, 800);

        let reserved = reserved_of(personal, true) + reserved_of(transport, true);
        assert_eq!(reserved, 2_300);
        assert_eq!(available(total, reserved), 5_600);
        assert_eq!(running_available, 5_600);
        assert_eq!(total, 7_900, "refresh never changes Total");
    }

    // ── cadence / next_boundary_after / plan_refresh ────────────────────────────────

    #[test]
    fn cadence_of_parses_weekly_and_monthly() {
        assert_eq!(cadence_of("monthly", None), Some(Cadence::Monthly));
        assert_eq!(
            cadence_of("weekly", Some(1)),
            Some(Cadence::Weekly {
                week_start: Weekday::Mon
            })
        );
        assert_eq!(
            cadence_of("weekly", Some(7)),
            Some(Cadence::Weekly {
                week_start: Weekday::Sun
            })
        );
        assert_eq!(cadence_of("weekly", None), None);
        assert_eq!(cadence_of("weekly", Some(8)), None);
        assert_eq!(cadence_of("daily", None), None);
    }

    #[test]
    fn next_boundary_monthly_is_always_the_1st_of_a_later_month() {
        assert_eq!(
            next_boundary_after(Cadence::Monthly, date("2026-01-31")),
            date("2026-02-01")
        );
        assert_eq!(
            next_boundary_after(Cadence::Monthly, date("2026-02-01")),
            date("2026-03-01"),
            "strictly after, even on the 1st"
        );
        assert_eq!(
            next_boundary_after(Cadence::Monthly, date("2026-12-15")),
            date("2027-01-01"),
            "year rollover"
        );
    }

    #[test]
    fn next_boundary_weekly_is_strictly_after_even_on_the_target_weekday() {
        let cadence = Cadence::Weekly {
            week_start: Weekday::Mon,
        };
        assert_eq!(
            next_boundary_after(cadence, date("2026-06-01")),
            date("2026-06-08"),
            "2026-06-01 is itself a Monday"
        );
        assert_eq!(
            next_boundary_after(cadence, date("2026-06-03")),
            date("2026-06-08")
        );
    }

    #[test]
    fn plan_refresh_is_idempotent_after_advancing() {
        let cadence = Cadence::Monthly;
        let today = date("2026-03-15");
        let first = plan_refresh(cadence, date("2026-01-01"), today);
        assert!(first.should_top_up);
        assert_eq!(first.next_refresh, date("2026-04-01"));

        // Re-running the same day with the advanced pointer is a no-op.
        let second = plan_refresh(cadence, first.next_refresh, today);
        assert!(!second.should_top_up);
        assert_eq!(second.next_refresh, first.next_refresh);
    }

    #[test]
    fn plan_refresh_not_yet_due_leaves_pointer_unchanged() {
        let cadence = Cadence::Monthly;
        let plan = plan_refresh(cadence, date("2026-08-01"), date("2026-07-15"));
        assert!(!plan.should_top_up);
        assert_eq!(plan.next_refresh, date("2026-08-01"));
    }

    // ── property tests (docs/allowances.md §13 invariants) ─────────────────────────

    proptest! {
        #[test]
        fn prop_reserved_of_never_negative(balance in any::<i64>(), active in any::<bool>()) {
            prop_assert!(reserved_of(balance, active) >= 0);
        }

        #[test]
        fn prop_available_equals_total_minus_reserved(total in -1_000_000_000i64..1_000_000_000, reserved in 0i64..1_000_000_000) {
            prop_assert_eq!(available(total, reserved), total - reserved);
        }

        /// A top-up always sets the balance to the target when applied - the "single top-up
        /// regardless of how many periods were missed / how underfunded" property (§9.4, §14).
        #[test]
        fn prop_top_up_apply_always_sets_balance_to_target(
            target in 1i64..1_000_000,
            balance in -1_000_000i64..1_000_000,
        ) {
            // Always fund it generously so we land in the Apply branch.
            if let TopUp::Apply { new_balance, reserved_delta } = top_up(target, balance, 10_000_000) {
                prop_assert_eq!(new_balance, target);
                prop_assert_eq!(reserved_delta, target - balance.max(0));
            } else {
                prop_assert!(false, "expected Apply with a generous available amount");
            }
        }

        /// The gate never lets a gated increase exceed Available.
        #[test]
        fn prop_gate_never_exceeds_available(
            target in 1i64..1_000_000,
            balance in -1_000_000i64..1_000_000,
            available in -1_000_000i64..1_000_000,
        ) {
            match top_up(target, balance, available) {
                TopUp::Apply { reserved_delta, .. } => prop_assert!(reserved_delta <= available || reserved_delta <= 0),
                TopUp::Skip => {
                    let increase = reserved_increase(target, balance);
                    prop_assert!(increase > available);
                }
            }
        }

        /// Decreases (balance already at/above target) are never gated, regardless of Available.
        #[test]
        fn prop_decrease_never_gated(
            target in 1i64..1_000_000,
            balance in 0i64..2_000_000,
            available in -1_000_000_000i64..0,
        ) {
            prop_assume!(balance >= target);
            prop_assert_eq!(top_up(target, balance, available), TopUp::Apply { new_balance: target, reserved_delta: target - balance });
        }

        /// `plan_refresh` is idempotent: once the pointer is advanced past `today`, re-planning the
        /// same `today` never tops up again and leaves the pointer unchanged.
        #[test]
        fn prop_plan_refresh_idempotent(
            week_start in 1i64..=7,
            today_offset in 0i64..3650,
        ) {
            let cadence = Cadence::Weekly { week_start: iso_weekday(week_start).unwrap() };
            let epoch = NaiveDate::from_ymd_opt(2020, 1, 1).unwrap();
            let today = epoch + chrono::Duration::days(today_offset);
            let first = plan_refresh(cadence, epoch, today);
            let second = plan_refresh(cadence, first.next_refresh, today);
            prop_assert!(!second.should_top_up);
            prop_assert_eq!(second.next_refresh, first.next_refresh);
        }

        /// `apply_target_delta`, when it succeeds, always applies exactly `balance + (new - old)`.
        #[test]
        fn prop_apply_target_delta_is_balance_plus_delta_when_ok(
            old_target in 1i64..1_000_000,
            new_target in 1i64..1_000_000,
            balance in -1_000_000i64..1_000_000,
        ) {
            if let Ok(new_balance) = apply_target_delta(old_target, new_target, balance, 10_000_000) {
                prop_assert_eq!(new_balance, balance + (new_target - old_target));
            }
        }
    }
}
