# 0012 - Allowance `Total` is the derived dashboard balance; allowances are base-currency only

Status: Accepted (2026-07-28)

## Context

ADR 0005 locked the allowance (envelope) reservation model - the imprest set-to-target top-up, the
three balances (`Total`, `Reserved`, `Available`), and the all-or-nothing savings gate - but left one
question open: "the feature depends on a concept of a savings `Total` / `Available` balance... the
source of `Total` must be pinned down when the feature is scheduled for build" (ADR 0005,
Consequences). `architecture.md` §11.2 records the same open question as part of the broader
"no income / cash-flow spine" discussion. Issue #123 schedules the Rust reservation engine, so this
decision can no longer stay open.

Separately, the Home dashboard (issue #50) already computes a base-currency "total balance" -
`db::dashboard::total_balance_minor` (now extracted as its own function) - as the sum of
base-currency accounts' opening balances plus every confirmed (`pending_review = 0`),
not-future-dated transaction's own `base_amount_minor`, as of `today`. This is exactly the "actual
savings balance" `docs/allowances.md` §2 defines as `Total`.

## Decision

1. **`Total` is the existing dashboard total-balance aggregation, computed as of `today`, and it is
   NEVER stored.** `db::dashboard::total_balance_minor` (extracted from `db::dashboard::dashboard`
   so both the Home dashboard and `db::allowances` share one implementation) is the single source of
   truth. No new ledger, sub-account, or cached balance is introduced for allowances - this mirrors
   ADR 0005's "reservation is a view over one savings balance, not a real transfer" and avoids two
   codepaths ever disagreeing about what "your savings" means.

2. **Allowances are base-currency only.** `currency` is validated to equal the vault's base currency
   at creation (`domain::allowance::validate_allowance`); there is no per-allowance fx rate. This
   keeps `Reserved`/`Available` arithmetic exact integer minor-unit math against `Total` (itself
   base-currency), with no conversion assumptions about a floating base-currency setting change
   after the fact.

3. **`Reserved` sums ONLY active, base-currency allowances**: `Reserved = sum(max(0, balance_i))`
   over allowances where `active = 1 AND currency = base_currency`. `Available = Total - Reserved`.
   A defensive `excludedAllowances` count (mirroring `DashboardData.excludedAccounts` /
   `.excludedGoals`) is exposed in case a future base-currency change ever leaves a stale
   non-base-currency row - the UI can surface the same caveat pattern already established for
   accounts and goals.

4. **`balance_minor` per allowance IS stored** (unlike `Total`), because a set-to-target refresh is
   not invertible from the ledger: after topping up, the pre-refresh balance (how much of the target
   was actually spent) is gone unless persisted. Only the aggregate `Total` is re-derivable from the
   ledger on demand; the per-allowance running balance is not.

5. **Editing or deleting a transaction from a PRIOR period may push a tagged allowance's balance
   above its target.** Because `Total` is always "as of today" and the allowance balance is a
   running total since its last refresh, retroactively reducing an old expense (or deleting it) can
   land a balance above target between refreshes. This is accepted, not treated as an error: it is
   the exact §12 "tagged refund" case already specified (a refund/negative-expense may temporarily
   exceed target) - the next scheduled refresh trims the excess back to target and returns it to
   `Available`, same as any other above-target balance. No special-case correction code is added.

## Consequences

- One dashboard total-balance implementation serves both Home and Allowances; a future change to
  what counts toward `Total` (e.g. a new account type, a cash-flow spine) automatically applies to
  both without a second update site.
- Allowances cannot be created or edited in a foreign currency; a user wanting a foreign-currency
  envelope must first convert their thinking to the base currency (consistent with how goals already
  net only base-currency `current_minor` into the dashboard's usable balance).
- `db::allowances::refresh_due` must run AFTER `db::recurring::materialise_due` on every lazy
  evaluation point (app unlock, restore) - materialised recurring transactions can change `Total`
  before an allowance refresh reads it in the same pass. Both remain lazy, no background scheduler
  (NFR-Perf3).
- **Goals and Allowances reserve independently against the same derived `Total`, and neither nets
  the other.** Home's `usable_balance_minor = Total - goals_reserved_minor`
  (`db::dashboard::dashboard`) and `AllowanceSummary.available_minor = Total - reserved_minor`
  (`db::allowances::summary`) each subtract only their own pool. A user can therefore earmark the
  same rupees via a goal AND an allowance at the same time, and "Available" on the two screens can
  overstate together (neither figure accounts for the other's reservation). This is an accepted,
  known v1 limitation, not a bug: reconciling the two into one shared reservation figure is deferred
  to the Home-integration UI issue, so that issue #50's already-tested `DashboardData` DTO shape
  stays stable in this change.
- **Tagging a non-expense (income/refund) transaction to an allowance is permitted by design**
  (`docs/allowances.md` §12: a tagged refund raises the allowance balance, possibly above target).
  For a **one-time** allowance, which never refreshes, a tagged refund can leave the balance above
  target indefinitely - there is no automatic trim (that only happens on a recurring allowance's next
  refresh). The excess is freed only by a manual edit, pause, or delete. Known v1 limitation.
- **Scarce-funds refresh ordering is ascending id (creation order).** When `refresh_due` cannot fund
  every simultaneously-due allowance from `Available`, it processes rows in `id ASC` order (see the
  `ORDER BY id ASC` in `db::allowances::refresh_due`), so earlier-created allowances are topped up
  first and later ones are more likely to be left underfunded (warned, balance unchanged) in a given
  pass. This is the v1 tie-break; there is no priority/ordering setting.
- **One-time allowance auto-close is forward-only.** Once a one-time allowance's balance reaches 0
  (or below) it auto-closes (`docs/allowances.md` §10); a later reversal (editing/deleting a prior
  transaction, or a tagged refund) that lifts the stored balance back above zero does **not**
  reactivate it. This is locked intended behavior, not a bug to fix - a closed one-time allowance
  only comes back via a new allowance or a manual edit.

## Alternatives considered

- **A dedicated "savings" account/ledger just for allowances.** Rejected: it would duplicate the
  ledger's role, invite the two balances to drift, and contradicts ADR 0005's explicit rejection of
  "move money into a separate savings sub-account".
- **Storing `Total` (a cached running balance).** Rejected: `Total` is cheaply and exactly
  re-derivable from existing rows (the dashboard already does this every load); a cached value would
  need its own invalidation/reconciliation logic and could silently drift from the ledger, which is
  exactly the failure mode the derived approach avoids.
- **Allow allowances in any currency, converted via a stored rate.** Rejected for v1: no fx rate
  exists for an opening/reserved balance the way it does for a single transaction (ADR forthcoming
  territory already flagged for accounts/goals in `db::dashboard`'s `excludedAccounts`/
  `excludedGoals`); scoping allowances to the base currency keeps the reservation math exact and
  defers the same open fx question already deferred for accounts and goals.
