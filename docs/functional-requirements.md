# Functional & Non-Functional Requirements

**Project:** Private Offline Budget App (codename: *Vault*)
**Platform:** Mobile (iOS + Android) via Tauri 2.x
**Status:** Greenfield - requirements baselined against verified technical feasibility (June 2026)

> This document supersedes the original draft spec. Claims that were inaccurate or
> over-optimistic in the original have been corrected here and are flagged with a
> **[Revised]** marker plus the reason. The companion `architecture.md` explains *how*
> each requirement is realised.

---

## 1. Core Vision

A high-performance, strictly offline mobile application for **manual** expense tracking
and financial planning. The app prioritises, in order:

1. **Data sovereignty** - all data stays on the device; nothing leaves it unless the user
   explicitly exports/shares a file.
2. **Zero-AI logic** - categorisation, dedup, and rules are deterministic and inspectable.
   (On-device OCR for receipt *reading* is permitted; it is not "AI logic" that decides the
   user's finances.)
3. **Minimal footprint** - small install size, fast start, no background battery drain.

The app does **not** connect to banks, sync to a cloud, or phone home.

---

## 2. Functional Requirements

Each requirement has a stable ID (`FR-x.y`) so the architecture doc and Claude skills can
reference it.

### 2.1 Transaction Management

- **FR-1.1 Manual Entry.** A touch-optimised form to log a transaction with: amount, date,
  category, account, optional note/payee. Amount entry uses a numeric keypad and stores
  money as integer minor units (see NFR-Reliability), never floats.
- **FR-1.2 Split Transactions.** A single transaction may be split into ≥2 line items, each
  with its own category and amount. The sum of splits must equal the parent amount
  (validated before save).
- **FR-1.3 Recurring Expenses.** The user defines a schedule (daily/weekly/monthly/custom)
  for a fixed transaction (e.g. rent, subscriptions). Occurrences are materialised into the
  ledger **lazily on app open** - there is no background scheduler (see NFR-Performance,
  zero background processes). Each materialised occurrence is editable/deletable.
- **FR-1.4 Multi-Currency.** The user may record transactions in any currency. Conversion to
  the base currency uses a **user-defined rate** stored with the transaction. No external
  rate API is ever called. Reports show both original and base-currency amounts.

### 2.2 Data Import & Processing (deterministic, on-device)

- **FR-2.1 On-Device OCR (Receipt Scanning).** From a photo, extract **merchant, date, and
  total**. Processing is **100% on-device** with no network call.
  - **[Revised]** The original spec named *Tesseract.js* as the engine. Tesseract.js (WASM)
    is heavy and slow on mobile and hurts both the size and cold-start budgets. The chosen
    engine is **platform-native OCR**: Apple Vision (`VNRecognizeTextRequest`) on iOS and
    Google ML Kit Text Recognition on Android, exposed to the app through a custom Tauri
    mobile plugin. A pure-Rust `ocrs`/RTen engine is the documented fallback. Rationale and
    tradeoffs are in `architecture.md` §6.
  - OCR returns raw recognised text + bounding boxes; a **deterministic** post-processor
    extracts merchant/date/total via regex + heuristics (no ML inference for the decision).
  - The user always reviews and confirms extracted fields before the transaction is saved.
- **FR-2.2 Bank File Parser.** Import transactions from local **CSV, OFX, and QFX** files
  chosen via the native file picker. OFX 1.x (SGML) and 2.x (XML) are both supported; QFX is
  treated as OFX with Intuit extensions. CSV import offers a column-mapping step.
- **FR-2.3 Deterministic Rule Engine.** User-defined **If-Then** rules
  (e.g. *if merchant contains "Uber" then category = Transport*). Rules are ordered,
  evaluated top-down, fully inspectable, and applied at import time and on manual entry. No
  hidden ML categorisation.
- **FR-2.4 Deduplication.** During import, flag likely duplicates by comparing date (within a
  configurable window), exact amount, and account. Flagged rows are shown for user
  confirmation before insert; nothing is auto-dropped silently.

### 2.3 Budgeting & Analysis

- **FR-3.1 Envelope-Style Budgeting.** Set a monthly cap per category. The UI shows
  *spent vs remaining* per envelope with a clear over-budget state.
- **FR-3.2 Savings Goals.** Track progress toward named targets (e.g. *Emergency Fund*)
  based on local account balances / manual contributions. Show milestone progress.
- **FR-3.3 Local Reporting.** Generate pie and line charts from standard aggregations
  (spend by category, spend over time). Rendering uses a **locally bundled** chart library
  (Chart.js) - no remote scripts or fonts.
- **FR-3.4 Savings-Backed Allowances (Envelopes).** Reserve a portion of savings for a kind of
  spending (e.g. a weekly personal or transport allowance). Unlike the FR-3.1 category cap (which
  reserves nothing), an allowance earmarks real savings so the app can show **free vs spoken-for**
  money (`Available = Total - Reserved`). Allowances follow the **imprest** model: a fixed target is
  drawn down by tagged spending and periodically **topped up to the target** (recurring weekly/
  monthly, or one-time). Overspend is allowed and draws from Available; the top-up self-heals it when
  savings allow. Refresh is **calendar-aligned and materialised lazily on app open** (no background
  scheduler, NFR-Perf3). The full domain-logic specification (invariants, worked examples, edge
  cases) is `docs/allowances.md`; the modelling decision is ADR 0005. Distinct from savings goals
  (FR-3.2), which accumulate up rather than draw down.

### 2.4 Offline Tools

- **FR-4.1 Encrypted Local Backups.** Produce an **encrypted** backup file (`.vaultbak`,
  containing the encrypted SQLite db or an encrypted JSON dump) that the user can save to
  external storage or a PC via the system save/share dialog.
- **FR-4.2 Data Export.** Export transaction history to **CSV** and **Excel (.xlsx)** for
  external record-keeping. Export is a user-initiated, explicit action to a user-chosen
  location.
- **FR-4.3 Restore.** Import a previously created encrypted backup, after passphrase entry,
  replacing or merging local data (user chooses).

### 2.5 Security & Access (functional surface)

- **FR-5.1 Biometric / Passphrase Unlock.** On launch (and after a configurable idle
  timeout), require FaceID/TouchID (iOS) or BiometricPrompt (Android), with passphrase
  fallback. The database encryption key is unlocked through this flow and held only in
  memory.
- **FR-5.2 Lock on Background.** The app locks and clears the in-memory key when sent to the
  background.

---

## 3. Non-Functional Requirements

### 3.1 Privacy & Security

- **NFR-P1 Zero-Internet Policy.** The app makes no network calls. Enforced at **two
  layers** (see `architecture.md` §7):
  - **Android (hard):** the `INTERNET` permission is **omitted** from the manifest, so the
    OS blocks all sockets.
  - **iOS (policy):** no network entitlements, locked-down App Transport Security, and a
    privacy manifest declaring zero network use. (iOS has no permission to "remove", so this
    layer is enforced by build hygiene + review, not an OS block.)
  - **App layer:** no `tauri-plugin-http` and no networking crates are linked; a CI check
    fails the build if either ever appears.
- **NFR-P2 Encrypted Storage.** The local SQLite database is encrypted at rest with
  **SQLCipher**.
  - **[Revised]** The original spec implied the official `tauri-plugin-sql` provides
    SQLCipher. It does **not**. Encryption is implemented in the Rust backend via `rusqlite`
    (or `sqlx`) with a **bundled SQLCipher** build and `PRAGMA key`. See `architecture.md`
    §5.
- **NFR-P3 Biometric Locking.** Native FaceID/TouchID/Android BiometricPrompt via the
  official `tauri-plugin-biometric`.
- **NFR-P4 No Telemetry.** Zero analytics, crash reporting, remote logging, or external
  font/script fetching. All assets are bundled.

### 3.2 Performance

- **NFR-Perf1 Install/Binary Size - target ≤ 25 MB, stretch ≤ 20 MB.**
  - **[Revised]** The original hard target was *<20 MB*. With Angular + a chart lib + native
    OCR this is achievable on a stripped Android build but **not guaranteed**, and iOS IPAs
    typically run larger. Realistic budget is **~20-35 MB**; ≤20 MB is a stretch goal
    contingent on native (not bundled) OCR and full release-size optimisation
    (`lto`, `strip`, `panic="abort"`, `codegen-units=1`, asset optimisation).
- **NFR-Perf2 Cold Start - target ≤ 800 ms on mid-range hardware, stretch ≤ 500 ms.**
  - **[Revised]** The original *<500 ms* is plausible on modern flagships but not across
    low/mid-range Android, where WebView init adds overhead. First paint is protected by a
    splash + lazy-loading of OCR/chart modules.
- **NFR-Perf3 Battery Efficiency.** No background processes, no polling, no scheduled jobs.
  All work is foreground and user-initiated.

### 3.3 Reliability

- **NFR-Rel1 Atomic (ACID) Writes.** All multi-step DB operations run in transactions so a
  force-close mid-save cannot corrupt data. Money is stored as integer minor units (or
  `rust_decimal`), never binary floats.
- **NFR-Rel2 Native UI Responsiveness.** Use the native system WebView (WKWebView /
  Android System WebView). Long operations (OCR, large imports) run off the UI thread so
  scrolling/touch stay smooth.
- **NFR-Rel3 Deterministic & Inspectable.** Categorisation, dedup, and recurrence are
  deterministic; given the same inputs they always produce the same output, and the user can
  see why.

### 3.4 Portability / Maintainability

- **NFR-Maint1 Offline Build Reproducibility.** The `gen/android` and `gen/apple` projects
  are committed; versions are pinned. Tracking the Tauri 2.11.x line (June 2026).
- **NFR-Maint2 Layered Architecture.** Business logic lives in Rust and is unit-testable
  without a running WebView; the Angular layer is presentation + light orchestration.

---

## 4. Out of Scope (explicit non-goals)

- No bank account linking / Open Banking / Plaid.
- No cloud sync or account system.
- No AI/LLM-based categorisation or financial advice.
- No real-time FX rates.
- No web or desktop build in v1 as a **shipping** target (architecture leaves the door open,
  but mobile is the target). **Note (locked 2026-06-05):** v1 ships **Android only**; **iOS is
  deferred** (macOS/Xcode-only build, current dev machine is Windows). Windows desktop is used
  **only** as a dev/test target for UI + IPC iteration via WebView2 - it is not shipped.

---

## 5. Traceability & build status

The middle column names the `architecture.md` section that **designs** each requirement; it is
**not** a claim that the requirement is implemented. The **Status** column records what is actually
built in the code as of 2026-06-25: **Built** (implemented and wired), **Partial** (some logic
present, not fully wired), **Specified** (designed in the docs, little or no runtime code yet). See
`architecture.md` §11 "Build status" for the detailed tally. This document keeps stating the full
v1 scope as requirements regardless of status; Status only reflects current progress toward it.

| Requirement | Designed in (architecture.md) | Status (2026-06-25) |
|---|---|---|
| FR-1.1/1.2/1.3/1.4 (entry, splits, recurring, multi-currency) | §4 Domain & Data Model, §3 Frontend | Built |
| FR-2.1 OCR | §6 OCR Subsystem | Built (Android; iOS deferred) |
| FR-2.2 Import (CSV/OFX/QFX) | §8 Import Pipeline | Specified |
| FR-2.3 Rule engine | §8 Rule Engine | Built (rule management + preview); applied-at-import pending with FR-2.2 |
| FR-2.4 Dedup | §8 Dedup | Partial (logic written, not yet wired into import or manual entry) |
| FR-3.1 Envelope budgeting | §3 Frontend, §4 aggregations | Specified (schema only; no spent-vs-remaining logic yet) |
| FR-3.2 Savings goals | §3 Frontend, §4 | Built |
| FR-3.3 Local reporting (charts) | §3 Frontend (charts), §4 aggregations | Specified (no aggregation queries yet) |
| FR-3.4 Savings-backed allowances (envelopes) | §4 Domain & Data Model, `docs/allowances.md`, ADR 0005 | Specified (domain spec + ADR; no schema or runtime code yet) |
| FR-4.1/4.2/4.3 Backup, export, restore | §9 Backup/Export | Specified |
| FR-5.1/5.2 / NFR-P2/P3 (unlock, lock, encryption, biometric) | §5 Storage & Crypto, §7 Security | Built (Android; iOS deferred) |
| NFR-P1 Zero-internet | §7 Offline Enforcement | Built |
| NFR-Perf* | §10 Performance & Build | Partial (web payload size tracked; Android install-size metric pending issue #4) |
