---
name: ui-component
description: Build any reusable UI element as a standalone presentational component in src/app/shared/ui/ instead of inlining markup/SCSS in a feature template. Use whenever you reach for a button, card, form field, list row, banner, empty state, icon button, header, nav, modal, chip, or any visual element that is (or could plausibly be) used in more than one place. Pairs with new-screen (build to spec) and new-feature (Rust-first).
---

# Make it a component, don't inline it

BudgetMate's UI must stay DRY. When you build a UI element, **the default is a reusable
component under `src/app/shared/ui/`** — not markup + SCSS pasted into a feature template. The
duplication this skill exists to prevent is real history: `.btn`/`.card`/`.row`/`.icon-btn`/
`.banner`/`.empty`/form-field markup and styles were once copy-pasted across `accounts`,
`categories`, and `lock`, and the app header/nav were inlined in the root shell. All of that is
now in `shared/ui/`.

## When this applies
- You're about to write a `<button class="...">`, `<input>` + `<label>`, a card/surface, a list
  row, a banner/alert, an empty state, a chip, a modal, a header/nav — basically any presentational
  element — inside a `features/<name>/` template or its SCSS.
- **First check `src/app/shared/ui/` — reuse or extend an existing component before making a new
  one.** If a close match exists, add an input/variant rather than forking markup.
- If nothing fits and the element is (or could be) used more than once, create a new component.
- A truly one-off, screen-specific layout (e.g. the Home balance hero) can stay in the feature —
  but if you find yourself copying it to a second screen, extract it immediately.

## Existing components (reuse these)
Under `src/app/shared/ui/`:
- **button** (`app-button`) — pill button; `variant` primary/ghost, `type`, `disabled`, `block`;
  projects optional `[icon]` slot + text. Keep `(click)` on the host.
- **icon-button** (`app-icon-button`) — icon-only, 44px target, required `ariaLabel`; projects the icon.
- **card** (`app-card`) — surface/border/radius/padding container; styled on `:host`.
- **banner** (`app-banner`) — inline alert, `role="alert"` baked in; `tone` (error today).
- **empty-state** (`app-empty-state`) — message + optional `cta`, emits `action`.
- **list-row** (`li[app-list-row]`) — card row: `name` + optional `meta`, projected `[amount]` and `[actions]`.
- **form-field** (`app-form-field`) — label + optional `hint`; **projects** the reactive-forms control.
- **select-field** (`app-select-field`) — themed accessible single-select (native `<select>` can't be themed in the WebView).
- **app-header** (`app-header`) — back/title/brand + settings link; input-driven, emits `back`.
- **bottom-nav** (`app-bottom-nav`) — canonical 4 tabs (Home · Expenses · Goals · Analytics).

The catalogue of intended components (with origin + tokens) is `docs/design/design-system.md` §7.

## How to build a new one (the convention)
Mirror `shared/ui/select-field/` and the others:
1. **Folder per component:** `src/app/shared/ui/<name>/<name>.ts` (+ `<name>.scss` via `styleUrl`,
   or inline `styles` for tiny ones).
2. **Standalone**, `selector: 'app-<name>'`, `changeDetection: ChangeDetectionStrategy.OnPush`.
3. **Signals API:** `input()` / `input.required()` for inputs, `output()` for events. No `@Input()`
   decorators.
4. **Dumb / presentational:** no `inject`ing data services, no `core/bridge`, no business logic.
   The parent (a feature component) owns data and passes it in; money math/validation stay in Rust.
5. **Content projection** for anything the consumer must own:
   - a **reactive-forms control** → project it (`<ng-content>`) so `formControlName` stays on the
     consumer's `<input>`/`<select>` and binds through DI (see `form-field`). Use
     `ViewEncapsulation.None` scoped under a host class if you must style the projected control.
   - a **Lucide icon** → project it via a named slot (`<ng-content select="[icon]">`) so the
     consumer keeps the icon import (see `button`, `icon-button`, `list-row`).
   - let native events **bubble** (don't wrap `(click)` in an output) so consumers keep
     `(click)` on the host element.
6. **Tokens only** in SCSS — `var(--c-…)`, `var(--space-…)`, `var(--radius-…)`, `var(--t-…)`,
   `var(--elev-…)`. Never hardcode hex/px/radius/shadow. Add missing tokens to `_tokens.scss` **and**
   `design-tokens.json`. Style the container on `:host` when the component *is* the element.
7. **Accessibility:** required accessible name on interactive icon-only controls; 44px tap targets
   (`--tap-target-min`); never colour-alone signalling. (See `.claude/rules/design.md`.)
8. **No barrel** — import each component by its direct path
   (`import { Button } from '../../shared/ui/button/button';`), matching the existing convention.

## Recipe
1. Search `shared/ui/` for an existing fit; reuse/extend it if found.
2. Otherwise scaffold `shared/ui/<name>/<name>.ts` to the convention above.
3. Replace the inline markup in the feature with the component; delete the now-dead SCSS from the
   feature's stylesheet.
4. Verify: `npm run lint`, `npm test`, `npm run build` (a template/projection/DI error shows here).

## Anti-patterns to reject
- Pasting button/card/field/row/banner markup + SCSS into a feature template "just this once".
- A second copy of styles that already exist on a `shared/ui/` component.
- Putting data fetching, money math, or validation inside a shared component (it must stay dumb).
- A barrel `index.ts` re-exporting `shared/ui` (breaks the direct-import convention; risks cycles).
- Hardcoded hex/px/shadow, or an ad-hoc `<svg>` instead of a projected Lucide icon.
