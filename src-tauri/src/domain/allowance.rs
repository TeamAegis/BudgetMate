//! Savings-backed allowance (imprest envelope) domain logic (FR-3.4). Pure, DB-free - no Tauri, no
//! clock reads - so every invariant in `docs/allowances.md` §13 is unit/property-testable without a
//! running app. The implementation contract is `docs/adr/0012-allowance-total-source-and-derived-
//! balance.md`; read it before changing this file.
//!
//! **The balance is derived, never stored.** A row keeps a refresh ANCHOR
//! (`anchor_balance_minor` + `last_refresh_date`); `db::allowances::derived_balance` recomputes the
//! current balance on every read as `anchor + SUM(base_amount_minor)` over tagged, confirmed,
//! not-future-dated transactions posted on/after `last_refresh_date`. This module supplies the pure
//! math the DB layer feeds real numbers into: the savings-gate check, the imprest set-to-target
//! refresh outcome, the delta-applied target edit, and the calendar-boundary helpers.
//!
//! **Anchor discipline (a load-bearing invariant, not explicit in the ADR's prose but required by
//! it):** CREATE and RESUME anchor `last_refresh_date` at `today` (the date of that write) - a
//! brand-new or freshly re-allocated allowance's period effectively starts now, so pre-existing
//! spend must never retroactively count against it.
//!
//! A FUNDED REFRESH is different: it anchors `last_refresh_date` at the CURRENT PERIOD BOUNDARY
//! (`current_boundary`, ADR 0012 §5), not at `today`. The lazy refresh normally runs whenever the app
//! is next opened on or after the boundary (`today >= next_refresh_date`), which is usually strictly
//! after the boundary itself - and a transaction dated in `[boundary, today)` can still be entered
//! AFTER the refresh runs (a back-dated receipt, a delayed OCR confirmation). Anchoring at `today`
//! would permanently exclude that transaction's `posted_date` from every future `derived_balance`
//! read (it falls before `last_refresh_date`), silently overstating the balance for the rest of the
//! period. Anchoring at the boundary keeps that window open, and it does NOT double-count: a funded
//! refresh always sets the anchor to `target` FLAT (never additive to the pre-refresh balance, which
//! is discarded entirely), so `post-refresh balance = target + SUM(posted in [boundary, today])` -
//! each tagged transaction has exactly one `posted_date` and is counted 0 or 1 times, never twice, no
//! matter when it is entered relative to the refresh. At the instant a refresh runs, `[boundary,
//! today)` is normally still empty (no app-open happened in it yet), so the balance read immediately
//! after a funded refresh still equals exactly `target` in the common case - identical to anchoring
//! at `today` - while also correctly including any current-period spend entered later. Either way,
//! `next_refresh_date` always uses calendar-boundary math (the next boundary strictly after today,
//! per §9.1).

use chrono::{Datelike, Months, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};

use crate::domain::account::is_iso4217;

/// How a recurring allowance repeats. Mirrors TS `AllowancePeriod`. `None` on the row for a
/// one-time allowance (it never refreshes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AllowancePeriod {
    Weekly,
    Monthly,
}

impl AllowancePeriod {
    pub fn as_str(&self) -> &'static str {
        match self {
            AllowancePeriod::Weekly => "weekly",
            AllowancePeriod::Monthly => "monthly",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "weekly" => Some(AllowancePeriod::Weekly),
            "monthly" => Some(AllowancePeriod::Monthly),
            _ => None,
        }
    }
}

/// Whether an allowance refreshes on a cadence or is a single allocation. Mirrors TS
/// `AllowanceKind`; stored lowercase-with-underscore in the DB `kind` CHECK column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AllowanceKind {
    Recurring,
    OneTime,
}

impl AllowanceKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            AllowanceKind::Recurring => "recurring",
            AllowanceKind::OneTime => "one_time",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "recurring" => Some(AllowanceKind::Recurring),
            "one_time" => Some(AllowanceKind::OneTime),
            _ => None,
        }
    }
}

/// Where an allowance's derived balance sits: `Overspent` reserves nothing (§13.3). NEVER signal
/// this by colour alone in the UI - pair with an icon + a plain-language label (design.md).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AllowanceStatus {
    Ok,
    Overspent,
}

/// Classify a derived balance (never signalled by colour alone in the UI).
pub fn allowance_status(balance_minor: i64) -> AllowanceStatus {
    if balance_minor < 0 {
        AllowanceStatus::Overspent
    } else {
        AllowanceStatus::Ok
    }
}

/// The raw `allowances` row (mirrors TS `Allowance`) - editable fields for management/edit. The
/// CURRENT balance is deliberately absent here: it is derived, never stored (ADR 0012); read it via
/// `AllowanceLine.balanceMinor` (`get_allowance_summary`), not from this row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Allowance {
    pub id: i64,
    pub name: String,
    pub currency: String,
    pub target_minor: i64,
    pub anchor_balance_minor: i64,
    pub kind: AllowanceKind,
    /// `None` for a one-time allowance (it never refreshes).
    pub period: Option<AllowancePeriod>,
    /// ISO-8601 weekday name ("monday".."sunday") - the weekly refresh boundary; irrelevant for
    /// monthly/one-time but always populated (DB default `'monday'`).
    pub week_start: String,
    pub last_refresh_date: String,
    /// `None` for a one-time allowance (it never refreshes).
    pub next_refresh_date: Option<String>,
    pub active: bool,
    pub created_at: String,
}

/// One allowance's derived state for the summary read model (mirrors TS `AllowanceLine`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowanceLine {
    pub id: i64,
    pub name: String,
    pub currency: String,
    pub target_minor: i64,
    /// Derived on read (ADR 0012); may be negative (overspent, §13.3).
    pub balance_minor: i64,
    /// This allowance's own contribution to Reserved: `max(0, balanceMinor)` while active, `0`
    /// while paused.
    pub reserved_minor: i64,
    pub kind: AllowanceKind,
    pub period: Option<AllowancePeriod>,
    pub active: bool,
    pub status: AllowanceStatus,
}

/// The allowances-screen read model (mirrors TS `AllowanceSummary`, from `get_allowance_summary`):
/// the vault-level Total/Reserved/Available (ADR 0012, the SAME definition the savings gate
/// enforces - never a separately inlined copy) plus every allowance's derived line (active and
/// paused; only active ones count toward `reservedMinor`/`availableMinor`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowanceSummary {
    pub base_currency: String,
    pub total_minor: i64,
    pub reserved_minor: i64,
    pub available_minor: i64,
    pub allowances: Vec<AllowanceLine>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("name must not be empty")]
    EmptyName,
    #[error("target must be greater than zero")]
    NonPositiveTarget,
    #[error("currency must be a 3-letter ISO-4217 code (e.g. MUR)")]
    BadCurrency,
    #[error("allowances can only be created/edited in the vault's base currency")]
    NotBaseCurrency,
}

/// Validate user-supplied allowance fields before persisting. `currency` must equal
/// `base_currency` (ADR 0012 decision 4) - a foreign-currency allowance would reserve nothing
/// against a base-currency Total and cannot be honestly converted offline.
pub fn validate_allowance(
    name: &str,
    target_minor: i64,
    currency: &str,
    base_currency: &str,
) -> Result<(), ValidationError> {
    if name.trim().is_empty() {
        return Err(ValidationError::EmptyName);
    }
    if target_minor <= 0 {
        return Err(ValidationError::NonPositiveTarget);
    }
    if !is_iso4217(currency) {
        return Err(ValidationError::BadCurrency);
    }
    if currency != base_currency {
        return Err(ValidationError::NotBaseCurrency);
    }
    Ok(())
}

/// Parse the stored `week_start` column ("monday".."sunday") to a `chrono::Weekday`.
pub fn parse_week_start(s: &str) -> Option<Weekday> {
    match s.to_ascii_lowercase().as_str() {
        "monday" => Some(Weekday::Mon),
        "tuesday" => Some(Weekday::Tue),
        "wednesday" => Some(Weekday::Wed),
        "thursday" => Some(Weekday::Thu),
        "friday" => Some(Weekday::Fri),
        "saturday" => Some(Weekday::Sat),
        "sunday" => Some(Weekday::Sun),
        _ => None,
    }
}

/// Format a `Weekday` back to the stored `week_start` column value.
pub fn week_start_str(w: Weekday) -> &'static str {
    match w {
        Weekday::Mon => "monday",
        Weekday::Tue => "tuesday",
        Weekday::Wed => "wednesday",
        Weekday::Thu => "thursday",
        Weekday::Fri => "friday",
        Weekday::Sat => "saturday",
        Weekday::Sun => "sunday",
    }
}

/// The most recent weekly boundary (`week_start`'s weekday) on or before `today` (inclusive).
pub fn current_weekly_boundary(today: NaiveDate, week_start: Weekday) -> NaiveDate {
    let today_idx = today.weekday().num_days_from_monday() as i64;
    let start_idx = week_start.num_days_from_monday() as i64;
    let back = (today_idx - start_idx).rem_euclid(7);
    today - chrono::Duration::days(back)
}

/// The next weekly boundary strictly after `today`.
pub fn next_weekly_boundary(today: NaiveDate, week_start: Weekday) -> NaiveDate {
    current_weekly_boundary(today, week_start) + chrono::Duration::days(7)
}

/// The most recent monthly boundary (the 1st) on or before `today` (inclusive).
pub fn current_monthly_boundary(today: NaiveDate) -> NaiveDate {
    today.with_day(1).expect("day 1 of a month is always valid")
}

/// The next monthly boundary (the 1st of next month) strictly after `today`.
pub fn next_monthly_boundary(today: NaiveDate) -> NaiveDate {
    current_monthly_boundary(today)
        .checked_add_months(Months::new(1))
        .expect("adding one month to the 1st is always a valid date")
}

/// The current period boundary (<= `today`) for `period`/`week_start`. Weekly = the row's
/// `week_start` weekday; monthly = the 1st (§9.1). Pure calendar math, unit-tested independent of
/// the clock.
pub fn current_boundary(period: AllowancePeriod, week_start: Weekday, today: NaiveDate) -> NaiveDate {
    match period {
        AllowancePeriod::Weekly => current_weekly_boundary(today, week_start),
        AllowancePeriod::Monthly => current_monthly_boundary(today),
    }
}

/// The next period boundary strictly after `today` - what `next_refresh_date` advances to after a
/// due refresh is processed, funded or not (§6.2 decision 2 / §9.2 step 5).
pub fn next_boundary(period: AllowancePeriod, week_start: Weekday, today: NaiveDate) -> NaiveDate {
    match period {
        AllowancePeriod::Weekly => next_weekly_boundary(today, week_start),
        AllowancePeriod::Monthly => next_monthly_boundary(today),
    }
}

/// This allowance's own contribution to `Reserved`: `max(0, balance)` (§4.2 invariant 3 - a
/// negative/overspent balance reserves nothing, the overspend has already left savings as real
/// spend).
pub fn reserved(balance_minor: i64) -> i64 {
    balance_minor.max(0)
}

/// This allowance's contribution to `Reserved` given its active flag: `reserved(balance)` while
/// active, `0` while paused (an inactive allowance's earmark returns to Available for free -
/// docs/allowances.md §11).
pub fn reserved_contribution(balance_minor: i64, active: bool) -> i64 {
    if active {
        reserved(balance_minor)
    } else {
        0
    }
}

/// The change in `Reserved` an operation would cause, moving this allowance from
/// `(old_balance, old_active)` to `(new_balance, new_active)`. Feed the result into
/// `savings_gate_ok`. This single function covers every allowance operation (ADR 0012):
/// creation (old: doesn't exist yet, `(0, false)`), a target edit (active flag unchanged), a
/// refresh top-up (active flag unchanged), pause (`new_active = false` -> always <= 0, i.e. never
/// gated, per §6.2/§11), and resume (`old_active = false` so the old contribution is 0 regardless
/// of whatever the stale stored balance says, `new_active = true` at the freshly re-allocated
/// target).
pub fn reserved_delta(
    old_balance_minor: i64,
    old_active: bool,
    new_balance_minor: i64,
    new_active: bool,
) -> i64 {
    reserved_contribution(new_balance_minor, new_active) - reserved_contribution(old_balance_minor, old_active)
}

/// The savings gate (§6.2): an operation that would change `Reserved` by `delta` is permitted
/// unconditionally when `delta <= 0` (a decrease, or no change - NEVER gated), and otherwise only
/// when `delta <= available_minor` (all-or-nothing; no partial top-up).
pub fn savings_gate_ok(delta: i64, available_minor: i64) -> bool {
    delta <= 0 || delta <= available_minor
}

/// Editing the target applies the DIFFERENCE to the current anchor immediately (§8): already-spent
/// money is never refunded, and a lower target can push the (derived) balance negative against the
/// new target. Since the transaction-sum component of the derived-balance formula is unaffected by
/// a target edit, shifting the anchor by the same delta shifts the derived balance by exactly that
/// delta - `new_anchor = anchor + (new_target - old_target)`.
pub fn anchor_after_target_edit(anchor_balance_minor: i64, old_target_minor: i64, new_target_minor: i64) -> i64 {
    anchor_balance_minor + (new_target_minor - old_target_minor)
}

/// The outcome of one refresh decision (§9.2): if `funded`, the balance becomes exactly `target`
/// (whether that trims an excess or heals an overspend); if not, the balance is left unchanged
/// (warn-and-do-not-refill, all-or-nothing).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RefreshOutcome {
    pub funded: bool,
    pub new_balance_minor: i64,
}

/// Plan one imprest set-to-target refresh (§5, §9.2): trimming an excess or healing a deficit is
/// always allowed (`reserved_delta <= 0`); topping up a deficit needs `available_minor` to cover
/// the increase, all-or-nothing.
pub fn plan_refresh(target_minor: i64, current_balance_minor: i64, available_minor: i64) -> RefreshOutcome {
    let delta = reserved_delta(current_balance_minor, true, target_minor, true);
    if savings_gate_ok(delta, available_minor) {
        RefreshOutcome { funded: true, new_balance_minor: target_minor }
    } else {
        RefreshOutcome { funded: false, new_balance_minor: current_balance_minor }
    }
}

/// A one-time allowance auto-closes once its derived balance reaches zero or below (§10): there is
/// nothing left to draw down, and any positive leftover would instead be returned via a manual
/// pause/delete, not this check.
pub fn should_auto_close(balance_minor: i64) -> bool {
    balance_minor <= 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn kind_and_period_roundtrip() {
        for k in [AllowanceKind::Recurring, AllowanceKind::OneTime] {
            assert_eq!(AllowanceKind::parse(k.as_str()), Some(k));
        }
        assert_eq!(AllowanceKind::parse("weekly"), None);
        for p in [AllowancePeriod::Weekly, AllowancePeriod::Monthly] {
            assert_eq!(AllowancePeriod::parse(p.as_str()), Some(p));
        }
        assert_eq!(AllowancePeriod::parse("yearly"), None);
    }

    #[test]
    fn week_start_roundtrips_all_seven_days() {
        for w in [
            Weekday::Mon,
            Weekday::Tue,
            Weekday::Wed,
            Weekday::Thu,
            Weekday::Fri,
            Weekday::Sat,
            Weekday::Sun,
        ] {
            assert_eq!(parse_week_start(week_start_str(w)), Some(w));
        }
        assert_eq!(parse_week_start("blursday"), None);
    }

    #[test]
    fn validate_rejects_bad_input() {
        assert!(validate_allowance("Groceries", 100_000, "MUR", "MUR").is_ok());
        assert_eq!(validate_allowance(" ", 100, "MUR", "MUR"), Err(ValidationError::EmptyName));
        assert_eq!(validate_allowance("X", 0, "MUR", "MUR"), Err(ValidationError::NonPositiveTarget));
        assert_eq!(validate_allowance("X", -1, "MUR", "MUR"), Err(ValidationError::NonPositiveTarget));
        assert_eq!(validate_allowance("X", 100, "mur", "MUR"), Err(ValidationError::BadCurrency));
        assert_eq!(validate_allowance("X", 100, "USD", "MUR"), Err(ValidationError::NotBaseCurrency));
    }

    // ── Calendar boundaries ──────────────────────────────────────────────────────────

    #[test]
    fn weekly_boundary_on_the_boundary_day_is_itself() {
        // Wednesday 2026-07-08 is a Wednesday; week_start = Wednesday.
        let today = d(2026, 7, 8);
        assert_eq!(current_weekly_boundary(today, Weekday::Wed), today);
        assert_eq!(next_weekly_boundary(today, Weekday::Wed), d(2026, 7, 15));
    }

    #[test]
    fn weekly_boundary_mid_period_looks_back_to_monday() {
        // 2026-07-08 is a Wednesday; the Monday-start boundary is 2026-07-06.
        let today = d(2026, 7, 8);
        assert_eq!(current_weekly_boundary(today, Weekday::Mon), d(2026, 7, 6));
        assert_eq!(next_weekly_boundary(today, Weekday::Mon), d(2026, 7, 13));
    }

    #[test]
    fn monthly_boundary_is_the_1st_and_handles_year_rollover() {
        assert_eq!(current_monthly_boundary(d(2026, 7, 15)), d(2026, 7, 1));
        assert_eq!(next_monthly_boundary(d(2026, 7, 15)), d(2026, 8, 1));
        assert_eq!(next_monthly_boundary(d(2026, 12, 15)), d(2027, 1, 1));
    }

    #[test]
    fn current_and_next_boundary_dispatch_by_period() {
        let today = d(2026, 7, 8); // Wednesday
        assert_eq!(current_boundary(AllowancePeriod::Weekly, Weekday::Mon, today), d(2026, 7, 6));
        assert_eq!(next_boundary(AllowancePeriod::Weekly, Weekday::Mon, today), d(2026, 7, 13));
        assert_eq!(current_boundary(AllowancePeriod::Monthly, Weekday::Mon, today), d(2026, 7, 1));
        assert_eq!(next_boundary(AllowancePeriod::Monthly, Weekday::Mon, today), d(2026, 8, 1));
    }

    // ── Reserved / gate ──────────────────────────────────────────────────────────────

    #[test]
    fn reserved_is_zero_for_negative_balances() {
        assert_eq!(reserved(1_000), 1_000);
        assert_eq!(reserved(0), 0);
        assert_eq!(reserved(-200), 0);
    }

    #[test]
    fn reserved_contribution_is_zero_while_paused() {
        assert_eq!(reserved_contribution(1_000, true), 1_000);
        assert_eq!(reserved_contribution(1_000, false), 0);
        assert_eq!(reserved_contribution(-200, false), 0);
    }

    #[test]
    fn creation_reserved_delta_is_the_full_target() {
        // §7: creating "Groceries" target 1000 from nothing earmarks exactly 1000.
        assert_eq!(reserved_delta(0, false, 100_000, true), 100_000);
    }

    #[test]
    fn pause_reserved_delta_is_negative_and_never_gated() {
        let delta = reserved_delta(40_000, true, 40_000, false);
        assert_eq!(delta, -40_000);
        assert!(savings_gate_ok(delta, 0), "a decrease is never gated even with zero available");
    }

    #[test]
    fn resume_reserved_delta_ignores_the_stale_balance() {
        // Resuming re-allocates to target regardless of whatever the frozen balance says.
        assert_eq!(reserved_delta(-999_999, false, 100_000, true), 100_000);
    }

    #[test]
    fn gate_allows_exactly_at_the_boundary_and_blocks_one_over() {
        assert!(savings_gate_ok(5_000, 5_000));
        assert!(!savings_gate_ok(5_001, 5_000));
        assert!(savings_gate_ok(0, 0));
        assert!(savings_gate_ok(-1, 0), "a decrease is never gated");
    }

    // ── Target edit (delta-applied, §8) ─────────────────────────────────────────────

    #[test]
    fn target_edit_raises_headroom_without_refunding_spend() {
        // §8: target 1000 -> 1500, anchor currently 400 (600 already spent): delta +500 -> 900.
        assert_eq!(anchor_after_target_edit(40_000, 100_000, 150_000), 90_000);
    }

    #[test]
    fn target_edit_lowers_and_can_push_negative_against_new_target() {
        // §8: target 1000 -> 500, balance 400 (600 already spent) -> -100.
        assert_eq!(anchor_after_target_edit(40_000, 100_000, 50_000), -10_000);
    }

    // ── Refresh (§9.2, §9.3) ─────────────────────────────────────────────────────────

    #[test]
    fn refresh_carryover_sufficient_savings() {
        // §9.3: balance 400, target 1000, available 4000 -> funds, tops up only the spent 600.
        let outcome = plan_refresh(100_000, 40_000, 400_000);
        assert!(outcome.funded);
        assert_eq!(outcome.new_balance_minor, 100_000);
    }

    #[test]
    fn refresh_heals_overspend_when_funded() {
        let outcome = plan_refresh(100_000, -20_000, 400_000);
        assert!(outcome.funded);
        assert_eq!(outcome.new_balance_minor, 100_000);
    }

    #[test]
    fn refresh_warns_and_does_not_refill_when_underfunded() {
        // Needs the full 1000 (balance -200), but only 500 is available.
        let outcome = plan_refresh(100_000, -20_000, 50_000);
        assert!(!outcome.funded);
        assert_eq!(outcome.new_balance_minor, -20_000, "balance left unchanged, not partially topped up");
    }

    #[test]
    fn refresh_trims_an_excess_above_target_never_gated() {
        // A refund pushed balance above target; trimming down is never gated (available 0 is fine).
        let outcome = plan_refresh(100_000, 150_000, 0);
        assert!(outcome.funded);
        assert_eq!(outcome.new_balance_minor, 100_000);
    }

    #[test]
    fn refresh_at_exactly_target_is_a_free_noop() {
        let outcome = plan_refresh(100_000, 100_000, 0);
        assert!(outcome.funded);
        assert_eq!(outcome.new_balance_minor, 100_000);
    }

    // ── One-time auto-close (§10) ────────────────────────────────────────────────────

    #[test]
    fn one_time_closes_at_zero_or_below_only() {
        assert!(!should_auto_close(1));
        assert!(should_auto_close(0));
        assert!(should_auto_close(-1));
    }

    // ── Property tests (§13 invariants) ─────────────────────────────────────────────

    use proptest::prelude::*;

    proptest! {
        /// `reserved` is never negative, for any balance (§13.3).
        #[test]
        fn prop_reserved_never_negative(balance in -10_000_000i64..10_000_000) {
            prop_assert!(reserved(balance) >= 0);
        }

        /// The savings gate is all-or-nothing for a genuine increase (`delta > 0`): it is permitted
        /// exactly when the increase fits within Available, in full - there is never a partial
        /// top-up (§6.2, §13.8).
        #[test]
        fn prop_gate_is_all_or_nothing(delta in 1i64..10_000_000, available in -1_000_000i64..10_000_000) {
            prop_assert_eq!(savings_gate_ok(delta, available), delta <= available);
        }

        /// A decrease (or no change) in Reserved is NEVER gated, for any available figure including
        /// a negative one (over-committed elsewhere) - §6.2.
        #[test]
        fn prop_decreases_never_gated(delta in -10_000_000i64..=0, available in -10_000_000i64..10_000_000) {
            prop_assert!(savings_gate_ok(delta, available));
        }

        /// A funded refresh always lands EXACTLY on the target (the imprest invariant) - §5.1.
        #[test]
        fn prop_funded_refresh_lands_on_target(
            target in 1i64..1_000_000,
            balance in -1_000_000i64..1_000_000,
            available in 0i64..2_000_000,
        ) {
            let outcome = plan_refresh(target, balance, available);
            if outcome.funded {
                prop_assert_eq!(outcome.new_balance_minor, target);
            } else {
                prop_assert_eq!(outcome.new_balance_minor, balance);
            }
        }

        /// A target edit's delta is applied exactly once - the anchor moves by precisely
        /// `new_target - old_target`, regardless of magnitude or direction (§8).
        #[test]
        fn prop_target_edit_applies_delta_exactly(
            anchor in -1_000_000i64..1_000_000,
            old_target in 1i64..1_000_000,
            new_target in 1i64..1_000_000,
        ) {
            let new_anchor = anchor_after_target_edit(anchor, old_target, new_target);
            prop_assert_eq!(new_anchor - anchor, new_target - old_target);
        }

        /// Missed periods collapse to one: however far behind `next_refresh_date` has drifted, a
        /// single boundary step from `today` always lands within the next 7 (weekly) or ~31
        /// (monthly) days - the schedule never tries to "catch up" period by period (§9.4).
        #[test]
        fn prop_next_weekly_boundary_is_within_one_week(days_offset in 0i64..3650) {
            let today = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap() + chrono::Duration::days(days_offset);
            let next = next_weekly_boundary(today, Weekday::Mon);
            prop_assert!(next > today);
            prop_assert!((next - today).num_days() <= 7);
        }
    }
}
