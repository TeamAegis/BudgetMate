# Mobile budget-app UX research: genre standard + old MCB Juice

Prepared 2026-06-25. Background for ADR 0002 (page-based forms). This summarises two research
streams: (1) the genre/platform standard for a mobile budget app, and (2) the old MCB Juice layout
the maintainer chose as the reference. The decision and its trade-offs live in
`docs/adr/0002-page-based-forms-no-modals.md`; this file keeps the evidence so the reasoning is not
lost.

## Question
Centred-modal forms felt wrong on the phone. What is the genre standard, and how should the
modal-heavy design be replaced? The chosen direction: remove form modals entirely and use full-screen
pages, in the spirit of the old MCB Juice app.

## 1. The genre standard (overlay tiers)
The phone standard is a three-tier hierarchy, not one centred card:

- **Centred / basic dialog** - brief prompts, at most two buttons, NO keyboard input. Material 3
  reserves its basic dialog for exactly this and routes anything with form fields elsewhere.
- **Modal bottom sheet** - contextual choices and short menus in the thumb zone; it fails for
  keyboard-driven forms (overlap, limited height, swipe-to-dismiss data loss) and must not replace
  page-to-page flows.
- **Full-screen presentation** - any multi-field form on a phone. Material 3 triggers a full-screen
  dialog when a dialog "includes components which require keyboard input, such as form fields", when
  changes are not saved instantly, or when it opens further dialogs. Apple's page sheet on iPhone
  portrait is itself full screen.

Why the centred card fails on a phone: backdrop margins shrink usable width, and a 90vh card puts its
Cancel/Save footer in the thumb "stretch" zone; stacking a confirm over an edit modal is a named
overlay anti-pattern. The one correct centred case is a short, two-action destructive confirmation,
where the blocking presentation signals gravity.

Quick expense entry (the highest-frequency flow) converges on amount-first entry on a near-full-screen
surface, smart defaults (today, last-used account, rule-matched category), a 3-tap repeat target, and
progressive disclosure of split / recurring / fx. Navigation converges on a persistent bottom bar of
3-5 labelled tabs, a FAB for the primary add action, and Settings in the header (never a tab). Forms
are single-column with labels above fields, `inputmode="decimal"` for money, and format-on-blur.

Sources:
- [Dialogs - Material Design 3](https://m3.material.io/components/dialogs/guidelines)
- [Bottom sheets - Material Design 3](https://m3.material.io/components/bottom-sheets/guidelines)
- [Bottom Sheets - Nielsen Norman Group](https://www.nngroup.com/articles/bottom-sheet/)
- [Sheets - Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/sheets)
- [Navigation bar - Material Design 3](https://m3.material.io/components/navigation-bar/guidelines)
- [Hamburger Menus Hurt UX - Nielsen Norman Group](https://www.nngroup.com/articles/hamburger-menus/)
- [Placeholders in Form Fields Are Harmful - Nielsen Norman Group](https://www.nngroup.com/articles/form-design-placeholders/)
- [WCAG 2.2 SC 3.3.2 Labels or Instructions - W3C](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html)

## 2. Old MCB Juice (the chosen reference)
The old JuiceByMCB app (2013 to the July 2021 redesign) was modal-free by design. Reconstructed from
MCB's own release notes, the 2021 relaunch campaign, FAQs, and user reviews (primary screenshots of
the old app are not indexed, so individual layout details are inferred and flagged as such):

- Balance/account summary at the top after login, then labelled action entries.
- A persistent bottom tab bar with stable, named sections (Home, Pay and Transfer, Accounts, More).
- Every action was a dedicated full-screen, multi-step flow (enter -> amount -> confirm -> success),
  a new screen pushed per step, never a popup or sheet; the Android Back button worked predictably.
- Users praised it as fast and memorable; the redesign's complaints were about added taps and broken
  Back behaviour, which the old full-screen-flow model avoided.

Patterns transferred to BudgetMate: balance/summary on top of Home; labelled action tiles (never
icon-only, a low-literacy requirement); full-screen, back-reversible pages for add/edit; remembered
defaults to cut friction; an explicit confirmation rather than silent auto-commit.

Sources:
- [The new MCB Juice is here - MCBGroup](https://mcbgroup.com/news/article/the-new-mcb-juice-is-here)
- [MCB Juice reaches a new step - mcb.mu](https://mcb.mu/news/mcb-juice-reaches-a-new-step-in-its-development-and-user-experience)
- [MCB Juice 4.0 upgrade launch - Circus.mu](https://www.circus.mu/work/mcb-juice-upgrade-launch-intergrated/)
- [MCB Juice FAQ v18.0 (PDF)](https://mcb.mu/docs/juicelibraries/default-document-library/juice-documents/-view-juice-frequently-asked-questions.pdf?sfvrsn=b68305f5_2)

## 3. What this became in BudgetMate
- Add/edit forms (Transaction, Goal, Account, Category, Rule, Recurring) are full-screen routes with
  Save in the header and the back arrow as Cancel.
- ConfirmDialog is the only overlay (a content-sized `role="alertdialog"`).
- Expenses uses a tap-to-open FAB menu (Add expense / Scan receipt); Home uses a balance card plus a
  labelled action-tile grid; the four-tab bottom nav is unchanged.
- Add Transaction is amount-first with progressive disclosure of split / fx.

## 4. Open trade-offs (honest notes)
- Sheet vs route was a real call: routes are technically safer in a WebView (no fixed positioning, so
  the keyboard-inset problem disappears) and match Juice; full-height sheets were the genre
  "least-churn" option but were rejected (see ADR 0002).
- Programmatic focus does NOT reliably open the Android WebView keyboard, so amount auto-focus is
  best-effort; the amount-first reorder is the durable win.
- `interactive-widget=resizes-content` does not affect the Android System WebView; the visualViewport
  `--keyboard-inset` service plus `windowSoftInputMode=adjustResize` are the real keyboard levers.

## 5. Captured as follow-ups (not in this change)
Return the over-budget state as a Rust enum (`ok|approaching|over|well_over`); colourblind-safe
Chart.js; date-group headers and `tabular-nums` on the transaction list; a snackbar/toast component;
onboarding and an info-tooltip. Track these as issues.
