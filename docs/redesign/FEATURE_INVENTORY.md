# Feature Inventory - parity contract for the retention UI redesign

Compiled 2026-07-17 from `screenshots/*.png` (42 captures, release Android build), the route
config (`src/app/app.routes.ts`), every feature template, and `docs/design/screens.md`. This is
the C2 parity contract: every row below must exist and be reachable in the redesigned UI, and
nothing may be added beyond it. The Verification Report maps each item to its new location.

Legend: SS = screenshot evidence, CODE = component evidence. States listed are the ones that
exist in code today (the five-state rule of `ux-blueprint.md` section 5 applies to all).

## 0. Global chrome and cross-cutting

| Item | Details | Source |
|---|---|---|
| App shell | AppHeader + `.app-content` + BottomNav; `chromeless` routes (setup/unlock) skip header/nav | CODE `src/app/app.html` |
| AppHeader | Brand wordmark (Home) or route `data.title`; back arrow on pushed routes (= Cancel on forms); trailing settings gear only on top-level tabs; header action slot (danger trash/archive icon on edit pages) via `HeaderActionService` | SS 01-43, CODE `shared/ui/app-header` |
| BottomNav | 4 tabs: Home, Expenses, Goals, Analytics (Lucide house/wallet/target/pie-chart + labels, active = coral) | SS 02/03/08/10 |
| Dev diagnostics strip | core version / db ok / schema - dev mode only (`isDevMode`) | CODE `app.html` |
| Lock on background / idle | auto-lock timeout, key zeroised; unlock guard on every feature route | CODE `core/lock` |
| Deep links | all routes listed below are addressable; `**` redirects to home | CODE routes |
| ConfirmDialog | the only overlay: delete (transaction, goal, budget, rule), archive (account, category), restore-replace | CODE `shared/ui/confirm-dialog` |
| Banner | error / warning / info / success tones, inline | CODE `shared/ui/banner` |
| PrivacyNote | "Your data is encrypted on this device. Nothing leaves your phone. No analytics." | SS 11c |
| Money pipe | minor units -> "Rs 1,234" (whole) / "Rs 1,234.56"; `signed` mode +/-; base-currency approximation for foreign rows | CODE `shared/pipes/money.pipe.ts` |
| FabMenu | Expenses primary action: tap-to-open, labelled items, scrim, Escape/outside close | SS 03b |
| Skeleton / Spinner | loading placeholders on every data screen | CODE |

## 1. Setup / Unlock (`/setup`, `/unlock` - chromeless)

| Feature / control | Details | Source |
|---|---|---|
| Shield brand mark + title | "Unlock BudgetMate" / setup variant creates the vault | SS 01 |
| Passphrase field | secure input, paste allowed | SS 01 |
| Show passphrase toggle | eye icon + label | SS 01 |
| Unlock / Create button | primary CTA; error state on wrong passphrase | SS 01, CODE `features/lock` |
| States | prompting, authenticating (busy), fail/retry | CODE |

## 2. Home (`/home`)

| Feature / control | Details | Source |
|---|---|---|
| Total balance | BalanceCard hero, `d.totalBalanceMinor` | SS 02 |
| Ready-to-spend line | usable balance + explainer (goals reserved), hidden when nothing reserved | CODE `home.html` 29-36 |
| Spent this month card | `d.thisMonthSpendMinor` + "so far" + refresh spinner | SS 02 |
| Excluded-accounts caveat | info banner + "Manage accounts" link (foreign-currency accounts) | CODE `home.html` 47-51 |
| Balance trend chart | 6-month line chart, `@defer (on viewport)`, hidden when all-zero | SS 02, CODE |
| Chart a11y data list | per-month label+amount pairs (currently `visually-hidden`, renders visibly on device - bug) | SS 02, CODE `line-chart.ts` |
| Quick actions | ActionTiles: Add expense -> `/expenses/new`, Scan receipt -> `/import`, Add goal -> `/goals/new` | CODE `home.html` 62-73 |
| Recent activity | last transactions, monogram avatar, signed amount, base approximation; "See all" -> `/expenses`; empty line | CODE `home.html` 75-102 |
| Goals preview | GoalProgressRow list; "All goals" link; empty line | CODE `home.html` 104-125 |
| Teaching empty state | illustration + "Add an expense" CTA when `isEmpty` | CODE |
| States | loading skeletons, error banner + retry, warning banner on refresh error | CODE |

## 3. Expenses list (`/expenses`)

| Feature / control | Details | Source |
|---|---|---|
| Date-grouped list | heading per date (currently raw ISO), cards with monogram, name, category . account meta, signed amount, base approximation, chevron | SS 03 |
| Row tap -> detail | `/expenses/:id`, keyboard accessible | CODE |
| FabMenu | Add expense / Scan receipt (labelled), X to close, scrim | SS 03b |
| Empty state | illustration + "Add your first transaction" CTA | CODE |
| States | loading skeleton groups, error banner | CODE |
| Row enter animation | `list-item-enter` + capped stagger | CODE |

## 4. Add-transaction flow (ADR 0004)

### 4a. Kind chooser (`/expenses/new`)
| Feature | Details | Source |
|---|---|---|
| "What are you recording?" | Expense (money going out, trending-down icon) / Income (money coming in, trending-up icon) rows | SS 04 |

### 4b. Category picker (`/expenses/new/:kind`)
| Feature | Details | Source |
|---|---|---|
| "Choose a category" list | per-kind categories, alphabetical, row tap -> form; resume state carries in-progress entry losslessly | SS 05/06, CODE `category-picker.ts` |
| Empty state | "No <kind> categories yet" + Add a category CTA -> `/settings/categories/new` | CODE |

### 4c. Entry form (`/expenses/new/:kind/:categoryId`) and edit (`/expenses/:id/edit`)
| Feature / control | Details | Source |
|---|---|---|
| Amount + Currency | text input `inputmode=decimal` + 3-letter currency input; hint "How much you spent/received." | SS 07 |
| FX rate field | shown when currency differs from base; hint explains conversion | CODE `transaction-form.html` 23-30 |
| Category context row (add) | shows chosen category + kind tag, tap to change (lossless); "Split across categories" link | SS 07 |
| Split editor | per-line category SelectField + amount, add/remove lines, "Left to allocate" / "Fully allocated" live line | CODE 63-112 |
| Category SelectField (edit) | inline dropdown on edit / split lines | SS 23 |
| Account SelectField | "Cash . MUR" | SS 07 |
| Date | native date input | SS 07 |
| Payee (optional) | rule suggestion on blur, with reason line ("set because ...") | SS 07, CODE 127-138 |
| Note (optional) | text input | SS 07 |
| Save | FormActions bottom bar, keyboard-lifted | SS 07 |
| Delete (edit only) | header trash icon -> ConfirmDialog | SS 23 |
| Validation | amount > 0, category chosen, split sum balanced; save error banner | CODE |

## 5. Transaction detail (`/expenses/:id`)

| Feature | Details | Source |
|---|---|---|
| Signed hero amount | red/green by direction | SS 22 |
| Detail rows | Type, Date (raw ISO today), Account, Category, Payee, (Note, splits when present) | SS 22, CODE `transaction-detail.html` |
| Edit | bottom FormActions bar | SS 22 |
| Delete | header trash -> ConfirmDialog | SS 22 |

## 6. Goals (`/goals`, `/goals/new`, `/goals/:id`, `/goals/:id/edit`)

| Feature / control | Details | Source |
|---|---|---|
| Ongoing / Completed toggle | SegmentedToggle | SS 08 |
| Goal cards | name, progress track + knob, "Rs cur / Rs target"; completed = full positive track + check + strikethrough | SS 08, CODE `goal-progress-row` |
| FAB | single action -> `/goals/new` | SS 08 |
| Add/Edit form | Name, Target + Currency, Saved so far, Target date (optional); Save bar; Delete on edit (header trash) | SS 09/13 |
| Goal detail | progress card, Status row (In progress/Completed), Edit bottom bar, Delete header trash | SS 12 |
| Empty state | illustration + CTA | CODE |

## 7. Analytics (`/analytics`)

| Feature / control | Details | Source |
|---|---|---|
| Period toggle | Month / 3 months / Year / All time | SS 10 |
| Category filter | SelectField "All categories" | SS 10 |
| Total spend card | money pipe, refresh spinner | CODE `reports.html` |
| Pie chart | spend by category, bundled Chart.js, legend | CODE |
| Line chart | spend over time | CODE |
| Three empty cases | category-filtered (Clear filter), period (View all time), true first-run (illustration + Add an expense) | SS 10, CODE |
| States | loading skeletons, error + retry, refresh warning banner | CODE |

## 8. Settings (`/settings`)

| Feature / control | Details | Source |
|---|---|---|
| Your money group | Accounts, Categories, Budgets / Envelopes, Recurring, Rules, Import transactions (rows with icon + hint + chevron) | SS 11 |
| General group | Export, Backup, Base currency (inline SelectField, curated 8 currencies) | SS 11b/11c |
| PrivacyNote | trust note | SS 11c |
| Security group | Auto-lock timeout SelectField (30s/1m/2m/5m/Never) | CODE `settings.ts` |

## 9. Accounts (`/settings/accounts`, `+/new`, `+/:id/edit`)

| Feature / control | Details | Source |
|---|---|---|
| Account list | name, type . currency meta, balance (money pipe), edit pencil | SS 14 |
| Add action | button (top-right today) | SS 14 |
| Form | Name, Type select (cash/bank/card/wallet/other), Currency free-text (any ISO code, helper text) | SS 15/16 |
| Archive (edit) | header archive icon -> ConfirmDialog; archived hidden from pickers, never deleted | SS 16 |

## 10. Categories (`/settings/categories`, `+/new`, `+/:id/edit`)

| Feature / control | Details | Source |
|---|---|---|
| Category list | name, kind + parent meta, edit pencil, Add action | SS 17 |
| Form | Name, Kind select (expense/income/transfer), Parent (optional, None) | SS 18/19 |
| Archive (edit) | header archive icon -> ConfirmDialog | SS 19 |

## 11. Budgets / Envelopes (`/budgets`, `/budgets/new`, `/budgets/:id/edit`)

| Feature / control | Details | Source |
|---|---|---|
| Envelope cards | category, cap/spent, pill track; under / approaching (icon + "Rs X left") / over (icon + "Rs Y over") | CODE `envelope-card` |
| Add | FAB + empty-state CTA (both today) | SS 20 |
| Form | Category select, Monthly limit (base currency helper); category+period fixed after create | SS 21 |
| Delete (edit) | header trash -> ConfirmDialog | CODE |
| Empty state | illustration + "Add your first budget" | SS 20 |

## 12. Recurring (`/settings/recurring`, `+/new`, `+/:id/edit`)

| Feature / control | Details | Source |
|---|---|---|
| Rule list | name, "Monthly . Next <date>" meta (truncates today), signed amount (bypasses money pipe today: "-250 MUR"), Edit pencil, Pause/Resume icons, paused visual state | SS 24, CODE `recurring.html` |
| Add action | button (top-right today) | SS 24 |
| Form | Schedule select (daily/weekly/monthly/custom), Next run date + helper, Account, Category, Amount + helper ("Expense or income is set by the category."), Payee, Note | SS 25/26 |
| No delete | pause/resume only (by design) | CODE |
| Lazy materialisation | occurrences added on app open (Rust) - surfaced in ledger | FR-1.3 |

## 13. Rules (`/settings/rules`, `+/new`, `+/:id/edit`)

| Feature / control | Details | Source |
|---|---|---|
| Rule list | ordered rules; reorder / delete affordances | CODE `rules.ts` |
| Add | "+ Add rule" top-right + empty CTA | SS 27 |
| Form | If: Field (merchant/payee...), Operator (contains/...), Value; Then: Set field (category), To value (free text today) | SS 28 |
| Delete (edit) | header trash -> ConfirmDialog | CODE |
| Empty state | "No rules yet." + CTA | SS 27 |

## 14. Scan receipt / OCR (`/import`)

| Feature / control | Details | Source |
|---|---|---|
| Idle | illustration, explainer copy, "Choose an image" CTA, on-device privacy note | SS 31 |
| Review | editable merchant/date/total fields, per-field "Not detected" advisory flags, low-confidence banner, engine-unavailable state (desktop), "Use these details" -> prefilled entry form, manual-entry fallback | CODE `import.ts` |
| Never auto-saves | user confirms on the entry form | CODE |

## 15. Import CSV file (`/import/file`)

| Feature / control | Details | Source |
|---|---|---|
| Idle | "Import into" account select ("Cash (MUR)"), helper, illustration, choose-file CTA, nothing-saved promise copy | SS 40 |
| Mapping | "File: statement.csv"; Date column + Amount column selects (required), sign helper; Payee/Note/Reference optional ("Not in this file"); first-rows preview table (incl. malformed rows) | SS 41/41b/41c/42 |
| Reviewing | summary, per-row rule-suggested category, duplicate keep/skip toggles (duplicates default skipped), malformed rows listed with reason, explicit "Import N transactions" | CODE `import-file.ts` |
| Committing / Done | spinner; inserted/skipped/malformed summary | CODE |
| Error | plain language + start over / try again | CODE |

## 16. Export (`/settings/export`)

| Feature / control | Details | Source |
|---|---|---|
| Android | info banner "Export is available on the desktop app for now." | SS 29 |
| Desktop | CSV / Excel toggle, Export -> save dialog, plaintext warning banner, success/error states, disabled when no transactions | CODE `settings/export` |

## 17. Backup / Restore (`/settings/backup`)

| Feature / control | Details | Source |
|---|---|---|
| Android | info banner "Backup is available on the desktop app for now." | SS 30 |
| Desktop | Create encrypted backup (.vaultbak) -> save dialog; Restore: pick file, passphrase, ConfirmDialog "Replace all data?", crash-safe swap + reload; wrong-passphrase / corrupt errors | CODE `settings/backup` |

## Out of inventory (do NOT add - Future Enhancements candidates live in the blueprint appendix)

FR-3.4 allowances (specified, unbuilt), streaks/badges, most-used category ordering (needs Rust
aggregation), dark mode (v2), Android SAF export/backup/restore (issues #112/#113/#116/#21),
OFX/QFX wiring (#13), dedup on manual entry (#15), contribution history on goals, onboarding
income capture (`set_onboarding_profile`).
