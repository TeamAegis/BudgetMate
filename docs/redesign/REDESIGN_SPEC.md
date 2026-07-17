# Redesign Spec - per-screen changes (retention pass, 2026-07)

Contract: C1 theme-locked (tokens only, zero token-value changes), C2 full parity (inventory:
`FEATURE_INVENTORY.md`), C3 UI-only (templates/SCSS/presentation TS; no Rust, no commands, no
schema, no business logic). Audit finding numbers reference `DESIGN_AUDIT.md`. Wireframes are
360x800-first.

Cross-cutting plumbing (used by several screens):
- **`friendlyDate` pipe** (`shared/pipes/friendly-date.pipe.ts`): ISO `YYYY-MM-DD` ->
  "Today" / "Yesterday" / "30 Jun 2026". Pure formatting (string + calendar comparison), no
  money, no business rules. Fixes finding 10.
- **Chart a11y**: remove the `visually-hidden` `<ul>` fallback from LineChart and PieChart
  (renders visibly on the release WebView - finding 1); fold the per-point summary into the
  canvas `aria-label` instead ("Your balance, end of each month: Feb Rs 0, ...").
- **Header long titles** (finding 3): `app-header` title gets `white-space: nowrap` +
  ellipsis and the leading/back column stays vertically centred against a single line; route
  titles are shortened to fit ("Budgets" for `/budgets`, "Import file" for `/import/file`).
  The Settings row label keeps the longer wording via its hint.
- **Display-label maps** (finding 12): tiny per-component constants mapping enum values to
  labels (cash -> Cash, bank -> Bank, card -> Card, wallet -> Wallet, other -> Other; expense ->
  Expense, income -> Income, transfer -> Transfer; daily/weekly/monthly/custom -> Daily/Weekly/
  Monthly/Custom; merchant -> Payee name; contains/equals -> contains/is exactly).
- **Saved confirmation** (finding 18): forms navigate back with `state: { saved: 'Expense' }`
  (label per entity); list screens render a transient polite Banner "Saved" (success tone,
  auto-dismiss ~2.5s, `aria-live=polite`). Implemented on the transaction flow first (the core
  loop), reused where cheap.

---

## S1. Home (`/home`) - findings 1, 5, 6, 7

Before: Total balance hero -> ready-line (small text) -> Spent card -> 6-month chart (+ visible
a11y list bug) -> tiles -> recent -> goals. Nothing actionable above the fold; hero answers a
slow-moving question.

After (hierarchy: hero number -> spend stat -> actions -> activity):

```
| BudgetMate                        [gear] |
| +--------------------------------------+ |
| | Ready to spend                       | |  <- BalanceCard, usableBalanceMinor,
| |  Rs 39,750                           | |     --t-balance, coral-40 fill
| | after Rs 5,000 set aside for goals   | |  <- sub-line (or "That's your whole
| +--------------------------------------+ |     balance - nothing set aside yet.")
| [Spent this month]  [Total balance]      |  <- compact stat chips; Total only
| [ Rs 1,250 so far ] [ Rs 44,750 ]        |     shown when reserved > 0
| Quick actions                            |
| [ + Add expense ] [ scan ] [ target ]    |  <- ActionTiles (unchanged targets)
| Recent activity                 See all  |
|  (M) Netflix  Entertainment  - Rs 250    |  <- top 5
| Goals                        All goals   |
|  Japan  [=======-------] Rs 0/200,000    |
| Balance trend                            |  <- @defer chart, LAST
|  (line chart)                            |
+---------[ FabMenu + ]--------------------+
| Home | Expenses | Goals | Analytics      |
```

- Hero: BalanceCard, label "Ready to spend", `usableBalanceMinor`. Sub-line from
  `goalsReservedMinor` (existing field; no math in TS).
- Stat row: "Spent this month" card (kept, made compact); "Total balance" compact card shown
  only when `goalsReservedMinor > 0` (otherwise it duplicates the hero).
- Order: hero -> stats -> Quick actions -> Recent activity (cap 5) -> Goals -> trend chart
  (deferred) last. Chart keeps its skip-when-all-zero rule.
- Add the FabMenu (same three items as Expenses) so quick-add is in the thumb zone (P2/P9);
  page reserves FAB bottom padding.
- Teaching empty state, caveat banner, error/refresh states unchanged.
- Primary action: FabMenu "Add expense". Eye path: hero number -> spent -> tiles.

## S2. Expenses list (`/expenses`) - findings 9, 10, 18

- Date group headings use `friendlyDate` ("Today", "Yesterday", "30 Jun 2026").
- FabMenu items become: *Add expense* -> `/expenses/new/expense`, *Add income* ->
  `/expenses/new/income`, *Scan receipt* -> `/import` (label honesty; one tap saved; income
  gains an honest entry point). The `/expenses/new` kind chooser remains routed (generic entry
  points and deep links).
- Transient "Saved" banner on return from a save.
- Everything else (cards, monograms, signed amounts, chevron, states) stays.

## S3. Kind chooser (`/expenses/new`) - unchanged behaviour

Kept as the generic entry decision (ADR 0004). Empty-state CTA on Expenses continues to target
it. No spec changes beyond copy already in place.

## S4. Category picker (`/expenses/new/:kind`) - finding 14

- Rows swap the identical tag icon for a **monogram avatar** (first letter, `--size-avatar-sm`,
  `--c-primary-05` fill; income kind uses `--c-positive-soft`) - the same avatar language as
  transaction rows, giving each row a distinct shape anchor.
- Row density tightened (SettingsRow stays; vertical padding to `--space-3`) so ~8 categories
  fit one 800px viewport with the prompt.
- Alphabetical order kept (most-used ordering deferred - blueprint section 11).

## S5. Entry form (`/expenses/new/:kind/:categoryId`, `/expenses/:id/edit`) - findings 8, 12, 18, 21

```
| <- New expense                           |
|  AMOUNT                                  |
|  [ Rs | 0.00              ] [MUR]        |  <- hero: --t-balance-scale digits
|  How much you spent.                     |
|  ( tag ) Category                        |
|          Dining  [Expense]            >  |
|  + Split across categories               |
|  Account   [ Cash . MUR        v ]       |
|  Date      [ 17/07/2026        v ]       |
|  Payee (optional) [ e.g. Winners ]       |
|  Note (optional)  [              ]       |
|  [__________  Save  __________]          |
```

- Amount input becomes the hero: larger type (font-size `--t-balance`, weight
  `--fw-extralight`, `--lh-tight`), full-width row with the currency field as a compact
  trailing chip. `inputmode=decimal` kept.
- Edit page: remove the double "Category" label stutter (section header shows only when
  splitting: "Split across categories").
- Currency helper: "Currency code, like MUR or USD" (finding 21); input uppercases as you type
  (presentation).
- On save: navigate back with the saved flag (S2).
- All other fields, validation, split editor, FX disclosure, rule-suggestion line: unchanged.

## S6. Transaction detail (`/expenses/:id`) - findings 10, 25

- Date row uses `friendlyDate`.
- Hero amount keeps the signed convention but drops to `--t-screen-title` scale with the
  payee/category context line under it - exact, not alarming (finding 25).
- Rows, Edit bar, Delete: unchanged.

## S7. Goals (`/goals`) + form + detail - findings 23, 26

- List: target amount drops the coral tint; "Rs 0 / Rs 200,000" renders in `--c-text` with the
  separator muted (colour reserved for signals - P6). Progress fill stays coral (brand).
- Goal detail: adds rows that already exist in the DTO - Target date (when set, friendlyDate)
  and "Saved so far" / "Target" as detail rows; status row kept. No new data, no math.
- Form: unchanged fields; saved-flag on return.

## S8. Analytics (`/analytics`) - finding 19

- SegmentedToggle labels: "Month", "3 months", "Year", "All" with single-line fitting (smaller
  `--t-caption` label size + flexible segment widths; no wrapping).
- Period-empty state copy kept ("No spending recorded for this period." + View all time).
- Charts: PieChart/LineChart lose the hidden DOM list (aria-label carries the summary).

## S9. Settings (`/settings`) - finding 2

- Base-currency row: the hint moves under the label (SettingsRow already supports hint) and the
  SelectField gets a stable width; the row stacks label+hint left, control right, and wraps the
  control BELOW the text on narrow widths instead of squeezing word-per-line.
- Auto-lock row: same layout treatment.
- Groups/rows otherwise unchanged.

## S10. Accounts (`/settings/accounts`, forms) - findings 12, 16, 21

- List add action: FAB (bottom-right) replaces the top-right "+ Add" button; hidden in the
  empty state (single CTA).
- List meta uses display labels ("Cash . MUR").
- Form: Type select shows Cash/Bank/Card/Wallet/Other; currency helper reworded; currency input
  uppercases. Fields and archive flow unchanged.

## S11. Categories (`/settings/categories`, forms) - findings 12, 16

- FAB replaces top-right Add; hidden when empty.
- List meta: "Expense" / "Income . under Food" - "Parent: -" never renders.
- Form: Kind select shows Expense/Income/Transfer; Parent select shows "None". Unchanged
  otherwise.

## S12. Budgets (`/budgets`, forms) - findings 3, 17, 24

- Route title -> "Budgets" (one line); Settings row keeps "Budgets / Envelopes" + hint.
- Empty state: single CTA only (FAB hidden while empty).
- Form: Monthly limit input left-aligned like every other amount; helper "In MUR - the currency
  your reports add up in."
- EnvelopeCard states unchanged (already on-spec).

## S13. Recurring (`/settings/recurring`, forms) - findings 11, 12, 13, 16

- List: amounts via the money pipe signed mode ("- Rs 250"); meta "Monthly . next 30 Jul 2026"
  (friendlyDate, no truncation - amount cell stops flex-squeezing the meta).
- FAB replaces top-right Add.
- Form: Schedule select shows Daily/Weekly/Monthly/Custom; "Next run date" helper becomes
  "When it is next added for you." (kills "materialise"); Category select shows the category
  name only.

## S14. Rules (`/settings/rules`, forms) - findings 15, 16, 17

- List: FAB replaces "+ Add rule"; empty state single CTA.
- Form reads as a sentence (labels only; same controls, same DTO values):
  - Section "When" - "Look at" (Field: "Payee name"...), "Match" (Operator: "contains" /
    "is exactly"), "Text" (Value).
  - Section "Then" - "Change" (Set field: "Category"), and when Set field = category the
    "To" control is a **SelectField of existing categories** (options from the already-loaded
    `list_categories`; stores the same string value the free-text stored). A free-text fallback
    remains for any non-category set-field the DTO allows.
- Delete/order semantics unchanged.

## S15. Scan receipt (`/import`) - finding 20

- Idle: explainer + "Choose an image" move ABOVE the illustration (primary action above the
  fold); illustration shrinks to a supporting size (max-height capped). Privacy note kept
  verbatim (trust copy).
- Review states unchanged (already well-specified).

## S16. Import CSV (`/import/file`) - findings 3, 4, 22

- Route title -> "Import file" (single line).
- Idle: account select + "Choose a CSV file" button + nothing-saved promise all above the fold;
  illustration below, capped.
- Account option text "Cash . MUR" (consistent formatting).
- Mapping: preview table gets `overflow-x: auto` with a visible scrollbar (the design-system
  long-list exception) and non-truncating headers; malformed preview rows render muted with
  their reason.
- Reviewing/committing/done unchanged.

## S17. Export / Backup (`/settings/export`, `/settings/backup`)

- No behavioural change (desktop-first per ADR 0006/0007/0008). Android info banners stay.

## S18. Unlock / Setup (`/unlock`, `/setup`)

- No structural change. (Biometric arrives with its feature work, not this pass.)

## Inventory mapping

Every FEATURE_INVENTORY item keeps its screen; relocations: add buttons (Accounts, Categories,
Recurring, Rules: top-right button -> FAB), income entry point (kind chooser -> also a labelled
FabMenu item), Home section order (chart to last), scan/import CTAs (above the illustration).
Nothing is removed; no new capability is introduced (the Add-income FabMenu item routes to the
existing `/expenses/new/income`; the rules To-value select stores the same value the text field
did).

## Self-critique pass (applied)

- "Is one thing clearly primary per screen?" Home = hero number vs FabMenu: the FabMenu is the
  single ACTION emphasis; the hero is display emphasis - acceptable pairing (number to read,
  button to press). Tiles demoted visually (quiet `--c-primary-05`).
- "Generic template answer?" The hero label uses the app's own vocabulary ("Ready to spend"
  from the existing readyToSpend line) rather than a generic "Available balance"; the sub-line
  teaches the goals feature with real numbers.
- "C1/C2/C3 violations?" Checked per screen above; the only near-line item is the rules
  category SelectField - it swaps a control type but stores the identical value (C2-safe,
  error prevention).
- "Remove one decorative element": Home loses the pre-actions chart position; goals list loses
  the coral target number; import screens lose full-bleed illustrations.
