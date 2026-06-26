# 0002 - Page-based forms (retire the centred-modal form pattern)

- Status: Accepted
- Date: 2026-06-25
- Deciders: project maintainer

## Context
Every add/edit form in the app was a centred modal dialog (`app-modal`): Transaction, Goal, Account,
Category, Rule, Recurring, plus the `ConfirmDialog` built on it. On a phone this is the wrong
container. The modal was a `max-width: 420px; max-height: 90vh` card centred in the viewport that did
not consume the `--keyboard-inset` published by `core/layout/viewport-insets.service.ts`, so on
Android (the v1 target) the soft keyboard covered the bottom of the card including the Save button.
The Android WebView does not resize for the keyboard, and the project's own
`docs/design/ui-ux-principles.md` already lists "overuse of modals/interruptive dialogs" as an
anti-pattern.

Two research streams informed the decision (summary: `docs/design/research/mobile-ux-and-old-juice.md`):
a genre study (Material Design 3, Apple HIG, Nielsen Norman Group, and teardowns of YNAB / Monarch /
Copilot / Spendee / Monefy) and a reconstruction of the old MCB Juice layout (the maintainer's
reference, and an app the Mauritian audience already knows). Both converge: a centred card is for
brief, blocking, keyboard-free prompts only; any multi-field form on a phone belongs full-screen
(Material 3 routes a dialog that "includes components which require keyboard input" to a full-screen
presentation). Old Juice was modal-free: balance on top, labelled actions, and every action a
dedicated full-screen, back-button-reversible flow.

## Decision
1. Add/edit forms are **full-screen routed pages**, not modals. Each former modal becomes a pair of
   lazy routes (`<area>/new`, `<area>/:id/edit`) carrying `data: { back: true, hideNav: true }`. The
   list navigates to them and hands the entity over via router state (refresh refetches).
2. The global app header hosts the form's primary action: back arrow = Cancel, trailing **Save**
   published via a new `HeaderActionService`. Putting Save in the header (not a bottom bar) keeps it
   above the soft keyboard. The page body scrolls inside `.app-content`, which is extended by
   `--keyboard-inset` so bottom fields clear the keyboard.
3. The **only** remaining overlay is `ConfirmDialog` (delete / archive), kept as a small,
   content-sized centred `role="alertdialog"`. Its substrate `app-modal` is retired as a form
   container and documented as the confirm/alert substrate only.
4. The Expenses primary action becomes a tap-to-open `FabMenu` (Add expense / Scan receipt),
   replacing the undiscoverable long-press. Home adopts the old-Juice layout: balance summary on top
   plus a grid of labelled quick-action tiles.
5. Set `android:windowSoftInputMode="adjustResize"` on MainActivity; the visualViewport
   `--keyboard-inset` service stays the primary keyboard-aware mechanism (the `interactive-widget`
   meta does not affect the Android System WebView).

## Consequences
- The keyboard can no longer hide the Save action, and the Android Back button maps cleanly to Cancel
  (full-screen pages, no overlay to trap focus). This matches the mental model Mauritian users have
  from Juice.
- Presentation-only change: no Rust/DTO/bridge/ACL changes; the IPC contract guard is unaffected.
  Business logic (money, splits, fx, recurrence) stays in Rust.
- More routes and one component per form, but the lists are simpler and there is a single, uniform
  form pattern (see `transaction-form.ts` as the canonical example).
- `app-modal` survives only as `ConfirmDialog`'s chrome; do not reintroduce it for forms.

## Alternatives considered
- **Full-height bottom sheets** for the forms (the genre "least-churn" option). Rejected: still an
  overlay that must fight the WebView keyboard-inset and `svh`/`dvh` sizing, and it is not the Juice
  model the maintainer asked for. Routes use no fixed positioning, so the keyboard problem disappears.
- **Keep modals, just consume `--keyboard-inset`** to lift the card. Rejected: it salvages the wrong
  tier; the genre and the maintainer both call for removing modals for forms outright.
- **Delete + Undo snackbar** instead of a confirm dialog. Rejected for v1: an explicit confirm is
  safer for financial data and is the one genre-sanctioned use of a centred dialog.

## Revisit trigger
Open a superseding ADR if a future form genuinely needs a lightweight in-context surface (revisit
bottom sheets once the WebView keyboard-inset and top-layer focus issues are comfortably solved), or
if a file-import wizard (FR-2.2) needs a multi-step flow beyond the simple page pattern.
