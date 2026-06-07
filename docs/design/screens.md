# BudgetMate — Screen Specifications

Each screen maps to its **Figma node(s)**, the **FR IDs** it satisfies, the **components** it
uses (from `design-system.md` §7), the **data shown**, the **Rust command(s)** it calls via
`core/bridge`, and its **states**. Screens marked **[NEW]** are required by the FRs but absent
in the current Figma — design them to this spec.

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
- **States:** empty/validation (amount required, numeric).

### 1.3 Set Passphrase + Biometrics **[NEW]**
- **FR:** FR-5.1, NFR-P2.
- **Components:** TextField (secure), biometric enable toggle, info note.
- **Data:** passphrase (never stored plaintext; derives SQLCipher key).
- **Commands:** `init_vault(passphrase)`, `enable_biometric()`.
- **States:** mismatch error, weak-passphrase warning, biometric-unavailable fallback.

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

---

## 3. Home / Dashboard

### 3.1 Dashboard (populated)
- **Figma:** `124:224` (Mobile Home). Tokens validated from this node.
- **FR:** FR-3.x preview, entry points to FR-1.x/2.x.
- **Components:** AppHeader (brand + settings icon `124:297`), BalanceCard (`124:302`),
  TrendChart (`130:7` — rebuild in Chart.js), QuickActionChip row (`132:395` →
  *Add Transaction / Add Goal / Scan Receipt*), GoalProgressRow ×N (`130:36`), BottomNav
  (`124:355`).
- **Data:** current balance, usable balance, balance-trend series, top goals.
- **Commands:** `get_dashboard()` → `{ balance, usable, trend[], goals[] }`.
- **States:** loading (progressive), empty (`133:641` — "No goals? Create one!"), populated.

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
  (Daily/Weekly/Monthly `133:799`), TransactionListItem ×N, FAB (`132:510`), BottomNav.
- **Data:** balance summary, period trend, transactions for period.
- **Commands:** `list_transactions(period, filter)`, `get_trend(period)`.
- **States:** loading, empty ("no transactions yet" — add to design), populated, busy
  (import/scan running).

### 4.2 Add / Edit Transaction **[partly NEW]**
- **FR:** FR-1.1 (+ FR-1.2/1.3/1.4 via sub-editors).
- **Presentation:** a **Modal** (§8.0), not a pushed route.
- **Components:** CurrencyField (amount + currency + rate), date picker, category picker
  (SelectField), account picker (SelectField), note; inline split editor ("+ Split"); modal
  footer *Cancel* / *Save* (+ trash on edit, → ConfirmDialog).
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
- **Commands:** `plugin:ocr|recognize_text(imagePath)` → `extract_receipt_fields(blocks)`
  (deterministic Rust).
- **States:** capturing, processing (off-thread), extracted (editable), low-confidence
  (flagged), failed (retry/manual entry). **Never auto-saves.**

### 4.5 Import Wizard **[NEW]**
- **FR:** FR-2.2/2.3/2.4.
- **Components:** ImportWizard steps — file picker (dialog), CSV column-mapping,
  parsed-row preview, rule-applied list (shows matched rule), **dedup review** (keep/skip),
  confirm.
- **Data:** file (CSV/OFX/QFX), staged rows, rule matches, duplicate flags.
- **Commands:** `parse_import(path, format)`, `apply_rules(rows)`, `scan_duplicates(rows)`,
  `commit_import(resolved)` (ACID batch).
- **States:** picking, parsing, mapping (CSV), reviewing, dedup-flagged, committing, error
  (bad/again).

---

## 5. Goals

### 5.1 Goals — Ongoing / Completed
- **Figma:** `132:237` (Ongoing), `137:3` (Completed), empty `133:557`.
- **FR:** FR-3.2.
- **Components:** AppHeader ("Goals"), SegmentedToggle (Ongoing/Completed `133:545`),
  GoalProgressRow ×N (`136:2` cards / `133:530`), FAB (`133:552`), BottomNav.
- **Data:** goals with current/target/date, status.
- **Commands:** `list_goals(status)`.
- **States:** loading, empty (`133:557` illustration + CTA), ongoing list, completed list.

### 5.2 Add / Edit Goal
- **FR:** FR-3.2.
- **Components:** TextField (name), CurrencyField (target), optional date, *Save*/*Back*.
- **Commands:** `save_goal(dto)`.
- **States:** validation, save error.

### 5.3 Goal detail / progress
- **Figma:** `133:530` (Goal List Progress), `130:90` (Frame 13 goal cards).
- **Components:** GoalProgressRow (large), contribution history.
- **Commands:** `get_goal(id)`, `add_contribution(id, amount)`.

---

## 6. Analytics

### 6.1 Analytics (populated) **[partly NEW]**
- **Figma:** `132:298` (header shell only — charts not yet designed).
- **FR:** FR-3.3.
- **Components:** AppHeader ("Analytics"), pie chart (spend by category), line chart (spend
  over time), period/category filters, BottomNav. **Charts via bundled Chart.js.**
- **Data:** aggregations by category and over time.
- **Commands:** `get_spend_by_category(period)`, `get_spend_over_time(period)`.
- **States:** loading, empty (`133:806` "No Data" + illustration), populated.

---

## 7. Settings **[NEW]**

### 7.1 Settings list
- **FR:** FR-4.x, FR-5.2, FR-3.1, FR-2.3, FR-1.x (accounts/categories foundation).
- **Components:** SettingsList rows → **Accounts**, **Categories**, Base currency, Lock timeout,
  Budgets/Envelopes, Rules, Export, Backup/Restore, About/Privacy note.
- **Commands:** `get_settings()`, `update_settings(dto)`.

### 7.1a Accounts **[NEW — FR-1.x foundation]**
- **FR:** underpins FR-1.1 (account picker), FR-1.4 (per-account currency), FR-3.x.
- **Components:** AppHeader (titled "Accounts" + back); in-content **Add** action button; list of
  accounts (name · type · currency · opening balance via the money pipe, Rs) + create/edit form
  (name, type ∈ cash|bank|card|wallet|other, ISO-4217 currency) + archive. Lucide icons (`wallet`,
  `pencil`, `archive`). Reached from Settings.
- **Commands:** `list_accounts(includeArchived)`, `create_account`, `update_account`,
  `archive_account`.
- **States:** loading · empty (seeded "Cash" account on first run, so rarely empty) · populated ·
  error · busy (saving). Archive hides from pickers, never deletes.
- **Notes:** v1 is effectively single default account (multi-account schema, **no switcher**).
  Opening-balance money entry lands with the CurrencyField (FR-1.4); accounts start at Rs 0.

### 7.1b Categories **[NEW — FR-1.x/FR-2.3 foundation]**
- **FR:** underpins category pickers (FR-1.1), the rule engine (FR-2.3), analytics (FR-3.3).
- **Components:** AppHeader (titled "Categories" + back); in-content **Add** action button; list
  (name · kind · parent) + create/edit form (name, kind ∈ expense|income|transfer, optional parent)
  + archive. Tree via `parent_id`; the backend rejects cycles/self-parent. Lucide
  `tags`/`pencil`/`archive`.
- **Commands:** `list_categories(includeArchived)`, `create_category`, `update_category`,
  `archive_category`.
- **States:** loading · empty (default set seeded on first run) · populated · error · busy.

### 7.2 Budgets / Envelopes
- **FR:** FR-3.1.
- **Components:** EnvelopeCard ×N (category cap, spent/remaining bar, warning/over states).
- **Commands:** `list_envelopes()`, `save_envelope(dto)`.
- **States:** under / approaching (warning) / over (danger).

### 7.3 Rules (if-then)
- **FR:** FR-2.3.
- **Components:** RuleBuilderRow ×N (ordered), add/reorder/delete.
- **Commands:** `list_rules()`, `save_rules(ordered)`.

### 7.4 Export
- **FR:** FR-4.2.
- **Components:** format choice (CSV/XLSX), range, *Export* → system save dialog.
- **Commands:** `export_transactions(format, range)` (`rust_xlsxwriter`/csv) + dialog/fs.
- **States:** generating, saved, error. Plaintext-export warning shown.

### 7.5 Backup / Restore
- **FR:** FR-4.1/4.3.
- **Components:** BackupRestorePanel — *Create encrypted backup* → save/share;
  *Restore* → pick `.vaultbak` → passphrase → replace/merge.
- **Commands:** `create_backup()` → file via dialog/fs (Android: `tauri-plugin-android-fs`);
  `restore_backup(path, passphrase, mode)` (ACID).
- **States:** creating, written, restoring, merge/replace choice, wrong-passphrase error.

---

## 8. Modals & shared

### 8.0 Forms are modals (canonical pattern)
- **Every add/edit form in the app is a `Modal`** (`app-modal`) — a centred card over a dimmed +
  blurred backdrop — **not** a pushed full-screen route. This covers Add/Edit **Transaction**
  (incl. Split editor), **Rule**, **Recurring rule**, **Account**, **Category**, and **Goal**
  (FR-3.2). The list/screen behind stays visible-but-blurred; dismiss (Escape, backdrop click, or
  *Cancel*) returns to it unchanged.
- **Footer convention:** ghost *Cancel* (left of the primary) + primary *Save* (right). On an
  **edit** modal a **trash** icon-button sits at the far left and deletes via a ConfirmDialog
  (§8.2); add modals omit it. Features with only a reversible *archive* (Accounts, Categories)
  keep archive on the list row; Recurring has no delete (managed by pause/resume).
- **Dropdowns** inside modals use `SelectField` (themed listbox — native `<select>` can't be
  styled in the WebView). An open dropdown expands the dialog (in-flow) so every option is
  reachable; the body scrolls with the scrollbar hidden (native-app feel).

### 8.1 Transaction popup
- **Figma:** `133:517` (POP-UP – Transaction). Superseded by the §8.0 Modal pattern above; the
  Add/Edit Transaction modal is the canonical entry point from the list.

### 8.2 Confirm / destructive dialog
- **Built:** `ConfirmDialog` (`app-confirm-dialog`), built on `Modal`. Used for delete,
  restore-replace, over-budget acknowledgement. Two-button, danger styling on the destructive
  action; emits `confirm` / `cancelled`.

### 8.3 Banner / Toast **[NEW]**
- Success (saved, exported, backup written), warning (approaching cap, duplicates found),
  error (import failed). Semantic colours; non-colour-only (icon + text).

---

## 9. Cleanup backlog (Figma hygiene)
- Delete leftover delivery-app frames: **`2:5` Order Tracking**, **`2:244` Set Location**
  (hidden; contain map, "delivery man", street address — unrelated to BudgetMate).
- Normalise BottomNav: one label set (**Analytics**, not "Charts"), evenly spaced.
- Replace duplicate "Transaction" quick-action labels with real actions.
- Consolidate duplicate intro frames (`122:69` / `131:157`).
- Re-token coral-on-white small text to `--c-primary-700` for AA.
