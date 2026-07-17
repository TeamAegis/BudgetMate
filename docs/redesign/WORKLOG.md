# Redesign worklog - decisions and rejected alternatives (2026-07-17)

Chronological log of the retention redesign run (Phases 0-5), one entry per load-bearing
decision. Constraints C1/C2/C3 as in `REDESIGN_SPEC.md`.

## Phase 0-1 (context + audit)
- Source of truth for the current UI: 42 release-build screenshots + the templates. One capture
  (`43b-import-mapping-bottom.png`) is black/corrupt and was excluded; `43-import-reviewing.png`
  duplicates the filled mapping state.
- Root-caused the Home "Feb: Rs 0 ..." garbage text to the charts' `visually-hidden` fallback
  lists (the same release-WebView failure the I3/I4 work hit). Decision: data moves into the
  canvas `aria-label`; hidden DOM lists are banned for this purpose (ux-blueprint section 7).
- The prior UI-uplift plan (2026-07-12, artifact) was reconciled: its P0 fixes are merged
  (#92-#100); this redesign is effectively its P2 retention phase, UI-only. Its Rust aggregation
  gate turned out already satisfied for Home (`get_dashboard` exists, incl. `usableBalanceMinor`).

## Phase 2-3 (blueprint + specs)
- Kept ux-blueprint section slots 1-9 stable (code and skills reference sections 2/3/5/7 by
  number; the docs-section-number rule forbids renumbering).
- Hero decision: "Ready to spend" (`usableBalanceMinor`) beats "Total balance" (P3) and beats
  "Spent this month" (a spend figure answers "what happened", not "what can I do"). When nothing
  is reserved the hero equals the total, so the Total-balance stat is hidden and the subline
  teaches the goals feature instead. REJECTED: computing "left this month" from budget caps -
  money math in TS (C3).
- ADR 0004 kept, one tap cheaper: the FabMenu's labelled items ARE the kind decision, so *Add
  expense*/*Add income* deep-link to the category picker. The chooser route stays as the generic
  entry. REJECTED: removing the chooser (breaks generic entry points and ADR 0004's rationale).
- Add-action unification on the FAB. REJECTED: keeping top-right Add buttons on the four
  settings lists (hardest reach zone, inconsistent with Goals/Budgets/Expenses).
- Category-picker differentiation via monogram avatars (existing avatar language). REJECTED:
  per-category icons (needs stored icon choice - new data, C2) and most-used ordering (needs a
  Rust usage aggregation - Future Enhancements).
- Rules "To" control becomes a category SelectField when set-field = category; stores the same
  string free text did, keeps a non-matching saved value selectable. REJECTED: free text with
  validation-only (does not prevent the silent-misspelling failure).
- Recurring amounts: the template DTO only carries a major-unit string, so the row label is
  string presentation (symbol map + zero-decimal trim + thousands grouping), NOT the money pipe.
  REJECTED: parsing to minor units in TS (money math, C3).
- Saved-confirmation via router-state hand-off + transient success Banner. REJECTED: a toast
  service/new overlay (ConfirmDialog must stay the only overlay).

## Phase 4 (implementation notes)
- `friendlyDate` pipe uses its own month-name table, not Intl (stripped ICU on some Android
  System WebViews is exactly why the money pipe pins its own symbols).
- SegmentedToggle: segments flex-share the row and never wrap; this also makes the Goals and
  Export toggles full-width (accepted, more consistent).
- SettingsRow: `flex-wrap` + a 12rem text-column floor wraps a wide trailing control (base
  currency, auto-lock) below the text instead of squeezing it one word per line.
- Import/scan idle screens: lede + primary button above the illustration; illustration capped at
  200px. The sample table keeps a visible thin scrollbar (the design-system section 4.5
  exception) and `nowrap` headers.
- Route titles shortened ("Budgets", "Import file") + header title single-line ellipsis as the
  safety net.
- `budget-form` numeric input re-aligned left; `.extracted-total-value` picked up the
  `--fw-semibold` token in passing (was a raw 600).
- IDE language-service showed transient "imports must be an array" errors during batched edits;
  `ng build` + 206/206 Karma tests confirm they were stale.

## Phase 5 (verification)
- Full local gate green: guards (style + IPC contract + no-network), ESLint, 206/206 Karma
  specs, production build (~5-12s). One spec updated for intentional copy change
  ("Cash · MUR"), chart specs rewritten for the aria-label contract, Home specs extended with a
  section-order test.
- `git diff main...HEAD -- src/styles/_tokens.scss design-tokens.json` is EMPTY (C1 proof).
