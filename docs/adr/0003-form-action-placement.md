# 0003 - Form action placement: bottom Save, header Delete

- Status: Accepted (refines ADR 0002 decision #2)
- Date: 2026-06-26
- Deciders: project maintainer

## Context
ADR 0002 made add/edit forms full-screen pages and placed the primary **Save** in the app header
(trailing), reasoning that the header is always above the Android soft keyboard. In design review of
the visual refresh, the maintainer judged that Save should be the bottom, full-width primary action
(the main focus, matching the old-MCB-Juice "confirm at the bottom of the step" model and common
mobile form convention), and that the destructive action should sit top-right. This changes only the
ACTION PLACEMENT within the page; the page-based, modal-free decision of ADR 0002 stands.

The original keyboard-safety concern (the Android WebView does not resize for the keyboard, so a
fixed bottom bar can be covered) is real and must still be solved.

## Decision
1. The primary **Save is a fixed bottom action bar** - a shared `FormActions` component
   (`app-form-actions`) rendering a full-width primary button. It is `position: fixed` and lifted by
   `bottom: var(--keyboard-inset)` so it stays above the soft keyboard (the `ViewportInsetsService`
   publishes `--keyboard-inset`; `windowSoftInputMode=adjustResize` is also set). The form page
   reserves matching bottom padding so the last field clears the bar.
2. The **destructive action (Delete / Archive) moves to the header top-right** as a danger
   icon-button, driven by `HeaderActionService` (its `HeaderAction` now carries an optional
   `icon: 'trash' | 'archive'`). It appears only on EDIT pages; Add pages have no header action.
   The back arrow remains Cancel. Recurring has no destructive action.
3. Action buttons are **slightly rounded** via a new `--radius-button: 14px` token (not the full
   `--radius-pill`); the shared `Button` uses it.

## Consequences
- Save reads as the clear primary action at the bottom, in the thumb zone, while still surviving the
  keyboard via `--keyboard-inset` (verify on a real device - the visualViewport listener is the
  primary mechanism, not the `interactive-widget` meta).
- `HeaderActionService` now hosts the destructive icon action instead of Save; AppHeader renders an
  icon HeaderAction as a danger icon-button.
- Still presentation-only; no Rust/DTO/bridge changes.

## Alternatives considered
- **Keep Save in the header** (ADR 0002 as shipped). Rejected per the maintainer's design review:
  the bottom, full-width Save is the stronger primary affordance and matches the Juice model.
- **Sticky bar via `position: sticky`** instead of fixed + `--keyboard-inset`. Rejected: in the
  non-resizing Android WebView a sticky bottom element still sits behind the keyboard; the explicit
  `--keyboard-inset` lift is what keeps it visible.

## Revisit trigger
Revisit if device testing shows the fixed bar still occluded by the keyboard on some Android
versions (consider a focus-scroll safety net), or if a form needs more than one bottom action.
