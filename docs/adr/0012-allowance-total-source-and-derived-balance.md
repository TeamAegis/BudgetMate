# 0012 - Allowance Total source, derived balance, and base-currency constraint

Status: Accepted (2026-07-28)

Extends ADR 0005 (the imprest allowance model). 0005 fixed how an allowance *behaves* (set-to-target
top-up, three balances, the savings gate, calendar-aligned lazy refresh). This ADR pins the four
things 0005 deferred to build time: where the savings `Total` comes from, how an allowance's balance
is represented, how allowance money is denominated, and how the periodic refresh is scheduled. It is
the implementation contract for FR-3.4 / issue #123.

## Context

ADR 0005 and `docs/allowances.md` define `Available = Total - Reserved` but left the source of
`Total` open, flagged in `architecture.md` §11.2 ("pin down the source of `Total` when scheduling
it"). Reading the code resolved it: `domain::dashboard` already derives a whole-vault base-currency
balance (`total_balance_minor`) from the ledger and already nets one reservation out of it
(`usable_balance_minor = total_balance_minor - goals_reserved_minor`). Allowances are the same
pattern, so no new "income / cash-flow spine" is required.

A second, load-bearing question surfaced in review: whether an allowance's `balance_minor` should be
a mutable column decremented on every tagged transaction write, or derived. A mutable balance uses a
different accounting basis than `total_balance_minor` (which counts only `pending_review = 0`,
not-future-dated rows), so a tagged pending-review or future-dated transaction would move `Reserved`
without moving `Total`, breaking `Available = Total - Reserved` (invariant §13.1). That decided it.

## Decision

1. **`Total` is derived from the ledger, never stored.** `Total` (savings) is exactly the
   base-currency balance `domain::dashboard` already computes: base-currency account openings plus
   every confirmed (`pending_review = 0`), not-future-dated transaction's `base_amount_minor`.
   Because allocation, refresh, target edits, pause and delete never write ledger rows, invariant
   §13.2 ("Total moves only on real cash") holds by construction.

2. **One shared Available definition.** `Available = Total - goals_reserved_minor -
   allowances_reserved_minor`, where `allowances_reserved_minor = sum(max(0, balance)) over active
   allowances`. The exact same helper computes the number the savings gate enforces and the number
   the UI shows; the two must never be computed by separate inlined copies, or the gate and the
   displayed Available drift. The dashboard's `usable_balance_minor` also nets allowances (additive
   `DashboardData` field), so "free to spend" stays honest.

3. **Allowance balance is derived from a stored refresh anchor.** The row stores an anchor
   (`anchor_balance_minor`, the balance set at the last refresh/allocation) and `last_refresh_date`,
   not a live balance. The current balance is computed on read:
   `balance = anchor_balance_minor + SUM(base_amount_minor) over tagged transactions with
   posted_date >= last_refresh_date, posted_date <= today, pending_review = 0`. This shares the
   dashboard's accounting basis exactly, so §13.1 holds for pending-review, future-dated, and
   dedup-flipped rows for free, and there is no create/update/delete balance-drift to reconcile.
   Tagging therefore only sets `transactions.allowance_id`; it does NOT mutate allowance state, and
   the shared `db::transactions::insert_in_tx` path (used by recurring and import) is left untouched.

4. **Allowances are denominated in the base currency.** Create/update reject a currency other than
   the current base currency with a plain-language message (a foreign allowance would reserve
   nothing against a base-currency Total and cannot be converted offline). Because the allowance is
   base-currency, `base_amount_minor` (already base-currency and fx-correct for foreign-currency
   rows) is the right quantity for the derived draw-down. `set_base_currency` is blocked with a
   clear message while ANY allowance row exists - active OR PAUSED - so a base change can never
   silently reinterpret an allowance's minor units at a different currency scale (e.g. MUR to JPY is
   a 100x error); the user deletes allowances first. (A paused allowance is just as hazardous as an
   active one: pausing alone must not be enough to lift the block, since a later `resume` would
   otherwise gate stale-currency minor units against the new base's Available. `resume` also
   re-validates `currency == base_currency` itself, as defense in depth.)

5. **Refresh is calendar-aligned and does exactly one set-to-target top-up.** On unlock (after
   recurring materialisation, so income has landed), for each active recurring allowance where
   `today >= next_refresh_date`, perform one gated set-to-target refresh and advance
   `next_refresh_date` to the next boundary strictly after `today` (weekly = the row's `week_start`,
   default Monday, ISO 8601; monthly = the 1st). Missed periods collapse to a single top-up
   (§9.4). If the gate fails (insufficient Available), warn-and-do-not-refill: leave the anchor and
   `last_refresh_date` unchanged but still advance `next_refresh_date` (§6.2 decision 2, §9.2 step
   5), so the overspend keeps drawing from the old anchor and heals at the next funded period.
   Initial allocation happens at creation (anchor = target, gated), so the first period is partial.
   Refresh stays lazy on unlock with no background scheduler (NFR-Perf3). `today` uses the same UTC
   `date_naive()` the dashboard and recurring already use; device-local time (§9.1) is a known,
   repo-wide refinement tracked separately, not fixed piecemeal here.

## Consequences

- No cash-flow spine is needed for FR-3.4; the §11.2 gap is closed for allowances by reusing the
  existing dashboard aggregation.
- `DashboardData` gains an `allowancesReservedMinor` field (Rust + TS mirror + the round-trip test),
  and `usable_balance_minor` now nets allowances as well as goals. This is the only change to
  existing behaviour.
- Pause returns a reserve to Available for free (only active allowances count); resume re-allocates
  to target and is gated by Available at resume time (§13.8). A one-time allowance auto-closes
  (`active = 0`) once its derived balance is at or below zero; a positive leftover on manual
  close/delete/pause returns to Available.
- The reservation and refresh math are pure functions in `domain::allowance`, unit- and
  property-testable without a running app (targets for §13's invariants), consistent with
  `.claude/rules/engineering.md`. Money stays integer minor units end to end.

## Alternatives considered

- **Mutable stored `balance_minor` decremented on each tagged write.** Rejected: it uses a different
  accounting basis than `total_balance_minor`, breaking `Available = Total - Reserved` for
  pending-review / future-dated / dedup-flipped rows, and forces exact read-old-then-apply-new
  reversal on every transaction edit/delete. The derived anchor avoids both.
- **Store allowances in any currency, exclude foreign ones from Reserved (the goals approach).**
  Rejected for allowances: an allowance's whole purpose is real reservation, so a foreign allowance
  that reserves nothing is a confusing no-op; base-currency-only is simpler and money-correct.
- **Let `set_base_currency` proceed and re-scale or exclude existing allowances.** Rejected:
  honest offline re-scaling across currencies is impossible without a rate, and silent exclusion
  moves money; blocking with a clear message is the least-surprising behaviour.
- **Materialise each missed refresh (the recurring engine's model).** Rejected: set-to-target means
  only the current target matters, so one top-up is correct and cheaper (§9.4, ADR 0005 decision 1).
