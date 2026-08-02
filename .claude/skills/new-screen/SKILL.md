---
name: new-screen
description: Build or change a BudgetMate UI screen/component to the design system. Use whenever creating or editing any Angular view, screen, or presentational component so it stays on-system - design tokens only, Lucide icons, the shared money pipe, the five required states, accessibility, and bridge-only data. Pair with new-feature (which adds the Rust command first).
---

# Building a screen to the design system

BudgetMate's UI is fully specified. Build to the spec, don't invent layout. Source of truth:
- `docs/design/screens.md` - per-screen spec: FR IDs, components, **data shown**, **Rust
  command(s)** called, and **states**. Find your screen here first.
- `docs/design/design-system.md` - tokens, type scale, components (§7), icons (§5).
- `docs/design/ux-blueprint.md` - IA, flows, the five states (§5), accessibility (§7).
- `.claude/rules/design.md` + `.claude/rules/frontend.md` - the enforced rules.
- `docs/financial-knowledge.md` - domain truth for any money copy: §2 (category taxonomy), §8 (MUR
  formatting), §9 (plain-language framing). Avoid jargon or use the glossary in
  `.claude/rules/design.md`; keep the over-budget state gentle (§5 of `ux-blueprint.md`); validate
  with `/finance-check`.

If the screen needs data from Rust, do the **new-feature** skill first (Rust command + DTO →
TS model → bridge wrapper), then build the view here.

## Hard rules (enforced)
- **Tokens only.** Style with `var(--c-…)`, `var(--space-…)`, `var(--radius-…)`, `var(--t-…)`,
  `var(--elev-…)` from `src/styles/_tokens.scss`. **Never** hardcode hex, px, radius, or shadow.
  If a token is missing, add it to `_tokens.scss` **and** `design-tokens.json` with a comment.
- **Icons via `@lucide/angular` only.** Import the specific icons, add to the component `imports`,
  use `<svg lucideName [size]="24">`. No ad-hoc inline SVG, no icon fonts/CDN, no second library.
  Accessible name on interactive icons (`aria-label`/`title`); `aria-hidden` on decorative ones.
- **Data only through `core/bridge`.** Never import `@tauri-apps/api` in a feature/screen
  (eslint blocks it). No business logic in TS - money/dedup/recurrence/validation live in Rust.
- **Money via the shared `money` pipe**, formatted from integer minor units (default MUR "Rs").
  Never do money arithmetic in TS.
- **Motion via tokens + the shared library** (`docs/design/design-system.md` §6,
  `.claude/rules/design.md → Motion`). Page transitions are automatic (app shell) - add nothing per
  page; entering list rows use `animate.enter="list-item-enter"` with the capped stagger; the
  ConfirmDialog animates via `app-modal`. Token-driven durations/easing only; honour
  `prefers-reduced-motion`.
- **Add/edit forms are full-screen pages (routes `<area>/new` + `<area>/:id/edit`,
  data `{ back, hideNav }`), not modals** - *Save* is published into the global header via
  `HeaderActionService`. `ConfirmDialog` is the only centred dialog in the app; the only other overlay
  is the `NavDrawer` navigation sheet (ADR 0013), which never hosts a form. See
  `docs/design/screens.md` §7.0/§8.0 and `docs/adr/0002-page-based-forms-no-modals.md`.
- **Standalone component**, signals for state, typed reactive forms for input. Heavy screens
  (OCR/charts) get a lazy route.

## The five states (every data screen)
Implement all five (ux-blueprint §5): **loading** (non-blocking, progressive), **empty**
(illustration/icon + one line + primary CTA), **populated**, **error** (plain-language + a
retry/fix action - never a raw stack trace), **busy/processing** (OCR/import/export with progress,
UI stays responsive). Plus the special states where they apply: **locked**, **over-budget**
(danger), **dedup-review** (warning, keep/skip), **low-confidence OCR field** (flagged, editable).

## Accessibility
WCAG AA: contrast 4.5:1 body / 3:1 large - use `--c-primary-700` for small coral text/icons on
white (plain `--c-primary` fails AA at small sizes). Never signal meaning by colour alone (pair
sign/icon/label). Tap targets ≥ `--tap-target-min` (44px). Visible input labels (not
placeholder-only). Honour `prefers-reduced-motion` and OS dynamic type.

## Never auto-commit (FR-2.x)
OCR (FR-2.1) and Import (FR-2.2/2.3/2.4) **always** end in a user-confirmation step, and show the
deterministic reason for any suggested category/duplicate. Nothing saves or deletes silently.

## Recipe
1. Read the screen's row in `docs/design/screens.md` (FR, components, commands, states).
2. Reuse/extend a component from `design-system.md` §7; keep dumb/presentational pieces in
   `shared/`, smart/data pieces in `features/<name>/`.
3. Wire data via the bridge wrapper; format money with the pipe; icons via Lucide.
4. Implement all five states; add the special states the screen needs.
5. Verify: `npm run lint` (bridge-boundary + a11y rules), `npm test`, `npm run build`,
   `npm run guards`. Check the network tab is empty (no remote font/script/image).

## Anti-patterns to reject
- Hardcoded hex/px/shadow instead of tokens; a one-off `<svg>` instead of a Lucide icon.
- `invoke(...)` or `@tauri-apps/api` imported in a screen instead of `core/bridge`.
- Money math/formatting by hand in TS; a screen with only the "populated" state.
- A remote font/image/script, or an icon font - breaks the offline guarantee.
