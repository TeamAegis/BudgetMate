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
- **Components:** brand mark, biometric prompt, passphrase fallback field.
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
- **Components:** AppHeader (brand + settings icon `124:297`), BalanceCard (`124:302`),
  a grid of **labelled** quick-action tiles (old-MCB-Juice layout: balance/summary on top, then the
  tile grid) - *Add expense* (-> `/expenses/new`), *Scan receipt* (-> `/import`), *Add goal*
  (-> `/goals/new`); labelled tiles only, never icon-only - TrendChart (`130:7` - rebuild in
  Chart.js), GoalProgressRow ×N (`130:36`), BottomNav (`124:355`).
- **Data:** current balance, usable balance, balance-trend series, top goals.
- **Commands:** `get_dashboard()` → `{ balance, usable, trend[], goals[] }`.
- **Status (2026-06):** spec - `get_dashboard` is not implemented; the home screen currently shows
  a hardcoded placeholder (Rs 0). Depends on the reporting aggregations (FR-3.3).
- **States:** loading (progressive), empty (`133:641` - "No goals? Create one!"), populated.

### 3.2 Dashboard (empty)
- **Figma:** `133:641`.
- **Components:** EmptyState patterns, *Get Started* card.
- **Commands:** `get_dashboard()` returns zeros/empty.

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
- **Presentation:** a **full-screen page** (§8.0) - routes `expenses/new` and `expenses/:id/edit`,
  lazy-loaded, route data `{ title, back: true, hideNav: true }`. The canonical form-page example
  (`transaction-form`). **Amount-first:** the amount is the hero field; Split and FX are
  progressively disclosed.
- **Components:** CurrencyField (amount + currency + rate, the hero field), date picker, category
  picker (SelectField, inline on the page), account picker (SelectField), note; inline split editor
  ("+ Split"). Back arrow = *Cancel*; *Save* published into the global header via
  `HeaderActionService`. On the edit page a Delete button sits in a `.danger-zone` (→ ConfirmDialog).
- **Data:** draft transaction; categories; accounts; applicable rule preview.
- **Commands:** `save_transaction(dto)` (ACID), `preview_rules(draft)`.
- **States:** validation (amount>0, split sum=0 remaining), rule-applied indicator, save error.

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
  dialog (bridge `pickReceiptImage`). On "Use these details" the screen prefills the Add expense
  page (`/expenses/new` router state) - it does **not** save.
- **States:** picking, processing (off-thread - `extract_receipt` is async, native engine on
  Dispatchers.IO), review (editable), low-confidence (all fields empty → flagged + manual-entry
  CTA), engine-unavailable (plugin `NotImplemented` on desktop/iOS), failed (retry/manual entry).
  **Never auto-saves** - the user confirms on the Add expense page.

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
  date. Back arrow = *Cancel*; *Save* published into the global header via `HeaderActionService`.
  On the edit page a Delete button sits in a `.danger-zone` (→ ConfirmDialog).
- **Commands:** `create_goal` / `update_goal` (major-unit `target`/`current` parsed to minor units
  in Rust), `delete_goal`.
- **States:** validation (name required, target > 0), save error, busy.

### 5.3 Goal detail / progress
- **Figma:** `133:530` (Goal List Progress), `130:90` (Frame 13 goal cards).
- **Components:** GoalProgressRow (large), contribution history.
- **Commands:** `get_goal(id)`, `add_contribution(id, amount)`.

---

## 6. Analytics

### 6.1 Analytics (populated) **[partly NEW]**
- **Figma:** `132:298` (header shell only - charts not yet designed).
- **FR:** FR-3.3.
- **Components:** AppHeader ("Analytics"), pie chart (spend by category), line chart (spend
  over time), period/category filters, BottomNav. **Charts via bundled Chart.js.**
- **Data:** aggregations by category and over time.
- **Commands:** `get_spend_by_category(period)`, `get_spend_over_time(period)`.
- **Status (2026-06):** spec - neither aggregation command exists yet; the Analytics screen is an
  empty-state placeholder and Chart.js is not yet wired (FR-3.3).
- **States:** loading, empty (`133:806` "No Data" + illustration), populated, error (aggregation
  failed - plain-language + retry), busy (recomputing on filter/period change, UI stays responsive).

---

## 7. Settings **[NEW]**

### 7.1 Settings list
- **FR:** FR-4.x, FR-5.2, FR-3.1, FR-2.3, FR-1.x (accounts/categories foundation).
- **Components:** SettingsList rows → **Accounts**, **Categories**, Base currency, Lock timeout,
  Budgets/Envelopes, Rules, Export, Backup/Restore, About/Privacy note.
- **Commands:** `get_settings()`, `update_settings(dto)`.

### 7.1a Accounts **[NEW - FR-1.x foundation]**
- **FR:** underpins FR-1.1 (account picker), FR-1.4 (per-account currency), FR-3.x.
- **Components:** AppHeader (titled "Accounts" + back); in-content **Add** action button; list of
  accounts (name · type · currency · opening balance via the money pipe, Rs). The create/edit form is
  a **full-screen page** (§8.0) - routes `settings/accounts/new` and `settings/accounts/:id/edit`,
  route data `{ title, back: true, hideNav: true }` - with fields (name, type ∈
  cash|bank|card|wallet|other, ISO-4217 currency); the edit page has an **Archive** button in its
  `.danger-zone` (→ ConfirmDialog). Lucide icons (`wallet`, `pencil`, `archive`). Reached from
  Settings.
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
  optional parent); the edit page has an **Archive** button in its `.danger-zone` (→ ConfirmDialog).
  Tree via `parent_id`; the backend rejects cycles/self-parent. Lucide `tags`/`pencil`/`archive`.
- **Commands:** `list_categories(includeArchived)`, `create_category`, `update_category`,
  `archive_category`.
- **States:** loading · empty (default set seeded on first run) · populated · error · busy.

### 7.2 Budgets / Envelopes
- **FR:** FR-3.1.
- **Components:** EnvelopeCard ×N (category cap, spent/remaining bar, warning/over states).
- **Commands:** `list_envelopes()`, `save_envelope(dto)`.
- **Status (2026-06):** spec - the `budgets` table exists but there is no envelope command or
  spent-vs-remaining logic in code yet (FR-3.1). This is the flagship budgeting feature and is not
  built.
- **States:** loading, empty (no caps set + CTA), populated - under / approaching (warning) / over
  (danger), error (load/save failed - plain-language + retry), busy (saving a cap).

### 7.3 Rules (if-then)
- **FR:** FR-2.3.
- **Components:** RuleBuilderRow ×N (ordered), add/reorder/delete. The add/edit form is a
  **full-screen page** (§8.0) - routes `settings/rules/new` and `settings/rules/:id/edit`, route data
  `{ title, back: true, hideNav: true }`; the edit page has a Delete button in its `.danger-zone`
  (→ ConfirmDialog). Recurring (`/settings/recurring`) follows the same page pattern
  (`settings/recurring/new`, `settings/recurring/:id/edit`) but has **no delete** - pause/resume
  stays on its list.
- **Commands:** `list_rules()`, `save_rules(ordered)`.

### 7.4 Export
- **FR:** FR-4.2.
- **Components:** format choice (CSV/XLSX), range, *Export* → system save dialog.
- **Commands:** `export_transactions(format, range)` (`rust_xlsxwriter`/csv) + dialog/fs.
- **Status (2026-06):** spec - `export_transactions` is not implemented (export crates selected,
  no command yet). FR-4.2.
- **States:** generating, saved, error. Plaintext-export warning shown.

### 7.5 Backup / Restore
- **FR:** FR-4.1/4.3.
- **Components:** BackupRestorePanel - *Create encrypted backup* → save/share;
  *Restore* → pick `.vaultbak` → passphrase → replace/merge.
- **Commands:** `create_backup()` → file via dialog/fs (Android: `tauri-plugin-android-fs`);
  `restore_backup(path, passphrase, mode)` (ACID).
- **Status (2026-06):** spec - neither `create_backup` nor `restore_backup` is implemented yet
  (FR-4.1 / FR-4.3).
- **States:** creating, written, restoring, merge/replace choice, wrong-passphrase error.

---

## 8. Forms, overlays & shared

### 8.0 Forms are pages (canonical pattern)
- **Every add/edit form in the app is a full-screen routed page**, **not** a modal. Each former
  modal is a pair of lazy routes `<area>/new` and `<area>/:id/edit` carrying route data
  `{ title, back: true, hideNav: true }` (so the bottom nav is hidden on the task page). This covers
  Add/Edit **Transaction** (incl. Split editor; `expenses/new`, `expenses/:id/edit`), **Rule**
  (`settings/rules/...`), **Recurring rule** (`settings/recurring/...`), **Account**
  (`settings/accounts/...`), **Category** (`settings/categories/...`), and **Goal**
  (`goals/...`, FR-3.2). The list navigates to the page and hands the entity over via router state;
  the back arrow = *Cancel* returns to origin unchanged. `transaction-form` is the canonical example.
- **Header action convention:** the back arrow is *Cancel*; the primary *Save* is published into the
  global app header via `HeaderActionService` (so Save stays above the Android soft keyboard, not
  behind it). The page body scrolls inside `.app-content`, which is extended by
  `var(--keyboard-inset)` so the focused bottom field clears the keyboard.
- **Destructive actions** live in a `.danger-zone` on the **edit** page only: **Delete**
  (Transaction, Goal, Rule) or **Archive** (Account, Category), each opening a `ConfirmDialog`
  (§8.2). Add pages omit it. Recurring has no delete (managed by pause/resume on its list).
- **Dropdowns** on a form page use `SelectField` (themed listbox - native `<select>` can't be styled
  in the WebView); it sits inline on the page and overlays normally (no in-flow dialog expansion -
  forms are pages now). The body scrolls with the scrollbar hidden (native-app feel).
- Rationale and decision: `docs/adr/0002-page-based-forms-no-modals.md`; evidence:
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
