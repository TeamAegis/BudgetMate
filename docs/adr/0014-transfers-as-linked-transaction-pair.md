# 14. Account-to-account transfers as a linked transaction pair

Date: 2026-07-30

Status: Accepted.

## Context

Moving money between your own accounts (cash to savings, bank to wallet) had no representation. Users
had to fake it with an expense on one account and matching income on the other, which is wrong twice:
it inflates both spend and income totals, and it consumes real spending categories for money that
never left the user's control.

The schema already anticipated this: the `categories.kind` CHECK has allowed `'transfer'` since
migration 0001 (`docs/architecture.md`), `CategoryKind::Transfer` exists in the domain, and
`domain::transaction::signed_amount` carried a "full transfer semantics arrive later" note. Every
spend query filters `categories.kind = 'expense'` (`db::reports`, `db::budgets`).

## Decision

A transfer is **two ordinary transactions sharing a `transfer_group_id`** (migration 0006): the
source leg negative, the destination leg positive, both filed under a single `kind = 'transfer'`
category. Written by `db::transfers::create` inside ONE SQL transaction.

**v1 is same-currency only.** A cross-currency transfer needs a user-entered rate (there is no fx API
- the app is offline by design) and, because each leg converts to base separately, rounding on the two
legs can nudge the reported total balance. Refusing the mismatch preserves a property worth more than
the feature: a transfer provably cannot create or destroy money. Rust rejects a mismatch in plain
language, and the form's destination picker only offers accounts sharing the source's currency, so the
rule is visible rather than a save-time surprise.

Both legs are **visible in the transaction list**, labelled `Transfer` in the meta line, with the
income/expense colour tint suppressed so the amount reads neutral. Hiding them was considered and
rejected: money leaving an account with no visible trace reads as data loss.

Signs are applied explicitly in `db::transfers`, not derived from the category kind, because a
transfer is the one movement that is simultaneously an outflow and an inflow.

## Consequences

- Per-account balances, the ledger list, the balance trend, and export all keep working unchanged -
  they read `transactions`, and a transfer is just two more rows.
- Transfers are excluded from spend totals, budgets/envelopes, and the dashboard's this-month figure
  automatically, via the existing `kind = 'expense'` filters. A test asserts this rather than trusting
  it.
- `Transaction` gains `transfer_group_id: Option<String>` (mirrored in TS), which is what lets the UI
  label a leg.
- The `'transfer'` category is seeded by `seed_defaults`, NOT by the migration. Migrations run before
  seeding on a fresh vault, so seeding it in 0006 would have claimed category id 1 and shifted every
  default category's id (Groceries 1 -> 2, Salary 9 -> 10); ids are referenced by existing rows and by
  tests. It is topped up on its own guard so existing vaults get it too, and `seed_defaults`' "is this
  vault empty" check is now scoped to expense/income kinds.
- Create-only: there is no edit route, since a transfer is a pair and editing half of it would break
  the invariant. Correcting one means deleting the legs and re-entering.

## Alternatives considered

- **A dedicated `transfers` table.** Conceptually cleaner, rejected as far more invasive: per-account
  balances, the transaction list, the balance trend, and export would each have to learn about a
  second source of money movement, and every future reader would have to remember it too.
- **A single transaction with a `to_account_id`.** Rejected: an account's balance is the sum of the
  transactions belonging to it, so one row would have to be counted twice with opposite signs by
  every reader.
- **Cross-currency in v1.** Deferred (see above). Extending this model later is additive: the pair
  gains a rate on the destination leg.
