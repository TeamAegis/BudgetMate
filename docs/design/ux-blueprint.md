# BudgetMate - UX Blueprint

How the product behaves: principles, information architecture, navigation, the core flows,
screen states, offline UX, accessibility, and the retention playbook the UI is built to. This
edition (2026-07) is the retention-focused rewrite: same features, same theme tokens, a UI
reorganised around the outcome *"a user who opens the app on day 1 still opens it on day 30"*.
Per-screen build specs live in `docs/design/screens.md` and `docs/redesign/REDESIGN_SPEC.md`;
the parity contract is `docs/redesign/FEATURE_INVENTORY.md`.

Three hard constraints govern every screen here:
- **C1 Theme lock.** All visuals compose the existing tokens in `src/styles/_tokens.scss`
  (Appendix A of `docs/redesign/DESIGN_AUDIT.md`). No new colours, fonts, or token values;
  expressiveness comes from size, shape, containment, spacing, and motion.
- **C2 Feature parity.** Nothing removed, nothing added. IA may reorganise; every capability in
  the feature inventory stays reachable.
- **C3 UI-only.** Angular templates/SCSS/presentation logic only. Rust, commands, schema,
  services, and business rules do not change. TS formats and presents; it never computes money.

---

## 1. Design principles

1. **Local & private by feel, not just by fact.** No cloud affordances, ever. Backups are files.
   Trust cues are calm and visible (PrivacyNote, on-device OCR copy) - in fintech, trust IS
   retention.
2. **The user is always in control.** OCR and imports propose; the user confirms. Nothing saves
   or deletes silently. Rules are visible, ordered, editable.
3. **Determinism is legible.** Every suggested category or duplicate shows its reason in plain
   language.
4. **Speed is the first feature.** Meaningful content in under ~2s on low-end Android; skeletons,
   never blank screens; feedback within 400ms (Doherty); local writes feel instant.
5. **One glanceable answer per screen.** Each screen answers exactly one question above the fold
   (Home: "what can I still spend, and how do I log what I just spent?"). One emphasized number,
   one visually distinct primary action; everything else is progressive disclosure.
6. **Money is sacred.** Amounts exact, via the shared money pipe only ("Rs 1,234"), signed +/-
   as the non-colour cue, dates in Mauritian-friendly form (never raw ISO in the UI).
7. **Gentle, never shaming.** Overspend is information ("Rs X over"), not failure. Red and green
   are signals reserved for meaning, not decoration. Wins get a brief, tasteful acknowledgement.
8. **Plain words for real people.** Copy uses the user's vocabulary (see section 10); every term
   on the jargon list is translated or explained. Labelled icons only.

---

## 2. Information architecture

```
Setup / Unlock (passphrase; chromeless)          <- app entry gate (FR-5.1/5.2)
   |
   v
App Shell (header + bottom nav + quick-add)
   |-- Home                       (Home tab)
   |     hero "Ready to spend" -> stat row -> quick actions -> recent activity
   |     -> goals preview -> balance trend (deferred). FabMenu quick-add.
   |-- Expenses                   (Expenses tab)
   |     date-grouped list (friendly dates) -> row -> detail (/expenses/:id)
   |     FabMenu: Add expense / Add income / Scan receipt
   |     Add flow (ADR 0004): category picker -> amount-first entry form
   |     (kind chooser /expenses/new remains the generic entry point)
   |-- Goals                      (Goals tab)
   |     Ongoing/Completed -> row -> detail (/goals/:id) -> edit; FAB Add goal
   |-- Analytics                  (Analytics tab)
   |     period + category filters -> total spend -> pie -> line
   `-- Settings                   (header icon)
         Your money: Accounts, Categories, Budgets/Envelopes, Recurring, Rules,
                     Import transactions (/import/file)
         General:    Export, Backup, Base currency
         Security:   Auto-lock
```

Accounts and Categories remain foundational data under Settings (seeded on first run). Budgets
(`/budgets`) and Import (`/import` scan, `/import/file` CSV) are routed nested actions, not
tabs. Detail pages exist for transactions and goals (issue I5). v1 is single-account in
practice; recurring templates are managed at `/settings/recurring`, occurrences still
materialise lazily on app open (FR-1.3).

---

## 3. Navigation map (primary)

- **Bottom nav is the spine:** Home . Expenses . Goals . Analytics - one canonical label set.

| Tab | Route | `data.title` |
|---|---|---|
| Home | `/home` | (brand wordmark) |
| Expenses | `/expenses` | "Expenses" |
| Goals | `/goals` | "Goals" |
| Analytics | `/analytics` | "Analytics" |

- **Quick-add lives in the thumb zone on every primary surface.** Home and Expenses host the
  labelled **FabMenu** with three items: *Add expense* -> `/expenses/new/expense` (straight to
  the category picker - the item label already answers the kind question), *Add income* ->
  `/expenses/new/income`, *Scan receipt* -> `/import`. Goals keeps its single-action FAB
  (*Add goal*). Labels are mandatory; an unlabelled icon is never a primary action.
- **Every list screen's add action is a FAB** (bottom-right, thumb zone) - never a top-right
  button. When the list is EMPTY the FAB yields to the empty state's single CTA (one affordance
  at a time, Hick's law).
- **Header:** leading back arrow on pushed screens (= Cancel on form pages), title in one line
  (route titles are chosen to fit at 360px; the header never wraps), trailing settings gear only
  on the four tabs; on edit pages the trailing slot is the danger Delete/Archive icon
  (`HeaderActionService`).
- **All add/edit forms are full-screen routed pages** (`<area>/new`, `<area>/:id/edit`, route
  data `{ title, back: true, hideNav: true }`); primary *Save* in the fixed bottom `FormActions`
  bar lifted by `--keyboard-inset`; destructive action = header danger icon -> ConfirmDialog
  (ADR 0002/0003). `ConfirmDialog` is the only overlay in the app.
- **The kind chooser** (`/expenses/new`) still exists (ADR 0004's "one decision at a time"): the
  FabMenu's labelled items simply ARE that decision, so entry points that already know the kind
  deep-link past it. Generic entry points (a bare "add" affordance, e.g. the list empty-state
  CTA) go to the chooser.

---

## 4. Core user flows

### 4.1 First run
`Setup (create passphrase) -> Home (teaching empty state) -> "Add an expense" CTA -> category
picker -> amount-first form -> Save -> Home shows the money moving.` The first session must end
with a saved transaction and a visible result - that is the activation moment.

### 4.2 App open (returning)
`Cold start -> Unlock (biometric/passphrase) -> Home.` Above the fold, without scrolling: the
ready-to-spend hero, this month's spend, and the quick-add. Recurring occurrences materialise
lazily; the ledger simply shows them ("added automatically" phrasing where surfaced).

### 4.3 Log a spend (the core loop - protect it)
Target: **<= 4 taps + typing, under ~10 seconds** from any primary screen.
`FabMenu (1) -> Add expense (2) -> category (3) -> amount (keypad, hero field; smart defaults:
today's date, last-used account, base currency) -> Save (4).`
Feedback: return to the origin screen with a brief "Saved" confirmation and the affected numbers
already updated (local write = instant). Rules may pre-fill the category from the payee, with
the reason shown and overridable.

### 4.4 Scan a receipt (FR-2.1)
`FabMenu -> Scan receipt -> pick image -> on-device OCR (progress, off-thread) -> editable
merchant/date/total with per-field "not detected" flags -> Use these details -> prefilled entry
form -> Save.` Never auto-saves. Privacy copy stays on the idle screen.

### 4.5 Import a bank file (FR-2.2/2.3/2.4)
`Settings -> Import transactions -> account + choose file (both above the fold) -> map columns
(Date/Amount required, live preview of first rows) -> review (rule-suggested categories with
reasons, duplicates default to skip with keep/skip per row, malformed rows listed with reasons)
-> explicit "Import N transactions" -> done summary.` Nothing commits without the explicit tap.

### 4.6 Budgets (FR-3.1)
`Settings -> Budgets -> FAB -> category + monthly limit -> Save.` Envelope cards show
spent-vs-left with the three gentle states (under / approaching "Rs X left" / over "Rs Y over",
icon + label, never colour alone).

### 4.7 Goals (FR-3.2)
`Goals -> FAB -> name, target, saved-so-far, optional date -> Save -> progress rows; tap ->
detail -> Edit.` Completing a goal is a win: the completed row celebrates quietly (check +
strikethrough + positive track - existing pattern, kept).

### 4.8 Export / Backup / Restore (FR-4.x)
Desktop-first flows as built (ADR 0006/0007/0008); Android shows the honest info banner until
SAF lands. Restore is confirm-gated and crash-safe.

---

## 5. Screen states (apply to every data screen)

Every list/data screen defines all five:
- **Loading:** skeleton placeholders (never a blank screen or a blocking spinner on launch).
- **Empty:** a teaching moment - one-line value explanation + ONE primary CTA. Empty states
  never show a second add affordance; the FAB hides while the empty CTA is on screen.
- **Populated:** the normal case.
- **Error:** inline, plain-language, with a retry/fix action. Never a raw code or stack trace.
  A refresh failure with data already on screen shows a warning banner beside the still-mounted
  content, never in place of it.
- **Busy/processing:** OCR, import, export show progress and keep the UI responsive; existing
  content stays mounted with an inline "Updating" indicator.

Special states (FR-mandated):
- **Locked** (pre-unlock).
- **Over-budget** - gentle, informational: approaching (warning icon + "Rs X left"), over
  (icon + "Rs Y over"). Never alarm-red walls, never shaming copy
  (`docs/financial-knowledge.md` section 9).
- **Dedup review** - flagged rows visually distinct with keep/skip; duplicates default to skip;
  nothing dropped silently.
- **Low-confidence OCR field** - advisory flag beneath the field, clears on typing.
- **Saved confirmation** - after any form save, the origin screen shows a brief, polite
  acknowledgement (banner/status line, `aria-live=polite`, auto-dismissing) - the peak-end
  moment of the core loop.

Surface hierarchy notes (what the eye lands on, in order):
- **Home:** 1) "Ready to spend" hero (`usableBalanceMinor`, `--t-balance`), with a plain-language
  sub-line ("Rs Y set aside for goals" when reserved > 0, otherwise "That's your whole balance -
  nothing set aside yet."); 2) compact stat row: "Spent this month" (+ "Total balance" when it
  differs from the hero); 3) labelled quick-action tiles; 4) Recent activity (top 5 + See all);
  5) Goals preview; 6) balance trend chart, deferred, last. The chart never precedes the
  actions.
- **Expenses:** 1) today's/latest group; 2) FabMenu. Friendly date headings ("Today",
  "Yesterday", else "30 Jun 2026").
- **Entry form:** 1) the amount (hero-scale digits); 2) category context row; 3) everything
  else. One screen, one decision.
- **Analytics:** 1) total spend for the period; 2) pie; 3) line. Filters above, single-line
  labels.
- **Goal detail:** 1) progress (name, bar, current/target); 2) status + target date rows;
  3) Edit.

---

## 6. Offline-specific & privacy UX

- No network affordances anywhere; all assets bundled (Poppins woff2, Lucide inline SVG,
  local illustrations). A missing remote asset is impossible by construction.
- Backups are files the user controls; the mental model is "save a file".
- Trust signals: PrivacyNote in Settings, on-device wording on OCR/import screens, no analytics,
  visible encryption cue on the unlock screen.
- Because everything is local, writes are instant - the UI leans into it (optimistic-feeling
  saves, immediate number updates) instead of spinners.

---

## 7. Accessibility checklist

- **Contrast:** small coral text/icons on white use `--c-primary-700`; semantic hues follow the
  fill-not-text rules of `design-system.md` section 2.3. Verify every new pairing (AA 4.5:1
  body, 3:1 large/non-text).
- **Colour is never the only signal:** direction = sign (+/-), over-budget = icon + label,
  dedup = label + toggle, completed = check + strikethrough.
- **Targets:** >= `--tap-target-min` (48px) with >= 8px between targets.
- **Dynamic type:** rem-based scale; layouts reflow without clipping.
- **Labels:** every interactive icon has an accessible name; inputs use visible top labels.
- **Motion:** token-driven, zeroed under `prefers-reduced-motion`; infinite keyframes carry an
  explicit reduce guard.
- **Focus:** visible `:focus-visible` ring (`--c-focus-ring`); logical order.
- **WebView caveat (hard-won):** do NOT rely on a `visually-hidden` text node for
  screen-reader-only content - the release Android System WebView has rendered such nodes
  visibly (Home chart regression, 2026-07). Prefer `aria-label` on the host element or real
  visible text. Same caveat as the I3/I4 lesson in `.claude/rules/android.md` territory.
- Passphrase fields allow paste and offer show/hide (WCAG 2.2 SC 3.3.7/3.3.8).

---

## 8. Retention playbook (how the principles apply here)

The redesign optimises day-1 -> day-30 return. The levers, mapped to this app:

| Lever | Application |
|---|---|
| Speed (P1) | Skeletons everywhere; deferred charts; instant local saves; no blocking spinner ever |
| Core loop (P2) | Quick-add FabMenu on Home + Expenses; <= 4 taps to save; amount-first hero field; smart defaults (today, last-used account); saved-confirmation with updated numbers |
| Glanceable answer (P3) | Home hero = "Ready to spend"; one emphasized number; everything else below or deferred |
| Expressive hierarchy (P4) | One filled primary action per screen; contained cards; `--t-balance` scale reserved for THE number; category monograms for scannability |
| Cognitive load (P5) | One decision per screen (ADR 0004 kept); single add affordance per state; enum values never leak; helper text in plain language |
| Colour as signal (P6) | Green/red only for direction and budget state, always paired with sign/icon/label; coral is brand, `-700` for small text |
| Positive reinforcement (P7) | Saved moments; completed-goal celebration (existing pattern); overspend phrased as guidance |
| Habit rhythm (P8) | "Spent this month ... so far" front and centre; Analytics month default with honest empty + View-all-time; recurring "added for you" phrasing |
| Thumb zone (P9) | FAB/FabMenu bottom-right on every list; destructive actions top-right (deliberately out of casual reach); bottom nav 4 tabs |
| Trust (P10) | Exact "Rs" amounts via one pipe; DD MMM dates; privacy notes; no dark patterns; deliberate empty/error states |
| A11y floor (P11) | Section 7, enforced |
| Motion with purpose (P12) | Page fade, capped list stagger, progress fills, saved confirmation - and nothing else |
| Personalisation (P13) | Last-used account default (existing); most-used ordering deferred to Rust (section 11) |

---

## 9. Build mapping (for Claude Code / Angular)

IA maps to the feature folders: `features/home` (dashboard), `features/transactions` (list,
detail, add flow, form), `features/goals`, `features/reports` (Analytics), `features/budgets`,
`features/import` (scan + file), `features/accounts|categories|recurring|rules|settings`,
`core/lock`. Every screen calls Rust via `core/bridge` only; money/dedup/recurrence/aggregation
stay in Rust. Shared presentation: `shared/ui/*` components, `shared/pipes/money.pipe.ts`, and
the friendly-date pipe (`shared/pipes`). Charts: bundled Chart.js via `shared/ui/line-chart`,
`shared/ui/pie-chart` (canvas `aria-label` carries the data summary - no hidden DOM lists).

---

## 10. Copy & tone rules

- Sentence case everywhere; action-specific button labels ("Add expense", not "Submit"); an
  action's confirmation echoes its label ("Save" -> "Saved").
- The user's vocabulary: "money going out / coming in", "monthly limit for a category",
  "added automatically", "share one transaction across categories", "the currency your reports
  add up in". The full avoid-list lives in `.claude/rules/design.md` (glossary) - "materialise",
  "envelope" (raw), "base currency" (raw), "FX" never appear in UI copy.
- Raw enum/database values never render: type/kind/schedule/field/operator values are mapped to
  display labels in the component ("cash" -> "Cash", "merchant" -> "Payee name", "contains" ->
  "contains", "expense" -> "Expense").
- Dates: "Today", "Yesterday", else "30 Jun 2026" (DD MMM YYYY - Mauritius reads day-first).
  Raw ISO strings are a defect.
- Money: the shared pipe only. "Rs 1,234" / "+ Rs 500" / "- Rs 250"; foreign rows show
  "(~ Rs ...)" base equivalence.
- Errors state what happened and what to do next, in one sentence, no codes.
- Empty states teach: what this screen is for + one CTA verb.

---

## 11. Future Enhancements appendix (blocked by C2/C3 - do not build in this redesign)

Ideas the retention playbook wants but that need new data, commands, or scope:
1. **Most-used first** ordering for categories/accounts pickers - needs a Rust usage
   aggregation (pairs with the planned `get_dashboard`-style aggregation layer).
2. **Streaks / logging momentum** ("5 days in a row") - needs stored streak state.
3. **Period-close ritual** (month wrap-up summary moment) - needs a Rust month-summary command;
   presentation shell can reuse Analytics aggregates later.
4. **"What changed since last open"** digest - needs last-open tracking.
5. **Smart Analytics default period** (auto-fall-back to the last period with data) - cleanest
   with a Rust "latest period with spend" hint.
6. **Goal detail: "Rs X to go" + contribution history** - remaining amount is money math (Rust);
   history needs `add_contribution`/`get_goal` wiring (screens.md 5.3).
7. **FR-3.4 savings-backed allowances** - specified in `docs/allowances.md` + ADR 0005; its
   Home "free vs spoken-for" split will slot into the Ready-to-spend hero when built.
8. **Dark mode** - v2, token override block (design-system section 2.4).
9. **Android SAF export/backup/restore** - issues #112/#113/#116/#21.
10. **Dedup on manual entry** (#15), **OFX/QFX wiring** (#13), onboarding income capture
    (`set_onboarding_profile`).
11. **Numeric keypad sheet for amount entry** (custom keypad component with big keys) - worth a
    dedicated design pass; `inputmode=decimal` covers v1.
