# BudgetMate - UX Blueprint

How the product behaves: principles, information architecture, navigation, the core flows,
screen states, offline-specific UX, accessibility, and an honest map of what the current
Figma covers versus what the FRs still require.

---

## 1. Design principles (derived from the Core Vision & research)
1. **Local & private by feel, not just by fact.** The UI never implies cloud, sync, or
   accounts. Backups are explicit, user-driven file exports. No "sign in".
2. **The user is always in control.** OCR and imports *propose*; the user *confirms*. No
   silent auto-categorisation, no auto-deletion of duplicates. Rules are visible and editable.
3. **Determinism is legible.** When a category or duplicate is suggested, show the reason
   ("matched rule: merchant contains 'Uber'"). No black boxes (zero-AI-logic promise).
4. **Fast and quiet.** Protect first paint; defer heavy work; no spinners on launch beyond a
   brief splash; no background battery use.
5. **Money is sacred.** Amounts are always exact, always formatted consistently, always show
   currency. Destructive actions confirm.
6. **Accessible warmth.** Warm coral and friendly illustrations, but contrast and
   non-colour-only cues are mandatory.

---

## 2. Information architecture

```
LockScreen (biometric/passphrase)            ← app entry gate (FR-5.1) [NEW]
   │
   ▼
App Shell (header + bottom nav)
   ├── Home / Dashboard            (Home tab)
   │     • Balance/summary card  • Labelled quick-action tile grid (Juice-style)  • Goals preview
   │     • FabMenu → Add expense / Add income / Scan receipt / Add allowance / Add budget
   ├── Expenses                    (Expenses tab)
   │     • Balance summary  • Daily/Weekly/Monthly toggle  • Trend chart
   │     • Transaction list  • FabMenu → Add expense / Add income / Scan receipt
   │     • Add/Edit Transaction (split, recurring, multi-currency)  [partly NEW]
   │     • Scan Receipt (OCR)                                       [NEW]
   │     • Import file (CSV/OFX/QFX) → rules → dedup review         [NEW]
   ├── Goals                       (Goals tab)
   │     • Ongoing / Completed toggle  • Goal rows  • FAB → Add Goal
   │     • Goal detail / progress
   ├── Analytics                   (Analytics tab)
   │     • Spend by category (pie)  • Spend over time (line)  • filters
   └── Settings                    (header icon)                    [NEW]
         • Accounts (CRUD)  • Categories (CRUD, tree)
         • Base currency  • Lock timeout  • Budgets/envelopes
         • Recurring (/settings/recurring)
         • Rules  • Export (CSV/XLSX)  • Encrypted backup / restore
```

Accounts & Categories are managed under Settings (foundational data; seeded with a default
account + category set on first run). v1 is single-account in practice (multi-account schema, no
switcher). **Recurring** rules live as a Settings sub-screen (`/settings/recurring`) - matching the
code - not under Expenses; occurrences still materialise lazily on app open (FR-1.3), this is just
where the templates are managed.

Onboarding (first run, before the shell): intro → income setup → first goal (the
"Home page" and "Getting Started" frames map here).

---

## 3. Navigation map (primary)
- **Bottom nav** is the spine: Home · Expenses · Goals · Analytics (always one canonical
  label set - fix the Figma "Charts/Analytics" drift).

**Bottom-nav binding** (one source of truth - kills the "Charts" drift at the route level):
| Tab | Label | Route path | `aria-label` | Route `data.title` |
|---|---|---|---|---|
| Home | Home | `/home` | "Home" | "BudgetMate" (brand header) |
| Expenses | Expenses | `/expenses` | "Expenses" | "Expenses" |
| Goals | Goals | `/goals` | "Goals" | "Goals" |
| Analytics | Analytics | `/analytics` | "Analytics" | "Analytics" |

- **Header trailing icon** opens Settings (and, from sub-screens, contextual actions). On a
  form page the header also hosts the form's primary *Save* action (published via
  `HeaderActionService`), so Save sits above the Android soft keyboard.
- **Expenses primary action** is a tap-to-open `FabMenu` (app-fab-menu) with labelled items
  *Add expense* (-> `/expenses/new`) and *Scan receipt* (-> `/import`), replacing the old
  undiscoverable long-press FAB. Goals keeps a simple single-action FAB (-> `/goals/new`).
- **Back** affordance on pushed screens (scan, import, detail, settings, form pages), rendered in
  the AppHeader's leading slot; it navigates back through history (origin-aware). On a form page the
  back arrow is *Cancel*.
- **All add/edit forms are full-screen routed pages**, not modals: each is a pair of lazy routes
  `<area>/new` and `<area>/:id/edit` carrying route data `{ title, back: true, hideNav: true }`
  (so the bottom nav is hidden on the task page). This is the canonical pattern for Transaction,
  Rule, Recurring, Account, Category, and Goal forms. The page body scrolls inside `.app-content`,
  which is extended by `var(--keyboard-inset)` so bottom fields clear the keyboard. The header back
  arrow is *Cancel* (returns to origin unchanged); *Save* lives in the header via
  `HeaderActionService`. On an **edit** page a destructive action (Delete for Transaction/Goal/Rule,
  Archive for Account/Category) sits in a `.danger-zone` and routes through a ConfirmDialog;
  Recurring has no delete (pause/resume stays on its list). `ConfirmDialog` is the only centred dialog
  in the app; the only other overlay is the `NavDrawer` navigation sheet (ADR 0013), and no overlay ever
  hosts a form. See `design-system.md` §7 (Form page, FabMenu, ConfirmDialog, NavDrawer) and
  `screens.md` §7.0/§8.0.
  The decision is recorded in `docs/adr/0002-page-based-forms-no-modals.md`.

---

## 4. Core user flows

### 4.1 First run / onboarding
`Intro (BudgetMate splash) → Get Started → Set passphrase + enable biometrics [NEW] →
Daily/initial income → (optional) first goal → Dashboard.`
Sets the SQLCipher passphrase (FR-5.1, NFR-P2) and base currency.

### 4.2 App open (returning)
`Cold start → splash → LockScreen (biometric/passphrase) → unlock key in memory → Dashboard.`
On open, recurring rules materialise lazily (FR-1.3) - show a subtle "updated" note if new
occurrences were added.

### 4.3 Add a transaction (manual)
`Expenses → FabMenu → Add expense → /expenses/new page → enter amount (the amount is the hero,
amount-first field, numeric pad), date, category, account → optional: Split (SplitEditor, remaining
must = 0) / Currency+rate progressively disclosed → header Save (ACID).`
Applicable rules auto-fill category, with the matched rule shown and overridable. Editing a row
opens `/expenses/:id/edit`; the edit page has a Delete action in its `.danger-zone` (-> ConfirmDialog).

### 4.4 Scan a receipt (OCR) - [NEW, FR-2.1]
`Expenses → FabMenu → Scan receipt → camera/preview → on-device OCR (progress, off-thread) →
extracted merchant/date/total shown as EDITABLE fields → user confirms/corrects → continues
into the Add expense page (/expenses/new) prefilled.`
100% on-device (native Vision/ML Kit). Never auto-saves. If extraction confidence is low,
fields are flagged for review, not hidden.

### 4.5 Import a bank file - [NEW, FR-2.2/2.3/2.4]
`Expenses → Import → pick CSV/OFX/QFX → (CSV) map columns → preview parsed rows →
rule engine applies categories (each shows matched rule) → dedup scan flags likely
duplicates for review → user resolves → confirm → ACID batch insert.`
Nothing is dropped silently; duplicates are flagged for the user to keep/skip.

### 4.6 Set & track a budget envelope - [NEW, FR-3.1]
`Settings → Budgets → add category cap → Dashboard/Analytics show spent vs remaining;
approaching cap = warning, over = a gentle "over by Rs X" state (see §5; not a punitive red wall).`

### 4.7 Goals
`Goals → FAB → Add goal (/goals/new page: name, target, optional date) → contribute / track →
Ongoing list shows progress rows; completed move to Completed tab.`
Editing a goal opens `/goals/:id/edit`, whose `.danger-zone` Delete routes through a ConfirmDialog.

### 4.8 Export & backup - [NEW, FR-4.x]
`Settings → Export → choose CSV/XLSX → system save dialog → file written.`
`Settings → Backup → produce encrypted .vaultbak → system save/share to chosen location.`
`Settings → Restore → pick .vaultbak → enter passphrase → replace or merge (ACID).`

---

## 5. Screen states (apply to every data screen)
Every list/data screen must define all five:
- **Loading:** brief, non-blocking; progressive content; no full-screen spinner on launch.
- **Empty:** illustration + one-line explanation + primary CTA (Figma already has good
  empties for Goals and Analytics - reuse that pattern everywhere).
- **Populated:** the normal case.
- **Error:** inline, plain-language, with a retry/fix action (e.g. "Couldn't read this file -
  check the format" for a bad OFX). Never a raw stack trace.
- **Busy/processing:** OCR running, import parsing, export writing - show determinate or
  clearly indeterminate progress, keep UI responsive, allow cancel where safe.

Special states required by the FRs:
- **Locked** (pre-unlock) - LockScreen.
- **Over-budget** envelope - **gentle, not punitive.** Differentiate approaching (warning) / over /
  well-over rather than a binary red wall; phrase it as information ("Rs X left", "Rs Y over"), not
  as failure; tolerate carrying a small overage forward rather than shaming; pair with icon + label,
  never colour alone. A red-at-1%-over treatment reads as failure and drives abandonment
  (`docs/financial-knowledge.md` §9).
- **Dedup review** - flagged rows visually distinct (warning), with keep/skip.
- **Low-confidence OCR field** - flagged for attention, still editable.

Surface notes:
- **Home** uses the old-MCB-Juice layout: the balance/summary card on top, then a grid of
  **labelled** quick-action tiles (Add expense -> `/expenses/new`, Scan receipt -> `/import`,
  Add goal -> `/goals/new`). Labelled tiles only, never icon-only. Home **also** carries the
  labelled `FabMenu` in the thumb zone (Add expense / Add income / Scan receipt / Add allowance /
  Add budget) - the tiles are the discoverable entry point while scrolling, the FAB is the
  one-handed shortcut, and the FabMenu yields to the teaching empty state's CTA.
- **Expenses** opens its primary action through a labelled `FabMenu` (Add expense / Add income /
  Scan receipt).
- **Add Transaction** is **amount-first** - the amount is the hero field; Split and FX are
  progressively disclosed.

---

## 6. Offline-specific & privacy UX (ties to NFR-P1/P4, research §4/§7)
- **No network affordances anywhere** - no "sync", "share to cloud", "sign in", online avatars,
  or remote images. Their absence is intentional and should be explained once in onboarding
  ("BudgetMate works entirely on your device").
- **All assets bundled** - fonts (Poppins), icons, illustrations are local. A missing remote
  asset must be impossible by construction.
- **Backups are files, not clouds** - the mental model is "save a file you control".
- **Trust signals** - a small, honest note in Settings: data is encrypted on-device
  (SQLCipher), nothing leaves the phone, no analytics.

---

## 7. Accessibility checklist
- **Contrast:** fix coral-on-white small text (use `--c-primary-700`); verify all pairings to
  WCAG AA (4.5:1 body, 3:1 large).
- **Colour is never the only signal:** income/expense use sign + colour; over-budget uses
  icon + colour; dedup uses label + colour.
- **Targets:** ≥48px tap targets (Android v1 primary target; ≥ the WCAG 2.2 SC 2.5.8 24px floor
  and the iOS 44pt minimum) - nav, chips, FAB, list rows. Token `--tap-target-min`.
- **Dynamic type:** respect OS font scaling; layouts reflow, no clipping.
- **Labels:** all icons have accessible names; inputs have visible labels (not placeholder-only).
- **Motion:** honour `prefers-reduced-motion`.
- **Focus & order:** logical reading/focus order for assistive tech in the WebView.

---

## 8. Coverage gap analysis - Figma vs FRs

What the **current Figma covers** (designed, needs normalisation only):
| Area | Figma screens | FRs |
|---|---|---|
| Onboarding/intro | Home page 1/2, Mobile intro variants, income setup | onboarding, FR-1.4 base |
| Dashboard | Mobile Home (+ empty) | FR-3.x preview, FR-1.x entry points |
| Expenses/transactions | Mobile expenses, TransactionPopup | FR-1.1, partial FR-3.3 |
| Goals | Mobile Goals (Ongoing/Completed/Empty), Goal list progress | FR-3.2 |
| Analytics | Mobile Analytics (+ empty) | FR-3.3 |

What is **missing and must be designed** (specified in this blueprint + `design-system.md`):
| Missing screen / flow | FR | Priority |
|---|---|---|
| **Lock screen** (biometric/passphrase) | FR-5.1 | **High** - app entry gate |
| **Receipt scan + OCR confirm** | FR-2.1 | **High** - headline feature |
| **Import wizard** (CSV/OFX/QFX → rules → dedup review) | FR-2.2/2.3/2.4 | **High** |
| **Add/Edit Transaction** full form | FR-1.1 | **High** |
| **Split editor** | FR-1.2 | Medium |
| **Recurring rule form** | FR-1.3 | Medium |
| **Multi-currency field** (amount+rate+base) | FR-1.4 | Medium |
| **Envelope/budget setup + over-budget states** | FR-3.1 | **High** |
| **Rule builder** (if-then) | FR-2.3 | Medium |
| **Settings** (currency, lock timeout) | FR-5.2 | **High** |
| **Export + Encrypted backup/restore** | FR-4.x | **High** |
| **Analytics populated** (pie + line, filters) | FR-3.3 | Medium |
| Semantic states (success/warn/error, dedup, low-confidence OCR) | NFR-Rel, FR-2.x | **High** |

Also flagged for cleanup in the Figma (see `screens.md` for nodes):
- "Charts" vs "Analytics" nav label inconsistency; uneven nav spacing across screens.
- Duplicate "Transaction" quick-action labels (placeholder) - normalise to the canonical
  labelled Home tiles **"Add expense / Scan receipt / Add goal"**.
- Form-page titles (the route `data.title`) use the spec'd copy **"Add X" / "Edit X"** (e.g.
  "Add Goal", "Edit Transaction") - never "Modify"/"New".
- Two near-duplicate intro frames - consolidate.
- Leftover delivery-app frames ("Order Tracking", "Set Location") - unrelated, delete.
- Coral-on-white small text accessibility failures.

---

## 9. Build mapping (for Claude Code / Angular)
The IA maps directly to the Angular feature folders in `architecture.md` §3.2:
`features/transactions` (Expenses, add/edit, split, scan, import), `features/budgets`
(envelopes), `features/goals`, `features/reports` (Analytics), `features/settings`
(backup/export/rules/lock config), `core/lock` (LockScreen). Each screen calls Rust via
`core/bridge` only; all money/dedup/recurrence logic stays in Rust (see `.claude/rules/`).
