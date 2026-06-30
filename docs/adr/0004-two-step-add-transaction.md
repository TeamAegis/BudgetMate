# 0004 - Two-step add: choose kind, then category, before the entry form

Status: Accepted (2026-06-30)

## Context

Adding a transaction dropped the user straight onto the entry form, where the category lived in a
dropdown (the inline split editor's first line) and the type (expense vs income) was implied by the
chosen category. Two problems followed from that:

- The dropdown was a buried, low-signal control on an already busy amount-first form, and the
  category is the single most important classifying decision for a transaction.
- There was no first-class way to record **income**: the form was framed as "Add expense", and
  income only happened if you happened to pick an income category from the dropdown.

The product targets users with little or no financial literacy, for whom one clear decision per
screen beats one dense form. The data model already attaches a `kind` (`expense` / `income` /
`transfer`) to each category, and Rust derives the transaction sign from that kind - so the type is
already a property of the category, not an independent field.

## Decision

Adding a transaction is a **two-step flow before the form**:

1. **Kind chooser** (`expenses/new`, `transaction-kind`) - a plain navigation list (Settings
   style, no Save bar): *Expense* (money out) or *Income* (money in).
2. **Category picker** (`expenses/new/:kind`, `category-picker`) - a navigation list of that kind's
   categories. The title reflects the branch.
3. **Entry form** (`expenses/new/:kind/:categoryId`, `transaction-form`) - the chosen category is
   **shown** as a tappable context row with its type tag, **not** re-picked. A simple entry has no
   type toggle and no category dropdown; the amount hint is phrased for the kind ("How much you
   spent" / "How much you received").

Supporting decisions:

- **The category carries the type.** Picking from the Expense vs Income branch sets the kind; Rust
  still derives the sign from the category. No new Rust, DTO, bridge, or ACL: the flow is
  presentation only over the existing `list_categories` + `create_transaction`.
- **Changing the category is lossless.** Tapping the category row reopens the picker carrying the
  in-progress entry in router nav state (`resume`); the picker forwards it to the form, which
  restores it. So changing your mind never discards a typed amount.
- **Splits remain progressive disclosure** (FR-1.2): the chosen category seeds the first split;
  "Split across categories" reveals the multi-line editor (with per-line category dropdowns) as
  before.
- **Editing is unchanged**: `expenses/:id/edit` opens the form directly with the inline category
  dropdown (the category is already known; the two-step picker is for *adding*).
- **Scan / OCR** navigates straight to the form (`expenses/new/expense/0`, kind defaulting to
  expense, category not yet chosen) with the OCR prefill, and suggests a category from the payee -
  it does not force the chooser, because the figures are what the user is confirming.

## Consequences

- Adding gains a clear, low-literacy-friendly path and a first-class income entry, at the cost of
  two taps before the form (the user explicitly chose the two-level structure over a single
  combined list).
- Route titles on the param-driven routes are now functions of the route params (`:kind`), so
  `App.syncHeader` resolves a `title` that may be a function. The back affordance is unchanged
  (history-based `Location.back()`), so Cancel / change-category / change-kind all fall out of the
  forward navigation for free.
- `SettingsRow` gains an optional `tone` input (`income` tints the leading icon positive-green);
  meaning is still carried by label + icon shape, never colour alone.

## Alternatives considered

- **One combined category list** (Expense and Income sectioned on a single screen). Fewer taps, but
  the user preferred two explicit levels (kind first), which also keeps each list short.
- **Keep the dropdown on the form.** Rejected: it buried the most important decision and gave income
  no first-class entry point.
- **A type toggle on the form** (expense/income segmented control). Redundant: the category already
  determines the type, and a toggle could contradict the chosen category.
