# 0005 - Savings-backed allowances use the imprest (set-to-target) model

Status: Accepted (2026-07-09)

## Context

Users asked for a way to cap discretionary spending (a weekly personal allowance, a transport
allowance, and similar) that is stronger than the category envelope cap of FR-3.1. A cap only reports
spent-vs-remaining; it does not tell the user how much of their savings is genuinely free once these
commitments are set aside. The requested feature reserves real savings against each allowance and
tops it back up on a cadence.

Two modelling questions were load-bearing and not obvious from code, so they are recorded here.
First, how a periodic top-up computes the new balance (this drives carryover, overspend healing, and
what happens after the app is closed for weeks). Second, how the reservation interacts with the
actual savings balance when funds are tight. The full behavioral specification (invariants, worked
examples, edge cases) is `docs/allowances.md`; this ADR captures only the decisions and why the
alternatives were rejected.

## Decision

1. **Imprest, set-to-target top-up.** A refresh **sets the balance to the target** (equivalently,
   adds only `target - current_balance`), rather than adding a full target each period. Unspent
   balance carries over, the reserve never compounds, and missed periods do not stack: opening the
   app after three missed weeks performs a single top-up to the current target, not three.

2. **Three balances with a max-zero reserve.** `Available = Total - Reserved` where
   `Reserved = sum of max(0, balance_i)` over active allowances. `Total` (real savings) changes only
   on real cash events (income, expense, refund); allocation, refresh, target edits, pause and delete
   are pure re-earmarking and never change `Total`. An overspent (negative) allowance reserves
   nothing, so only the over-envelope portion of an overspend reduces `Available`.

3. **Savings gate, all-or-nothing on increases.** Any operation that would raise `Reserved`
   (allocation, refresh top-up, target increase) is permitted only if `reserved_increase <=
   Available`; otherwise the app **warns and does not apply** it (no partial top-up). Operations that
   lower `Reserved` are never gated.

4. **Overspend is allowed.** A tagged transaction may drive the balance negative; the excess is drawn
   from `Available`. The next successful refresh heals the overspend by absorbing it into the
   set-to-target top-up (gated by decision 3).

5. **Calendar-aligned, lazily evaluated refresh.** Weekly refreshes land on the start of the week
   (Monday, ISO 8601, configurable), monthly on the 1st, independent of the creation day. Refreshes
   are evaluated lazily on app open / date rollover using device-local time; there is no background
   scheduler (NFR-Perf3). Initial allocation happens at creation, so the first calendar period is
   usually partial.

6. **Target edits apply immediately as a delta.** Editing the target applies `new_target -
   old_target` to the current balance now, so already-spent money is never refunded (a lower target
   can push the balance negative against the new target).

7. **Allowance is distinct from goal and from the category cap.** An allowance is drawn **down** from
   a reserved float (FR-3.4); a savings **goal** accumulates **up** toward a target (FR-3.2); a
   **category envelope cap** (FR-3.1) is a plain monthly spent-vs-remaining limit that reserves
   nothing. The three are modelled separately and not conflated.

## Consequences

- The model is self-healing and non-compounding: overspends are absorbed at the next funded refresh
  or clearly flagged (negative balance plus warning) when savings cannot cover them, and the reserve
  can never balloon from carried-over or missed periods.
- The feature depends on a concept of a savings `Total` / `Available` balance. This intersects the
  open "no income / cash-flow spine" question in `architecture.md` §11.2; the source of `Total` must
  be pinned down when the feature is scheduled for build.
- New Rust-enforced invariants are added (`architecture.md` §4.2) and a new `allowances` table plus
  an optional per-transaction allowance tag are sketched (§4.1). Money stays integer minor units; the
  reserve arithmetic is exact and lives in Rust (`.claude/rules/rust.md`).
- All top-up, gate, and refresh logic is deterministic and unit-testable without a running app, and
  is a natural target for the property tests in `.claude/rules/engineering.md` (reserve never
  negative, `Total` invariant under re-earmarking, idempotent lazy refresh).

## Alternatives considered

- **Add-a-target top-up** (credit a full target every period). Rejected: it compounds unspent money
  and makes missed periods stack (three missed weeks would add Rs 3,000), which is neither the
  petty-cash mental model nor what the user wants.
- **Set-to-target on target edits** (jump the balance to the whole new target mid-period). Rejected:
  it silently refunds the period's spending; the delta rule preserves what was actually spent.
- **Partial top-up when savings are short** (reserve whatever is available). Rejected in favour of
  all-or-nothing plus a warning, so an allowance is never left in a confusing half-funded state.
- **Move money into a separate savings sub-account.** Rejected: reservation is a view over one
  savings balance, not a real transfer; it keeps `Total` truthful and avoids inventing internal
  transfers.
- **Reuse the goal or the FR-3.1 cap.** Rejected: goals move the opposite direction and caps reserve
  nothing (see decision 7).
