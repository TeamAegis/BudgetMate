# Allowance (Envelope) System - Domain Logic Specification

Conceptual behavioral specification for the savings-backed allowance feature (FR-3.4). Domain
logic only: invariants, rules, worked examples, edge cases. No code, no database schema, no UI
implementation. All monetary examples use Mauritian Rupees (Rs).

This is the source of truth for how allowances *behave*. The data-model sketch (tables, DTOs) lives
in `architecture.md` §4; the load-bearing modelling decisions are recorded in
`adr/0005-allowance-envelope-imprest-model.md`; the requirement itself is FR-3.4 in
`functional-requirements.md`. The general finance concepts this builds on (envelope budgeting, the
imprest/float system, sinking funds) are in `financial-knowledge.md` §2.

Section map: definitions (§1-§3), the model and its formulas (§4-§5), the locked decisions (§6),
worked examples (§7-§9, §15), lifecycle (§10-§12), the invariant summary and edge cases (§13-§14),
and a UI/usability note (§16).

---

## 1. What an allowance is

An **allowance** is a virtual envelope that earmarks (reserves) a portion of the user's savings for
a specific kind of spending, for example a weekly personal allowance, a weekly transport allowance,
or any custom category the user defines. Money is not moved into a separate account; it stays in
savings but is **reserved** so the user knows how much is genuinely free versus spoken-for.

The allowance follows the **imprest system**, the same well-established accounting pattern used for
petty-cash floats: a fixed float (the **target**) is drawn down by spending and periodically
**restored to the target by adding back only what was drawn**, never refilled on top of the
leftover. This gives predictable, non-compounding behavior and a self-healing property (see §9). The
general concept is in `financial-knowledge.md` §2; here it is made precise for this app.

---

## 2. Vocabulary

| Term | Definition |
|---|---|
| **Savings total** (`Total`) | The actual balance in the savings account. Only changes on real cash events (income received, expense spent, refund). |
| **Reserved** | Sum of money earmarked by all active allowances. `Reserved = sum of max(0, balance_i)` across active allowances. |
| **Available** | Free, unspoken-for savings. `Available = Total - Reserved`. |
| **Allowance target** | The float amount the allowance is meant to hold each period (e.g. Rs 1,000/week). |
| **Allowance balance** | How much of the allowance currently remains. Starts at target, drawn down by spending, may go negative (overspend). |
| **Period** | The refresh cadence for a recurring allowance (weekly, monthly). |
| **Recurring allowance** | Refreshes back to target every period. |
| **One-time allowance** | Allocated once, never refreshes, auto-closes when spent. |
| **Refresh (top-up)** | The periodic event that restores a recurring allowance's balance to its target. |

---

## 3. Allowance vs goal vs category cap

These reserve money in opposite directions and must not be conflated:

| | **Allowance** (FR-3.4) | **Goal** (FR-3.2) | **Category cap** (FR-3.1) |
|---|---|---|---|
| Direction | Drawn **down** from a target | Accumulates **up** toward a target | Plain spent-vs-remaining |
| Money flow | Reserves savings, then spent | Contributes, then grows | Reserves nothing |
| Periodicity | Refreshed to target each period | Filled once, reached once | Resets each month |
| Purpose | Controlling spending with real reservation | Building toward a purchase | Reporting a limit |

An allowance is a spending cap that **tops up** and **earmarks real savings**; a goal is a savings
bucket that fills; a category cap only reports usage and reserves nothing.

---

## 4. The model: three balances and core invariants

### 4.1 The three balances

At all times:

```
Reserved  = sum of max(0, balance_i)   over all active allowances
Available = Total - Reserved
```

### 4.2 The four invariants

1. **Availability:** `Available = Total - Reserved` always holds.
2. **Total only moves on real cash:** allocation, refresh, target edits, pause and delete are pure
   **re-earmarking** (they move money between Reserved and Available) and never change `Total`. Only
   income, expenses, and refunds change `Total`.
3. **Negative balances reserve nothing:** an overspent (negative) allowance contributes `0` to
   Reserved (via the `max(0, ...)`), because you cannot reserve money you no longer have. The
   overspent portion has already left savings as a real expense.
4. **Spending inside an envelope does not reduce Available:** the money was already reserved, so
   spending it only shrinks `Total` and the allowance balance in lockstep. Only the *over-envelope*
   portion of an overspend reduces `Available` (worked in §7).

---

## 5. The top-up rule (set-to-target refresh)

### 5.1 The rule

A refresh **sets the allowance balance to its target**. Equivalently, it *adds only the missing
amount*:

```
amount_added = target - current_balance
new_balance  = target
```

"Add the missing" and "set to target" are mathematically identical; this is the heart of the
imprest model.

### 5.2 Behavior in every direction

- **Below target** (leftover carried over): tops up only the spent portion. Unspent money carries
  over; the reserve never compounds.
- **Negative** (overspent): heals back to target, absorbing the overspend (subject to the savings
  gate, §6).
- **Above target** (e.g. after a refund pushed it over): trims down to target, returning the excess
  to Available. Reductions are never gated.

### 5.3 The reservation cost of a top-up

How much *free* savings a top-up must earmark:

```
reserved_increase = target - max(0, current_balance)
```

This differs from `amount_added` when the balance is negative: the negative portion was already
spent and is not re-reserved.

---

## 6. Locked behavioral decisions

### 6.1 Decision table

| # | Situation | Decision |
|---|---|---|
| 1 | Transaction exceeds remaining allowance balance | **Allow overspend.** Balance goes negative; the over-envelope portion is drawn from Available. |
| 2 | Available savings cannot cover a scheduled refresh | **Warn and do not refill**, all-or-nothing. Balance left unchanged, user warned. No partial top-up. |
| 3 | Overspent balance reaches a refresh with sufficient savings | **Heal to full target** (set-to-target absorbs the overspend), gated by decision 2. |
| 4 | Pause or delete an allowance | **Reserved balance returns to Available.** |
| 5 | One-time allowance ends | **Auto-close when balance reaches 0 (or below); any positive leftover returns to Available.** |
| 6 | Target edited mid-period | **Applies immediately**: the difference is applied to the current balance now (§8; does not refund already-spent money). |
| 7 | Recurring refresh timing | **Calendar-aligned**: weekly = start of week, monthly = 1st of month. |

### 6.2 The savings gate

Applies to allocation, refresh top-ups, and target increases. An operation that would *increase*
Reserved is permitted only if `reserved_increase <= Available`. If not, **warn and do not apply** the
increase (all-or-nothing). Operations that *decrease* Reserved are never gated.

---

## 7. Worked example: overspend

Start: `Total = Rs 5,000`, no allowances, so `Reserved = 0`, `Available = 5,000`.

1. **Create** "Groceries" allowance, target Rs 1,000. Allocation earmarks 1,000 (gate: 1,000 <=
   5,000, ok).
   -> balance = 1,000, Reserved = 1,000, Available = 4,000, Total = 5,000.
2. **Spend Rs 600** tagged to Groceries. Real outflow.
   -> Total = 4,400, balance = 400, Reserved = 400, **Available = 4,000 (unchanged, spent from
   reserved money).**
3. **Spend Rs 600 again** (only Rs 400 remains, so overspend of Rs 200). Real outflow.
   -> Total = 3,800, balance = **-200**, Reserved = max(0, -200) = 0, **Available = 3,800** (dropped
   by exactly the Rs 200 over-envelope portion).

The Rs 400 spent inside the envelope never touched Available; the Rs 200 beyond it did. Invariant 1
holds throughout (`Available = Total - Reserved`).

---

## 8. Worked example: editing the target mid-period (delta-applied)

Editing the target applies the **difference** to the current balance immediately, so already-spent
money is not refunded:

```
delta       = new_target - old_target
new_balance = current_balance + delta
```

- **Raise** (Rs 1,000 -> Rs 1,500, balance 400, Rs 600 already spent): `delta = +500` -> balance =
  900. Reserved increases by 500 (gated: needs `500 <= Available`; else warn and do not apply). The
  spent 600 is **not** refunded; you simply have Rs 500 more headroom.
- **Lower** (Rs 1,000 -> Rs 800, balance 400): `delta = -200` -> balance = 200. Reserved decreases by
  200, Available += 200 (never gated).
- **Lower below what is already spent** (Rs 1,000 -> Rs 500, balance 400, Rs 600 spent): `delta =
  -500` -> balance = **-100** (now overspent against the *new* lower target). Reserved goes 400 -> 0,
  Available += 400. The negative balance correctly flags the overspend against the new target.

(Contrast with the rejected "set to new target" interpretation, which would jump the balance to the
full new target and silently refund this period's spending.)

---

## 9. Refresh behavior (recurring allowances)

### 9.1 Calendar alignment

- Weekly allowances refresh at the **start of the week** (Monday, ISO 8601; configurable); monthly at
  the **1st of the month**, regardless of month length (28/30/31 days). Calendar alignment sidesteps
  variable-length arithmetic.
- The **initial allocation happens at creation** (full target reserved immediately, gated), so the
  first calendar period is usually partial. Thereafter refreshes land on calendar boundaries
  regardless of creation day.
- **Timezone:** device-local time (offline-first). Refreshes are evaluated **lazily on app open /
  date rollover**, consistent with the no-background-scheduler rule (NFR-Perf3).

### 9.2 Refresh algorithm (per due allowance)

1. Compute `reserved_increase = target - max(0, balance)`.
2. If `reserved_increase <= 0` (balance at or above target): set balance = target, return any excess
   to Available. Done (never gated).
3. Else if `reserved_increase <= Available`: set balance = target, Reserved += `reserved_increase`,
   Available -= `reserved_increase`.
4. Else (**insufficient savings**): **warn and do not refill.** Leave balance unchanged.
5. Advance the schedule pointer to the current period either way (see §9.4).

### 9.3 Worked examples

- **Carryover, sufficient savings.** End of week 1: balance 400, Reserved 400, Available 4,000, Total
  4,400. Refresh -> `reserved_increase = 1,000 - 400 = 600`; 600 <= 4,000, ok. -> balance = 1,000,
  Reserved = 1,000, Available = 3,400, Total = 4,400 (unchanged, pure re-earmark). Only the Rs 600
  spent last week was topped up; the carried-over Rs 400 stayed put.
- **Healing an overspend, sufficient savings.** balance -200, target 1,000 -> `reserved_increase =
  1,000 - 0 = 1,000`; if `1,000 <= Available`, set balance = 1,000 (overspend absorbed). If
  `Available < 1,000`, warn and leave balance at -200.

### 9.4 Missed refreshes do not stack

Because a refresh *sets to target* rather than *adds a target*, if the app is not opened for several
periods, the lazy evaluation performs **one** top-up to the current target and advances the pointer
to the current period. Three missed weeks still yield a single Rs 1,000 envelope, not Rs 3,000. This
is an intended property of the imprest model.

---

## 10. One-time allowances

- Allocated once at creation (full target reserved, gated). **Never refreshes.**
- Drawn down by tagged spending; overspend allowed like any allowance (draws from Available).
- **Auto-closes when balance reaches 0 or below.** On auto-close there is nothing to return (balance
  is 0, or negative with the overspend already drawn from Available).
- If **closed early manually** (or deleted/paused) with a positive balance, the leftover returns to
  Available (per decision 4).

---

## 11. Pause and delete

- **Pause:** deactivate the allowance; its Reserved balance returns to Available. (Resuming
  re-allocates, gated by Available at resume time, and re-validates that the allowance's currency
  still matches the vault's base currency - see §4.2/ADR 0012 decision 4. Changing the base currency
  is blocked while any allowance exists, active or paused, so this should never actually fire in
  practice; it is a defense-in-depth check.)
- **Delete:** remove the allowance; its Reserved balance returns to Available.
- In both cases, historical transactions tagged to it remain intact for reporting.

---

## 12. Transaction tagging

- Tagging an allowance on a transaction is **optional**.
- **Tagged spend:** reduces `Total` (real outflow) and the allowance balance together; Reserved
  recomputes as `max(0, balance)`.
- **Untagged spend:** reduces `Total` and `Available` directly (no envelope involved).
- **Tagged refund / negative expense:** increases the allowance balance (may temporarily exceed
  target); the next refresh trims any excess back to target and returns it to Available.
- **Tagging targets an active allowance.** The UI category/allowance picker (issue #124) only offers
  active allowances, so tagging to a paused one is a plausible but not a normal path (for example, an
  older transaction edited after its allowance was paused). This is not enforced with a hard
  active-check at the data layer: doing so would risk wrongly blocking an edit to a transaction whose
  allowance happens to have been paused since it was tagged. A paused allowance's derived balance
  still includes such tags; it simply does not count toward Reserved while paused (§11).
- **A tag applies to the whole transaction, not to individual splits.** For a multi-category (split)
  transaction, `transactions.allowance_id` is a single column on the parent row, so tagging an
  allowance draws the transaction's full amount from that allowance, even though some splits may be
  categorised elsewhere. This matches the imprest model (an allowance tracks money set aside for a
  purpose, not a strict per-category ledger) and is not treated as a defect.

---

## 13. Invariants and properties (summary)

1. `Available = Total - Reserved` at all times.
2. `Total` changes only on real cash events (income, expense, refund); allocation/refresh/edit/
   pause/delete are pure re-earmarking.
3. Negative balances contribute 0 to Reserved.
4. Spending *within* an envelope leaves Available unchanged; only over-envelope overspend reduces
   Available.
5. **Self-healing:** overspends are absorbed at the next successful refresh, or clearly flagged
   (negative balance + warning) if savings cannot cover it.
6. **No stacking:** missed refreshes collapse into a single top-up.
7. **No compounding:** unspent balance carries over; only the spent portion is topped up.
8. Increases to Reserved are gated by Available (all-or-nothing, warn on failure); decreases are
   never gated.

These are the allowance additions to the Rust-enforced invariant set in `architecture.md` §4.2, and
a natural target for the property tests in `.claude/rules/engineering.md`.

---

## 14. Edge-case catalogue

| Case | Behavior |
|---|---|
| Allocate more than Available at creation | Warn; do not allocate (all-or-nothing gate). |
| Overspend, then refresh with enough savings | Heal to target (absorb overspend). |
| Overspend, then refresh **without** enough savings | Warn; leave negative; retry next period. |
| Leftover at refresh (underspent) | Carries over; top up only the spent portion. |
| Refund pushes balance above target | Allowed temporarily; next refresh trims excess back to target, excess -> Available. |
| Lower target below already-spent amount | Balance goes negative (overspent vs new target); freed reservation -> Available. |
| App unopened for several periods | Single top-up to current target; pointer advances to current period. |
| Created mid-week/mid-month | Full target reserved at creation; first calendar period is partial; subsequent refreshes calendar-aligned. |
| One-time allowance overspent | Draws from Available; auto-closes at <= 0 with nothing to return. |
| Pause/resume | Reserved returns on pause; re-allocated (gated) on resume. |

---

## 15. End-to-end scenario (two weekly allowances)

`Total = Rs 10,000`. User creates two weekly allowances: **Personal Rs 1,500**, **Transport Rs 800**.

- After creation: Reserved = 2,300, Available = 7,700, Total = 10,000.
- Week 1 spending: Personal -Rs 1,200 (tagged), Transport -Rs 900 (tagged, so overspend Rs 100).
  - Personal: balance 300. Transport: balance -100.
  - Total = 10,000 - 2,100 = 7,900. Reserved = max(0, 300) + max(0, -100) = 300. Available = 7,600.
  - (The Rs 100 transport overspend reduced Available by exactly 100: 7,700 -> 7,600. The rest came
    from reserved money.)
- Start of week 2 (calendar refresh), Available 7,600 comfortably covers both:
  - Personal: `1,500 - 300 = 1,200` topped up -> balance 1,500.
  - Transport: `800 - 0 = 800` topped up (heals the -100) -> balance 800.
  - Reserved = 2,300, Available = 7,900 - 2,300 = 5,600, Total = 7,900 (unchanged by refresh).
- Both envelopes are full again for week 2; only the spent/overspent portions were replenished, the
  Rs 300 personal carryover having been preserved into the top-up calculation.

---

## 16. Plain-language note (usability)

The internal terms above (Reserved, Available, imprest, top-up) are domain vocabulary, not UI copy.
Per `.claude/rules/design.md` and `financial-knowledge.md` §9, surface them in plain language, for
example "set aside", "free to spend", and "topped back up to your weekly amount". The over-allowance
state must be gentle and informational (a plain "Rs X over" with icon and label, never colour alone),
matching the over-budget guidance in `ux-blueprint.md` §5.

---

*End of specification. This describes intended domain behavior only; it prescribes no data
structures, algorithms-as-code, or interface design. Those are designed in `architecture.md` and the
design docs and validated with `/finance-check` and `/design-check`.*
