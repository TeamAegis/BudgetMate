# BudgetMate - Screen Specifications

Each screen maps to its **Figma node(s)**, the **FR IDs** it satisfies, the **components** it
uses (from `design-system.md` §7), the **data shown**, the **Rust command(s)** it calls via
`core/bridge`, and its **states**. Screens marked **[NEW]** are required by the FRs but absent
in the current Figma - design them to this spec.

> **Build status (added 2026-06-25).** A **Status:** line flags screens whose Rust commands are
> **not yet implemented** - the command names listed are the intended contract, not callable today.
> `[NEW]` is about Figma coverage; `[built]` and the Status lines are about code. See
> `architecture.md` §11 "Build status" for the full tally.

> Figma file: `PhqmuOWsxpnKjqIW6yJXge` (page `0:1`). Mobile artboards are 412×917.

---

## 1. Onboarding

### 1.1 Intro / Splash
- **Figma:** `122:69` / `131:157` (Mobile Home Page variants), desktop `118:2`.
- **FR:** entry; brand.
- **Components:** AppHeader (brand), hero illustration, primary button (*Get Started*).
- **Data:** none.
- **Commands:** none.
- **States:** static. Consolidate the two duplicate variants into one.

### 1.2 Income / Getting Started
- **Figma:** `131:157` (income), `122:147` (Getting Started, desktop).
- **FR:** onboarding, base currency (FR-1.4).
- **Components:** TextField (underline) for income, type-of-income selector, *Add a Goal* card.
- **Data:** initial income, base currency (default MUR).
- **Commands:** `set_onboarding_profile(income, base_currency)`.
- **Status (2026-06):** spec - `set_onboarding_profile` is not implemented; there is no income or
  onboarding-profile capture in the Rust core or Angular yet.
- **States:** empty/validation (amount required, numeric).

### 1.3 Set Passphrase + Biometrics **[NEW]**
- **FR:** FR-5.1, NFR-P2.
- **Components:** TextField (secure), biometric enable toggle, info note.
- **Data:** passphrase (never stored plaintext; derives SQLCipher key).
- **Commands:** `init_vault(passphrase)`, `enable_biometric()`.
- **States:** mismatch error, weak-passphrase warning, biometric-unavailable fallback.
- **a11y:** passphrase fields **must allow paste** (don't block it) and offer a **show/hide
  toggle** - WCAG 2.2 SC 3.3.7 (Redundant Entry) and SC 3.3.8 (Accessible Authentication, so a
  password manager can fill it).

---

## 2. Lock **[NEW]**

### 2.1 Lock Screen
- **FR:** FR-5.1, FR-5.2.
- **Components:** brand mark, screen title (token-sized via `--t-screen-title`), biometric prompt,
  passphrase fallback field.
- **Data:** none shown.
- **Commands:** `unlock_vault(passphrase)` / biometric via `tauri-plugin-biometric` →
  releases DB key into memory.
- **States:** prompting, authenticating, fail/retry, locked-out fallback to passphrase.
- **Behaviour:** shown on cold start and after idle/background (key zeroised on lock).
- **a11y:** the passphrase fallback field **must allow paste** and offer a **show/hide toggle**
  - WCAG 2.2 SC 3.3.7 (Redundant Entry) and SC 3.3.8 (Accessible Authentication; let a password
  manager fill it).

---

## 3. Home / Dashboard

### 3.1 Dashboard (populated)
- **Figma:** `124:224` (Mobile Home). Tokens validated from this node.
- **FR:** FR-3.x preview, entry points to FR-1.x/2.x.
- **Components:** AppHeader (brand + settings icon `124:297`); **BalanceCard** (`app-balance-card`,
  `124:302`) as the balance/summary **hero** - coral-40 fill + offset pink shadow, showing the live
  total balance from `get_dashboard()`; a "ready to spend" secondary line (total minus what is set
  aside for ongoing base-currency goals, phrased gently, never alarm-red, even when over-committed);
  a this-month-spend figure; a grid of **labelled** quick-action tiles (**ActionTile**, old-MCB-Juice
  layout: hero on top, then the tile grid) - *Add expense* (-> `/expenses/new`), *Scan receipt*
  (-> `/import`), *Add goal* (-> `/goals/new`); labelled tiles only, never icon-only; a lazily-loaded
  (`@defer (on viewport)`) trailing 6-month TOTAL-balance **TrendChart** (Chart.js, skipped entirely
  for an all-zero first run); a live **Recent activity** list and a **goals preview** (from
  `get_dashboard()` and `listTransactions`). Recent-activity rows reuse the monogram-avatar list row
  (income uses the positive tint paired with the signed amount, never colour alone) and show the
  base-currency equivalent for a foreign-currency transaction, same as the Expenses list. BottomNav
  (`124:355`).
- **Data:** `get_dashboard()` aggregates, as of today, total balance, usable ("ready to spend")
  balance, this-month spend, a trailing 6-month total-balance trend, and a top-3 ongoing-goals
  preview; recent transactions come from `listTransactions`. A confirmed transaction dated in the
  future is not counted until its date arrives, so the hero total and the trend's current-month
  point always agree. Non-archived accounts (and ongoing goals) in a currency other than the base
  currency cannot be honestly converted from an opening balance/reservation and are excluded from
  the totals; an info banner names the excluded count and links to Manage accounts.
- **Commands:** `get_dashboard()` -> `DashboardData` (total/usable balance, goals-reserved,
  this-month spend, balance trend, goals preview, excluded-account/goal counts, `isEmpty`);
  `listTransactions` for Recent activity.
- **Status:** implemented (issue #50). `get_dashboard` is live; the reporting aggregations (FR-3.3)
  remain the source for the Analytics screen's own spend breakdowns.
- **States:** loading (skeleton placeholders), teaching-empty (illustration + "Add an expense" CTA,
  shown only when there are no confirmed transactions, a zero total, no ongoing goals, and no
  foreign-currency account), populated, busy (a background refresh keeps the dashboard mounted with
  a spinner on the spend figure), error (banner, shown alongside a still-mounted dashboard on a
  refresh failure).

### 3.2 Dashboard (empty)
- **Figma:** `133:641`.
- **Components:** BalanceCard hero replaced by EmptyState (illustration + "Add an expense" CTA); the
  Recent activity and Goals sections keep their header + a one-line teaching prompt instead of
  vanishing.
- **Commands:** `get_dashboard()` reports `isEmpty: true` (no confirmed transactions, a zero total
  balance, no ongoing goals, and no non-archived foreign-currency account); `listTransactions`
  returns empty.

---

## 4. Expenses

### 4.1 Expenses list
- **Figma:** `131:21` (Mobile expenses), chart `132:477`, items `132:391`/`133:789`.
- **FR:** FR-1.1, FR-3.3 (trend), entry to FR-2.1/2.2.
- **Components:** AppHeader (titled "Expenses"), TrendChart, SegmentedToggle
  (Daily/Weekly/Monthly `133:799`), TransactionListItem ×N, FabMenu (`app-fab-menu`, `132:510` -
  labelled *Add expense* -> `/expenses/new` / *Scan receipt* -> `/import`), BottomNav.
- **Data:** balance summary, period trend, transactions for period.
- **Commands:** `list_transactions(period, filter)`, `get_trend(period)`.
- **States:** loading, empty ("no transactions yet" - add to design), populated, busy
  (import/scan running).
- **Layout:** the transaction list reserves `padding-bottom` ≥ ≈84px so the FAB never occludes the
  last row (see `design-system.md` §7 FAB).

### 4.2 Add / Edit Transaction **[partly NEW]**
- **FR:** FR-1.1 (+ FR-1.2/1.3/1.4 via sub-editors).
- **Adding is a two-step flow** (ADR 0004), one decision at a time before the form:
  1. **Kind chooser** (`expenses/new`, `transaction-kind`): a plain navigation list (Settings
     style, no Save bar) - *Expense* (money out) or *Income* (money in).
  2. **Category picker** (`expenses/new/:kind`, `category-picker`): a navigation list of that
     kind's categories. Title is the branch (*Expense* / *Income*). Choosing one pushes the form.
  3. **Entry form** (`expenses/new/:kind/:categoryId`, `transaction-form`): the chosen category is
     **shown** (a tappable context row with its type tag), **not** re-picked, so there is no type
     toggle and no category dropdown for a simple entry. The category carries the type; Rust derives
     the sign. Tapping the category row reopens the picker, carrying the in-progress entry in nav
     state so the change is lossless.
- **Editing** opens the form directly (`expenses/:id/edit`); the category is already known, so the
  inline category picker (SelectField) is used (the two-step picker is for adding).
- **Presentation:** full-screen pages (§8.0), lazy-loaded, route data
  `{ title, back: true, hideNav: true }`; the form title and amount hint are phrased per kind
  ("New expense"/"How much you spent" vs "New income"/"How much you received"). **Amount-first:**
  the amount is the hero field; Split and FX are progressively disclosed.
- **Components:** SettingsRow (chooser + picker rows; income uses the `tone="income"` tint), the
  category context row, CurrencyField (amount + currency + rate, the hero field), date picker,
  account picker (SelectField), note; inline split editor ("+ Split across categories", which seeds
  the first line from the chosen category). Back arrow = *Cancel*; *Save* in the fixed bottom
  `FormActions` bar (keyboard-safe). On the edit page **Delete** is the header danger icon (`trash`,
  via `HeaderActionService`) → ConfirmDialog.
- **Data:** draft transaction; categories (filtered by kind in the picker); accounts; rule preview.
- **Commands:** `save_transaction(dto)` (ACID), `preview_rules(draft)`. (No new Rust: the flow is
  presentation only - `list_categories` + `create_transaction` already carry everything.)
- **States:** validation (amount>0, category chosen, split sum=0 remaining), rule-applied
  indicator, save error; the picker has loading / empty (no categories yet → add one) states.

### 4.3 Split Editor **[NEW]**
- **FR:** FR-1.2.
- **Components:** SplitEditor (add/remove rows: category + amount), live "remaining: Rs X"
  that must reach 0.
- **Commands:** part of `save_transaction(dto.splits)`.
- **States:** unbalanced (blocks save, danger), balanced (enables save).

### 4.4 Scan Receipt (OCR) **[NEW]**
- **FR:** FR-2.1.
- **Components:** ReceiptScanSheet (camera/preview), progress, editable
  merchant/date/total fields, *Use* → prefilled Add Transaction.
- **Data:** image (local only), extracted fields + confidence.
- **Commands:** `extract_receipt(imagePath)` - one thin Rust command that calls
  `plugin:ocr|recognize_text` then runs the deterministic `rules::receipt::extract`, returning
  `{ engineAvailable, fields: { merchant, date, totalMinor } }`. Image picked via the file-open
  dialog (bridge `pickReceiptImage`). On "Use these details" the screen prefills the entry form
  directly (`/expenses/new/expense/0` router state, kind defaulting to expense and category not yet
  chosen) and suggests a category from the payee - it does **not** save. (Manual entry from the scan
  screen instead starts at the kind chooser `/expenses/new`.)
- **States:** picking, processing (off-thread - `extract_receipt` is async, native engine on
  Dispatchers.IO), review (editable), low-confidence (all fields empty → severe banner +
  manual-entry CTA), per-field not-detected (any subset of merchant/date/total empty → that
  field shows an advisory "Not detected - please enter" flag beneath it, per the per-field
  low-confidence state in ux-blueprint.md §5; the flag clears reactively as soon as the user
  types a value), engine-unavailable (plugin `NotImplemented` on desktop/iOS), failed
  (retry/manual entry). **Never auto-saves** - the user confirms on the Add expense page.

### 4.5 Import Wizard **[NEW]**
- **FR:** FR-2.2/2.3/2.4.
- **Components:** ImportWizard steps - file picker (dialog), CSV column-mapping,
  parsed-row preview, rule-applied list (shows matched rule), **dedup review** (keep/skip),
  confirm.
- **Data:** file (CSV/OFX/QFX), staged rows, rule matches, duplicate flags.
- **Commands:** `parse_import(path, format)`, `apply_rules(rows)`, `scan_duplicates(rows)`,
  `commit_import(resolved)` (ACID batch).
- **Status (2026-06):** spec - none of these commands exist yet. Parsing crates are selected and
  the dedup matcher is written (`rules/dedup.rs`) but unwired; the wizard is not built
  (`architecture.md` §8).
- **States:** picking, parsing, mapping (CSV), reviewing, dedup-flagged, committing, error
  (bad/again).

---

## 5. Goals

### 5.1 Goals - Ongoing / Completed **[built]**
- **Figma:** `132:237` (Ongoing), `137:3` (Completed), empty `133:557`.
- **FR:** FR-3.2.
- **Components:** AppHeader ("Goals"), `GoalProgressRow` ×N (tap to edit), Add button, BottomNav.
  Active goals list before completed; completed rows show a full track + check + strikethrough.
- **Data:** goals with `currentMinor`/`targetMinor`/`currency`/`targetDate`; `completed` derived.
- **Commands:** `list_goals`, `create_goal`, `update_goal`, `delete_goal`.
- **States:** loading (skeleton blocks), empty (illustration + CTA), populated, error, busy.
- **Layout:** the goals list reserves `padding-bottom` ≥ ≈84px so the FAB never occludes the last
  row (see `design-system.md` §7 FAB).

### 5.2 Add / Edit Goal **[built]**
- **FR:** FR-3.2.
- **Presentation:** a **full-screen page** (§8.0) - routes `goals/new` and `goals/:id/edit`,
  lazy-loaded, route data `{ title, back: true, hideNav: true }`.
- **Components:** FormField name, target + currency (amount row), "Saved so far", optional target
  date. Back arrow = *Cancel*; *Save* in the fixed bottom `FormActions` bar (keyboard-safe).
  On the edit page **Delete** is the header danger icon (`trash`, via `HeaderActionService`) →
  ConfirmDialog.
- **Commands:** `create_goal` / `update_goal` (major-unit `target`/`current` parsed to minor units
  in Rust), `delete_goal`.
- **States:** validation (name required, target > 0), save error, busy.

### 5.3 Goal detail / progress
- **Figma:** `133:530` (Goal List Progress), `130:90` (Frame 13 goal cards).
- **Components:** GoalProgressRow (large), contribution history.
- **Commands:** `get_goal(id)`, `add_contribution(id, amount)`.

---

## 6. Analytics

### 6.1 Analytics (populated) **[built]**
- **Figma:** `132:298` (header shell only - charts not yet designed).
- **FR:** FR-3.3.
- **Components:** AppHeader ("Analytics"), `PieChart`/`app-pie-chart` (spend by category),
  `LineChart`/`app-line-chart` (spend over time), a `SegmentedToggle` period filter (This month /
  Last 3 months / This year / All time) and a `SelectField` category filter, a total-spend `Card`,
  BottomNav. **Charts via bundled Chart.js** (`shared/charts/chart-setup.ts` registers only the
  pie/line controllers used).
- **Data:** one aggregated `ReportData` (total + by-category + over-time buckets), all computed in
  Rust (fx conversion, date bucketing, `pending_review` exclusion) - the frontend only formats.
- **Commands:** `get_report(period, categoryId?)` - one command covers both charts plus the total
  (frontend rule: keep the command surface small); the category filter's options reuse the existing
  `list_categories` command.
- **States:** loading (skeleton placeholders); populated (charts + total); error (aggregation failed
  - plain-language banner + retry; a refresh error while data is already on screen is shown as a
  banner alongside the still-mounted charts, not in place of them); busy (recomputing on
  filter/period change - the existing charts stay mounted with an inline spinner, UI stays
  responsive). **Empty has three distinct cases** (filters stay visible in all three, so the user can
  also just change them directly), so a user who genuinely has spend is never told they have none:
  - a category filter is active and matches no spend for the period - plain-language message ("No
    spending in this category for the selected period.") + a **Clear filter** action;
  - all categories, but the selected period has no spend - "No spending recorded for this period." +
    a **View all time** action;
  - all categories + all time + genuinely no spend anywhere - the true first-run case, shown with the
    teaching illustration (`133:806`) + "Add an expense" CTA.

---

## 7. Settings **[NEW]**

### 7.1 Settings list
- **FR:** FR-4.x, FR-5.2, FR-3.1, FR-2.3, FR-1.x (accounts/categories foundation).
- **Components:** **SettingsRow** (`app-settings-row`: leading Lucide icon + label + optional hint +
  trailing chevron/control) in **grouped** sections:
  - **Your money** -> Accounts, Categories, Budgets/Envelopes, Rules, Base currency.
  - **General** -> Export, Backup/Restore, About/Privacy note.
  - **Security** -> Lock timeout (and the biometric/lock controls, FR-5.x).
- **Commands:** `get_settings()`, `update_settings(dto)`.

### 7.1a Accounts **[NEW - FR-1.x foundation]**
- **FR:** underpins FR-1.1 (account picker), FR-1.4 (per-account currency), FR-3.x.
- **Components:** AppHeader (titled "Accounts" + back); in-content **Add** action button; list of
  accounts (name · type · currency · opening balance via the money pipe, Rs). The create/edit form is
  a **full-screen page** (§8.0) - routes `settings/accounts/new` and `settings/accounts/:id/edit`,
  route data `{ title, back: true, hideNav: true }` - with fields (name, type ∈
  cash|bank|card|wallet|other, ISO-4217 currency); the edit page exposes **Archive** as the header
  danger icon (`archive`, via `HeaderActionService`) → ConfirmDialog. Lucide icons (`wallet`,
  `pencil`, `archive`). Reached from Settings.
- **Commands:** `list_accounts(includeArchived)`, `create_account`, `update_account`,
  `archive_account`.
- **States:** loading · empty (seeded "Cash" account on first run, so rarely empty) · populated ·
  error · busy (saving). Archive hides from pickers, never deletes.
- **Notes:** v1 is effectively single default account (multi-account schema, **no switcher**).
  Opening-balance money entry lands with the CurrencyField (FR-1.4); accounts start at Rs 0.

### 7.1b Categories **[NEW - FR-1.x/FR-2.3 foundation]**
- **FR:** underpins category pickers (FR-1.1), the rule engine (FR-2.3), analytics (FR-3.3).
- **Components:** AppHeader (titled "Categories" + back); in-content **Add** action button; list
  (name · kind · parent). The create/edit form is a **full-screen page** (§8.0) - routes
  `settings/categories/new` and `settings/categories/:id/edit`, route data
  `{ title, back: true, hideNav: true }` - with fields (name, kind ∈ expense|income|transfer,
  optional parent); the edit page exposes **Archive** as the header danger icon (`archive`, via
  `HeaderActionService`) → ConfirmDialog. Tree via `parent_id`; the backend rejects
  cycles/self-parent. Lucide `tags`/`pencil`/`archive`.
- **Commands:** `list_categories(includeArchived)`, `create_category`, `update_category`,
  `archive_category`.
- **States:** loading · empty (default set seeded on first run) · populated · error · busy.

### 7.2 Budgets / Envelopes
- **FR:** FR-3.1.
- **Components:** EnvelopeCard ×N (category cap, spent/remaining bar, warning/over states).
- **Commands:** `list_envelopes()`, `save_envelope(dto)` (deferred; the EnvelopeCard grid is the
  populated target once they land).
- **Today:** Budgets is a **polished EmptyState** with plain-language copy (a "monthly limit for a
  category" framing, not the raw "envelope" term); the EnvelopeCard states below are the populated
  target once the envelope command and spent-vs-remaining logic land.
- **States:** loading, empty (polished, no caps set + CTA), populated - under / approaching (warning)
  / over (danger), error (load/save failed - plain-language + retry), busy (saving a cap).

### 7.3 Rules (if-then)
- **FR:** FR-2.3.
- **Components:** RuleBuilderRow ×N (ordered), add/reorder/delete. The add/edit form is a
  **full-screen page** (§8.0) - routes `settings/rules/new` and `settings/rules/:id/edit`, route data
  `{ title, back: true, hideNav: true }`; the edit page exposes **Delete** as the header danger icon
  (`trash`, via `HeaderActionService`) → ConfirmDialog. Recurring (`/settings/recurring`) follows the
  same page pattern
  (`settings/recurring/new`, `settings/recurring/:id/edit`) but has **no delete** - pause/resume
  stays on its list.
- **Commands:** `list_rules()`, `save_rules(ordered)`.

### 7.4 Export
- **FR:** FR-4.2.
- **Components:** `SegmentedToggle` format choice (CSV / Excel), *Export* `Button` -> system save
  dialog. No date-range picker in this slice (every transaction is exported); a range filter is a
  future addition, not a gap in this change.
- **Commands:** `export_transactions(format, destPath)` (`rust_xlsxwriter`/`csv`, one row per
  category split) + the `dialog` plugin's save picker (`core/bridge::pickExportDestination`).
- **Status (2026-07-14):** **implemented, desktop-first** (ADR 0006) -
  `src/app/features/settings/export/export.ts`, route `settings/export`. Android's SAF-backed save
  (`tauri-plugin-android-fs`) is **deferred** - on Android the screen shows an
  `app-banner tone="info"` ("Export is available on the desktop app for now") instead of the
  format/Export controls, detected via `getAppInfo()`.
- **States:** loading, empty (no transactions - Export disabled + hint), populated (format toggle +
  Export), busy ("Generating..." + spinner in the Export button, UI stays responsive), saved
  (success banner naming the row count + destination filename), error (plain-language banner +
  retry). The plaintext-export warning banner is persistent whenever the controls are shown.

### 7.5 Backup / Restore
- **FR:** FR-4.1/4.3.
- **Components:** BackupRestorePanel - *Create encrypted backup* → save/share;
  *Restore* → pick `.vaultbak` → passphrase → replace (merge deferred).
- **Commands:** `create_backup()` → file via dialog/fs (Android: `tauri-plugin-android-fs`);
  `restore_backup(backupPath, passphrase, mode)` (ACID, crash-safe swap - see ADR 0008).
- **Status (2026-07-14):** FR-4.1 **implemented desktop-first** (ADR 0007) - `create_backup` copies
  the already-encrypted SQLCipher DB bytes, bundles the non-secret salt/KDF params, and writes a
  `.vaultbak` envelope via the save dialog + `std::fs::write`; route `settings/backup`. FR-4.3
  restore is **implemented desktop-first, REPLACE mode only** (ADR 0008) - the same screen picks a
  `.vaultbak` file via the open dialog, prompts for the backup's own passphrase, confirms via
  `<app-confirm-dialog>` ("Replace all data?"), then validates + swaps the live database and meta
  sidecar for the backup's inside a crash-safe copy/rename sequence and reloads the webview on
  success. Android (both backup save and restore open) and Merge mode are deferred (the screen shows
  an info banner on Android, mirroring Export/ADR 0006).
- **States:** creating, written, restoring (busy, confirm-gated), restored (success banner + reload),
  wrong-passphrase/corrupt-backup error (plain-language, inline).

---

## 8. Forms, overlays & shared

### 8.0 Forms are pages (canonical pattern)

#### The pattern: routed pages, not modals
Every add/edit form in the app is a full-screen routed page, **not** a modal. Each former modal is a
pair of lazy routes `<area>/new` and `<area>/:id/edit` carrying route data
`{ title, back: true, hideNav: true }` (so the bottom nav is hidden on the task page). This covers
Add/Edit **Transaction** (incl. Split editor; `expenses/new`, `expenses/:id/edit`), **Rule**
(`settings/rules/...`), **Recurring rule** (`settings/recurring/...`), **Account**
(`settings/accounts/...`), **Category** (`settings/categories/...`), and **Goal** (`goals/...`,
FR-3.2). The list navigates to the page and hands the entity over via router state; the back arrow =
*Cancel* returns to origin unchanged. `transaction-form` is the canonical example.

#### Action placement (primary Save)
The back arrow is *Cancel*; the primary *Save* lives in a **fixed bottom action bar** (`FormActions`,
`app-form-actions`) that lifts with `var(--keyboard-inset)` so the Android soft keyboard never hides
it. The page body scrolls inside `.app-content`, which is extended by `var(--keyboard-inset)` and
reserves bottom padding so the focused bottom field clears both the keyboard and the Save bar. This
supersedes the earlier Save-in-the-header placement (see ADR 0003, form action placement, superseding
`0002` on this point).

#### Destructive actions (Delete / Archive)
A **danger icon-button at the top-right of the header** on the **edit** page only, published via
`HeaderActionService` (which carries an optional `icon: 'trash' | 'archive'`): **Delete**
(Transaction, Goal, Rule, `trash`) or **Archive** (Account, Category, `archive`), each opening a
`ConfirmDialog` (§8.2). Add pages omit it. Recurring has no delete (managed by pause/resume on its
list).

#### Two-step add-transaction flow
**Adding a transaction is a two-step pre-form flow** (ADR 0004): a kind chooser (`expenses/new`) then
a per-kind category picker (`expenses/new/:kind`), both plain navigation lists with **no Save bar**,
before the entry form (`expenses/new/:kind/:categoryId`). The form shows the chosen category (a
tappable context row), so a simple entry has no type toggle and no category dropdown. This is specific
to **adding** a transaction; every other add/edit form (and transaction *edit*) is a single page as
above. See §4.2.

#### Dropdowns on a form page
Dropdowns use `SelectField` (themed listbox - native `<select>` can't be styled in the WebView); it
sits inline on the page and overlays normally (no in-flow dialog expansion - forms are pages now). The
body scrolls with the scrollbar hidden (native-app feel).

#### Rationale and ADRs
`docs/adr/0002-page-based-forms-no-modals.md` (forms are pages), then ADR 0003 (form action
placement: bottom Save bar + header Delete, superseding `0002`'s Save-in-the-header); evidence:
`docs/design/research/mobile-ux-and-old-juice.md`.

### 8.1 Transaction popup
- **Figma:** `133:517` (POP-UP - Transaction). Superseded by the §8.0 form-page pattern above; the
  Add/Edit Transaction page (`expenses/new`, `expenses/:id/edit`) is the canonical entry point from
  the list. The old centred pop-up/modal is retired for forms.

### 8.2 Confirm / destructive dialog
- **Built:** `ConfirmDialog` (`app-confirm-dialog`), built on `app-modal`. It is the **only** overlay
  in the app: a small, content-sized centred dialog with `role="alertdialog"` and its message wired
  via `aria-describedby`. Used for delete, archive, restore-replace, over-budget acknowledgement.
  Two-button, danger styling on the destructive action; emits `confirm` / `cancelled`. `app-modal`
  is retired as a form container and now exists only as this confirm/alert substrate.

### 8.3 Banner / Toast **[NEW]**
- Success (saved, exported, backup written), warning (approaching cap, duplicates found),
  error (import failed). Semantic colours; non-colour-only (icon + text).

---

## 9. Cleanup backlog (Figma hygiene)
- Delete leftover delivery-app frames: **`2:5` Order Tracking**, **`2:244` Set Location**
  (hidden; contain map, "delivery man", street address - unrelated to BudgetMate).
- Normalise BottomNav: one label set (**Analytics**, not "Charts"), evenly spaced.
- Replace duplicate "Transaction" quick-action labels with real actions.
- Consolidate duplicate intro frames (`122:69` / `131:157`).
- Re-token coral-on-white small text to `--c-primary-700` for AA.
