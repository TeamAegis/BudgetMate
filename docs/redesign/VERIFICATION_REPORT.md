# Verification Report - retention UI redesign (2026-07-17)

Branch `feat/ui-redesign-retention` off `main` @ 10ff9b4. Constraints C1/C2/C3 as defined in
`REDESIGN_SPEC.md`.

## 1. Parity map (C2)

Every `FEATURE_INVENTORY.md` item maps to the new UI. Items whose LOCATION changed:

| Inventory item | Was | Now |
|---|---|---|
| Home: total balance | hero card | "Total balance" stat card (shown when a goals reserve makes it differ from the hero; otherwise the hero IS the total, stated by the subline) |
| Home: ready-to-spend figure | small text line | the hero BalanceCard ("Ready to spend") |
| Home: balance trend chart | above quick actions | last section (still `@defer`, still skipped when all-zero) |
| Home: quick actions / recent / goals | below the fold | directly under the stat row; recent capped at 5 (was 4) |
| Quick-add | Expenses FabMenu only | FabMenu on Home AND Expenses |
| Income entry point | kind chooser only | also a labelled *Add income* FabMenu item -> `/expenses/new/income` (chooser route unchanged and still reachable at `/expenses/new`) |
| FabMenu "Add expense" | -> `/expenses/new` (chooser) | -> `/expenses/new/expense` (category picker; the label carries the kind) |
| Add action: Accounts, Categories, Recurring, Rules | top-right "+ Add" button | thumb-zone FAB (same `/new` routes) |
| Empty-state add affordance (all lists) | CTA + FAB/button both visible | single CTA (FAB hidden while empty) |
| Scan/Import idle CTA | below a full-screen illustration | above the illustration (illustration capped) |
| Rules form "To value" (set-field = category) | free-text input | SelectField of existing categories (same stored string; free text remains for non-category set-fields) |
| Route titles | "Budgets / Envelopes", "Import transactions" | "Budgets", "Import file" (Settings rows keep the fuller labels + hints) |

Items REMOVED: none. The chart a11y data (formerly a hidden DOM list) moved into the canvas
`aria-label` (same content, correct medium). Items ADDED beyond the inventory: none - the saved
confirmation banner is a state of the existing Banner component (ux-blueprint section 5 states),
not a new capability; display labels/dates are re-renderings of existing data.

Spot-check of every inventory section: 0 (chrome) header/nav/dialog/banners unchanged in
capability; 1 unlock unchanged; 2 home mapped above; 3 expenses mapped above (rows, detail tap,
states unchanged); 4 add flow (chooser, picker, form fields, splits, FX, payee suggestion, save,
delete) all present; 5 detail rows all present (date now friendly-formatted); 6 goals list/form/
detail (detail GAINED visible saved-so-far/target/target-date rows - same DTO fields the row
already displayed); 7 analytics (filters, total, pie, line, three empty cases) unchanged in
capability; 8 settings groups/rows unchanged; 9-13 lists + forms mapped above (archive/delete/
pause/reorder/test-a-merchant all untouched); 14 scan states untouched beyond idle layout;
15 import phases untouched beyond idle layout/format label; 16-17 export/backup untouched.

## 2. Theme proof (C1)

```
$ git diff main...HEAD -- src/styles/_tokens.scss design-tokens.json
(empty)
```
Zero changed values, zero added tokens. All new styling references existing custom properties.

## 3. Scope proof (C3)

Changed files (git diff main...HEAD, plus this docs folder): Angular templates (`*.html`),
component styles (`*.scss`), component presentation TS (display-label maps, option labels,
routing targets, signals for transient UI state), specs, and docs
(`docs/design/*`, `docs/redesign/*`, `.claude/rules/design.md`). NO changes under `src-tauri/`
(Rust, commands, schema, SQLCipher), `src/app/core/bridge`, `src/app/core/models`, or any
service/business logic. New TS is presentation-only: `friendly-date.pipe.ts` (string/date
formatting), enum display-label constants, a string-composed recurring amount label (no
arithmetic on money - documented in WORKLOG). Deep links: every pre-existing route still
resolves; only two route TITLES changed.

## 4. Accessibility checklist (P11)

- [x] Contrast: no new colour pairings outside the token rules (coral-700 for small text; -700
  tones on soft tints; hero/stat figures use `--c-text`).
- [x] Non-colour signals: signed +/- amounts kept; monogram tint always paired with label;
  over-budget states untouched (icon + label); goal target de-coloured (was decorative coral).
- [x] Touch targets: FAB 60px, FabMenu items labelled buttons, all rows >= `--tap-target-min`;
  add-affordance moved INTO the thumb zone on four screens.
- [x] Screen readers: chart data now in the canvas `aria-label` (was a hidden list that rendered
  visibly on device); saved banner is `role=status`/polite; FAB carries `aria-label`; monograms
  `aria-hidden` beside the visible row label.
- [x] Dynamic type: all new sizes in rem tokens; header title ellipsises instead of breaking
  layout; SettingsRow wraps wide controls.
- [x] Reduced motion: no new animations beyond token-driven ones (banner is static; existing
  enter animations unchanged).
- [x] Labels: every input keeps a visible top label; segment labels never truncate to ambiguity
  (nowrap + flex sizing verified for the longest set at 360px).

## 5. Build and tests

- `npm run guards`: [ok] (style, no-network, no-telemetry, no-float-money, IPC contract).
- `npm run lint`: clean.
- `npm test`: 206 of 206 SUCCESS (ChromeHeadless). Spec deltas: chart specs assert the
  aria-label contract (and that no `visually-hidden` node exists); Home specs assert the new
  hierarchy incl. a section-order test; one import-file spec updated for the "Cash · MUR" label.
- `npm run build`: production bundle green; initial total ~351 kB raw / ~95 kB transfer;
  Chart.js remains in a lazy chunk (cold-start budget respected).
- Not run here: `cargo test` / `cargo clippy` (no Rust files changed; CI runs them regardless).

## 6. Known follow-ups (tracked in ux-blueprint section 11)

Most-used picker ordering, streaks, period-close ritual, smart Analytics default, goal
"Rs X to go" + contributions, FR-3.4 allowances, dark mode, Android SAF flows, numeric keypad
sheet. On-device (emulator) visual verification of this pass is recommended before release
signing; all states were verified by template/spec review + the DOM-level unit tests.
