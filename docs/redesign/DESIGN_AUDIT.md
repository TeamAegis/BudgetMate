# Design Audit - current UI vs the retention playbook

Audited 2026-07-17 against `screenshots/*.png` (release Android build), the templates, and the
project heuristics (`docs/design/ui-ux-principles.md`, `.claude/rules/design.md`,
`docs/financial-knowledge.md` sections 8-9). Playbook references (P1-P13) are the retention
principles in the redesign brief. Severity: S1 broken/blocking, S2 hurts retention directly,
S3 polish/consistency.

## Severity index (all findings, ranked)

| # | Sev | Screen | Finding | Principle |
|---|---|---|---|---|
| 1 | S1 | Home | Chart's `visually-hidden` a11y list renders VISIBLY on the release WebView ("Feb: Rs 0, Mar: Rs 0 ...") - raw debug-looking text on the money screen | P10 trust; known WebView gotcha (see line-chart.ts, pie-chart.ts) |
| 2 | S1 | Settings | Base-currency row: hint text wraps one word per line beside the inline select - broken layout | P10, WCAG reflow |
| 3 | S1 | Budgets, Import file | Long titles ("Budgets / Envelopes", "Import transactions") wrap to two lines and knock the back arrow out of alignment | P5; Jakob (header conventions) |
| 4 | S1 | Import file idle | The primary action (choose file) sits below a full-screen illustration - below the fold; screen looks like a dead end | P1, P3; NN/g above-the-fold |
| 5 | S2 | Home | Hero answers the wrong question: "Total balance" instead of "what's left to spend"; the ready-to-spend figure exists (`usableBalanceMinor`) but renders as a small text line | P3 glanceable answer |
| 6 | S2 | Home | Quick actions, Recent activity, and Goals all sit below the fold, under a 6-month chart that is mostly flat zeros for a new user; nothing actionable above the fold | P2, P3, P13; 57% of viewing time is above the fold |
| 7 | S2 | Home | No quick-add in the thumb zone (tiles are mid-page; no FAB on Home) - logging a spend from app open requires scrolling or a tab switch | P2, P9, Fitts |
| 8 | S2 | Entry form | Amount is a small default-size input - not the hero; FR-1.1 and the blueprint both call for amount-first | P2, P4 emphasized type scale |
| 9 | S2 | FabMenu | "Add expense" opens a chooser that asks Expense or Income - the label lies, and income costs an extra mis-labelled hop | P2; label honesty (NN/g) |
| 10 | S2 | Lists + detail | Dates render as raw ISO ("2026-06-30") in list group headings and the detail row; Mauritius convention is DD/MM/YYYY, and "Today/Yesterday" beats both | P10; financial-knowledge section 8 |
| 11 | S2 | Recurring | Amounts bypass the money pipe: "-250 MUR" instead of "- Rs 250"; meta truncates the one thing that matters ("Monthly . Next...") | P10 exact numbers, consistency |
| 12 | S2 | Everywhere | Raw enum values leak into UI: "cash", "expense", "monthly", "merchant", "contains", "Entertainment . expense", "Parent: -" | P7 copy is design; low-literacy mandate |
| 13 | S2 | Recurring form | "The first (or next) occurrence to materialise." - "materialise" is on the project's banned-jargon list | design.md glossary |
| 14 | S2 | Category picker | Eight identical generic tag icons; zero differentiation, alphabetical order | P4 (4x faster spotting with differentiated shape/containment), P13 |
| 15 | S2 | Rules form | Developer-shaped Field/Operator/Value UI; "To value" is free text where a category picker would prevent silent misspellings | P5, Tesler; error prevention |
| 16 | S2 | Add buttons | Add affordance placement is inconsistent: FAB (Expenses, Goals, Budgets) vs top-right "+ Add" button (Accounts, Categories, Recurring, Rules) - top-right is the hardest reach zone | P9 thumb zone, consistency (Jakob) |
| 17 | S2 | Budgets, Rules | Empty states show TWO add affordances (CTA + FAB / + Add) that do the same thing | P5 one primary decision |
| 18 | S2 | All forms | Saving gives no feedback moment - the form just navigates back; no "Saved", no visible balance update acknowledgement | P7 peak-end, P12, Doherty |
| 19 | S3 | Analytics | Segmented labels wrap to two lines ("3 months", "All time"); month-with-no-data shows an empty state by default even when June has data (mitigated by the View-all-time CTA) | P5; P3 |
| 20 | S3 | Empty states | The same generic "man with charts" illustration is reused on Budgets, Scan, and Import - undifferentiated, crowds the CTA | P3, NN/g teaching empty states |
| 21 | S3 | Account form | Currency is free text with the helper "3-letter ISO code, e.g. MUR" - jargon; "cash" type value uncapitalised | P10 plain language |
| 22 | S3 | Import file | Preview table header truncates ("Amour"); no horizontal-scroll affordance; "Cash (MUR)" formatting diverges from "Cash . MUR" elsewhere | design-system scrollbar exception |
| 23 | S3 | Goal detail | A nearly empty page: one card + one status row; no target date shown even when set | P3, P8 |
| 24 | S3 | Budget form | "Monthly limit" input is right-aligned while every other amount input is left-aligned | consistency |
| 25 | S3 | Expense detail | Hero amount in alarm red for every routine expense reads punitive at that size | P6 color as signal, P7 |
| 26 | S3 | Goals list | Target amount rendered in coral next to the slash ("Rs 0 / Rs 200,000") - decorative color on a number | P6 |

## Per-screen notes (what works / what hurts)

### Unlock (SS 01)
Works: single field, clear CTA, show-passphrase toggle, no clutter. Hurts: nothing blocking.
Verdict: keep; minor copy only.

### Home (SS 02)
Works: BalanceCard hero pattern, deferred chart, skeletons, caveat + teaching empty state exist.
Hurts: findings 1, 5, 6, 7. The screen a returning user sees first spends its fold on "Total
balance" (a number that moves slowly) and a mostly-zero chart, while the three things retention
needs - what's left, log a spend, what happened lately - are a scroll away.

### Expenses (SS 03, 03b)
Works: date grouping, signed +/- amounts (non-colour cue), monogram avatars, FabMenu with
labelled items, enter animation. Hurts: findings 9, 10; the list has no summary context (that is
Analytics' job, acceptable).

### Add flow (SS 04-07)
Works: two-step decision structure (ADR 0004) is sound for low literacy; category context row on
the form; split editor allocation feedback; rule-suggestion line with reason. Hurts: findings 8,
9, 14; date input inherits device locale; currency as free text (finding 21 applies to the form
too).

### Transaction detail (SS 22) / edit (SS 23)
Works: clean key-value layout, Edit in the bottom bar, delete confirm. Hurts: findings 10, 25;
edit page shows a double "Category" label stutter (section header + field label).

### Goals (SS 08, 09, 12, 13)
Works: toggle, progress rows, completed treatment (icon + strikethrough, not colour alone).
Hurts: findings 23, 26; "Add goal" form asks for "Saved so far" with no explanation of why
(hint exists, good) - minor.

### Analytics (SS 10)
Works: three-case empty logic, filters stay visible, charts are Rust-aggregated. Hurts: finding
19.

### Settings (SS 11-11c)
Works: grouped rows, icons + hints, privacy note, curated currency list. Hurts: finding 2 (S1
layout break).

### Accounts / Categories (SS 14-19)
Works: simple lists, archive-not-delete semantics. Hurts: findings 12, 16, 21; "Parent: -"
(finding 12) is developer notation.

### Budgets (SS 20, 21)
Works: EnvelopeCard three-state model (gentle over-budget), empty CTA copy. Hurts: findings 3,
17, 24.

### Recurring (SS 24-26)
Works: pause/resume on the list, kind derived from category. Hurts: findings 11, 12, 13.

### Rules (SS 27, 28)
Works: preview/order semantics in code. Hurts: findings 15, 16, 17.

### Scan / Import (SS 31, 40-43)
Works: privacy copy is excellent trust material; nothing auto-commits; malformed rows surfaced.
Hurts: findings 3, 4, 20, 22.

### Export / Backup on Android (SS 29, 30)
Works: honest info banner (deferred capability, ADR 0006/0007). Hurts: nothing to fix in this
redesign; leave as informational dead ends until SAF lands.

## What already follows the playbook (do not regress)

- Five-state discipline (loading/empty/populated/error/busy) is implemented on every data screen.
- Signed +/- amounts as the non-colour direction cue (issues I3/I4, shipped).
- Forms are full-screen pages with keyboard-lifted bottom Save (ADR 0002/0003).
- ConfirmDialog as the single overlay; archive-not-delete for accounts/categories.
- Over-budget states are informational, not punitive (EnvelopeCard).
- Offline trust cues: PrivacyNote, on-device OCR copy.
- Reduced motion is token-zeroed; list/page animations are subtle.

## Appendix A - frozen token set (C1)

Source: `src/styles/_tokens.scss` at branch point (mirrors `design-tokens.json` and
`docs/design/design-system.md`). ALL values below are frozen; the redesign may only re-apply
them. No new tokens are added by this redesign.

Brand: `--c-primary #ff7755`, `--c-primary-700 #d84f2c`, `--c-primary-40/-10/-05` (coral alphas).
Neutrals: `--c-bg #ffffff`, `--c-surface #fbfbfb`, `--c-text #000000`, `--c-text-muted #5a5a5a`,
`--c-border #ececec`, `--c-scrim rgba(0,0,0,.4)`.
Semantic: `--c-positive #2e9e6b` (+`-700`, `-soft`), `--c-warning #e8a13a` (+`-700`, `-soft`),
`--c-danger #d8453b` (+`-700`, `-soft`), `--c-info #3a86c8` (+`-700`, `-soft`).
Interaction: `--c-focus-ring`, `--tap-highlight`, `--c-press-tint`, `--c-selection`.
Elevation: `--c-shadow-pink`, `--elev-card`, `--elev-float`.
Type: Poppins stack `--font-family`; weights 200/300/400/500/600/700; scale `--t-wordmark 2rem`,
`--t-screen-title 1.875rem`, `--t-balance 2rem`, `--t-dialog 1.25rem`, `--t-title 1rem`,
`--t-section .875rem`, `--t-body .8125rem`, `--t-caption .75rem`; `--lh-body 1.5`,
`--lh-tight 1.2`.
Spacing: `--space-0-5` 2px through `--space-8` 32px (4px base).
Radius: `--radius-sm 5px`, `--radius-md 10px`, `--radius-lg 20px`, `--radius-pill 999px`,
`--radius-button 14px`.
Component metrics: `--progress-track-h 8px`, `--progress-knob-size 16px`, `--size-avatar-sm 38px`.
Icons: `--icon-size-sm 24px`, `--icon-size-md 32px`, `--icon-stroke 1.75`.
Layout: `--layout-header-h 80px`, `--layout-bottomnav-h 80px`, `--layout-fab-size 60px`,
`--tap-target-min 48px`, safe-area/keyboard insets.
Z-index: `--z-dropdown 20`, `--z-fab-menu 900`, `--z-modal 1000`, `--z-modal-nested 1010`.
Backdrop: `--backdrop-blur 6px`.
Motion: `--motion-fast 150ms`, `--motion-standard 200ms`, `--motion-slow 300ms`,
`--motion-skeleton-offset 200ms`, `--easing cubic-bezier(0.2,0,0,1)`; zeroed under
prefers-reduced-motion.
Skeleton: `--c-skeleton`, `--c-skeleton-sheen`.
Charts: `--chart-cat-1..8`, `--chart-line`, `--chart-grid`, `--chart-height 240px`.
