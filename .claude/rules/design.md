# Rules - Design / UI (`src/` styling & components)

Applies when building or changing any UI. Read alongside `.claude/rules/frontend.md`. Full
spec: `docs/design/` (README, design-system, ux-blueprint, screens). The *why* behind these rules -
the UI/UX principles, UX laws, WCAG 2.2, and anti-patterns - lives in
`docs/design/ui-ux-principles.md`; audit any screen, component, or blueprint against it with
**`/design-check <target>`** (the read-only `design-validator` role).

## Tokens
- **Use design tokens only.** Pull from `src/styles/_tokens.scss` (CSS custom properties).
  Never hardcode hex colours, px sizes, radii, or shadows in components - reference
  `var(--c-…)`, `var(--space-…)`, `var(--radius-…)`, `var(--t-…)`.
- If a needed token doesn't exist, add it to `_tokens.scss` (and `design-tokens.json`) with a
  comment, don't inline a magic value.

## Brand & assets (offline)
- Font is **Poppins, self-hosted** via local `@font-face` + bundled `woff2`. **Never** link
  Google Fonts or any CDN (NFR-P4). Same for icons and illustrations - all bundled locally.
- No remote images, no online avatars, no network-dependent UI. Their absence is a feature.

## Accessibility (enforced)
- Coral `#FF7755` on white fails AA for small text. Use `--c-primary-700` for small coral
  text/icons on white throughout; reserve `--c-primary` for large/bold text, fills, and icons with a
  separate label. Verify contrast for any new pairing (AA: 4.5:1 body, 3:1 large). White-on-coral
  fills (e.g. the SegmentedToggle active segment) also use `--c-primary-700` - white text on the
  lighter `--c-primary` failed AA.
- Never signal meaning by colour alone (income/expense, over-budget, dedup) - pair with
  sign/icon/label.
- Tap targets ≥ 44×44pt. Inputs have visible labels. Honour `prefers-reduced-motion` and OS
  dynamic type.
- **Android WebView caveat:** `env(safe-area-inset-*)` and keyboard resize are unreliable - for
  notch/home-indicator padding and keyboard-aware layout use the `visualViewport` workaround in
  `.claude/rules/android.md`, not safe-area CSS alone.

## Icons
- **All icons use [`@lucide/angular`](https://lucide.dev/guide/angular).** It is the single,
  mandatory icon source - bundled inline SVG, tree-shakable, no CDN/icon-font/network (NFR-P4).
- Import only the icons a component needs and add them to its `imports`; reference via the
  `lucide…` attribute directive on an `<svg>` (e.g. `<svg lucideWallet [size]="24">`). Do **not**
  hand-roll ad-hoc `<svg>` icons, add an icon font, or introduce a second icon library.
- Global defaults live in `provideLucideConfig({ strokeWidth: 1.75 })` (`app.config.ts`). Sizes:
  nav 22-24, inline 24, feature glyphs ≤32 (`--icon-size-sm/md`). Icons inherit `currentColor`.
- Every interactive icon has an accessible name (`aria-label`/`title`); decorative icons paired
  with text use `aria-hidden`. Tap targets ≥ 44px. See `docs/design/design-system.md` §5 for the
  name→icon mapping.

## Components
- **Reusable UI elements are components, never inlined.** Any button, card, form field, list
  row, banner, empty state, icon button, header/nav, etc. lives as a dumb/presentational
  standalone component in **`src/app/shared/ui/`** - reuse or extend an existing one before
  adding markup/SCSS to a feature template. Follow the **`ui-component`** skill
  (`.claude/skills/ui-component/`) for the convention.
- Build the components named in `design-system.md` §7; keep them dumb/presentational in
  `shared/ui/` and feed data from feature components (which call `core/bridge`).
- **Add/edit forms are full-screen routed pages, not modals.** Each is a pair of lazy routes
  `<area>/new` and `<area>/:id/edit` with route data `{ title, back: true, hideNav: true }`. The
  back arrow is *Cancel*; the primary *Save* lives in a **fixed bottom action bar** (`FormActions`,
  `app-form-actions`) that lifts with `--keyboard-inset` so the Android soft keyboard never hides it
  (this supersedes the old Save-in-the-header placement). The page reserves bottom padding so the
  last field clears the bar. The **destructive** action - Delete (Transaction, Goal, Rule) or Archive
  (Account, Category) - is a **danger icon-button at the top-right of the header** on the edit page,
  published via `HeaderActionService` (which carries an optional `icon: 'trash' | 'archive'`) and
  opens a ConfirmDialog. Build to the form-page pattern (`transaction-form` is the canonical example),
  never a centred modal. **`ConfirmDialog` is the only overlay in the app**; `app-modal` is its
  confirm/alert substrate only, retired as a form container. See `docs/design/screens.md` §8.0 and
  ADR 0003 (form action placement, superseding `docs/adr/0002-page-based-forms-no-modals.md` on
  Save/Delete placement).
- **Buttons are slightly rounded** via `--radius-button` (14px) - not a full pill; the shared
  `Button` uses this token (the FormActions Save and the ActionTile/SettingsRow chrome all sit on it).
- **Expenses primary action is a `FabMenu`** (`app-fab-menu`, tap-to-open, labelled *Add expense* /
  *Scan receipt*), not the old long-press FAB; Goals keeps a simple single-action FAB.
- **Charts:** bundled **Chart.js (canvas)** only - never a remote chart script, never static
  image charts. (TrendChart, pie, line.)
- BottomNav canonical tabs: **Home · Expenses · Goals · Analytics** (one label set - do not
  reintroduce the Figma "Charts/Analytics" inconsistency).

## Money & data display
- Format all amounts with the shared money pipe from **integer minor units** supplied by Rust.
  Never do money arithmetic in TS. Default currency MUR ("Rs"); show base conversion for
  foreign-currency rows (FR-1.4).
- **Domain reference:** the canonical expense **category taxonomy** is `docs/financial-knowledge.md`
  §2; **MUR currency/number formatting** conventions are §8. Reference those rather than inventing
  categories or formats. Keep financial **jargon** out of UI copy or pair it with a plain-language
  explainer - the app must be usable by someone with little or no financial literacy (validate with
  the `/finance-check` skill).

## Plain-language glossary (show users the right side)
Avoid the raw term in UI copy, or pair it with the plain-language phrasing below. Validate copy with
`/finance-check`. The *why* (low-literacy usability, behavioral framing) is in
`docs/financial-knowledge.md` §9.

| Term (avoid showing raw) | Show / explain as |
|---|---|
| Envelope (budget) | "monthly limit for a category" / "category budget" |
| Materialised (recurring) | "added automatically" / "created for you" |
| Splits | "share one transaction across categories" |
| Base currency | "the currency your reports add up in" |
| FX / exchange rate | "how much 1 [foreign] is worth in [base]" |
| Sinking fund | "money set aside a bit at a time for a known future cost" |
| Net / take-home income | "what actually lands in your account after deductions" |

## States
- Every data screen implements all five states: loading (non-blocking), empty (illustration +
  CTA), populated, error (plain-language + action), busy/processing (OCR/import/export with
  progress, UI stays responsive). Plus the special states in `ux-blueprint.md` §5
  (locked, over-budget, dedup-review, low-confidence-OCR).
- **Over-budget is gentle, not punitive.** Do not flip an envelope to alarm-red the moment it
  crosses 100%. Differentiate approaching (warning) / over / well-over, phrase it as information
  ("Rs X left", "Rs Y over") rather than as failure, and pair the state with icon + label, never
  colour alone. Rationale and detail: `ux-blueprint.md` §5 and `docs/financial-knowledge.md` §9.

## Motion / Animation
Canonical spec: `docs/design/design-system.md` §6. Keep motion subtle and fast (<800ms-feel; never
blocks first paint).
- **Tokens only.** Pull durations/easing from `_tokens.scss` (`var(--motion-fast|standard|slow)`,
  `var(--easing)`) - never hardcode a `ms`/`s` value or a `cubic-bezier`. Add a token if one is
  missing.
- **Reuse the library.** Keyframes + the `.list-item-enter` class live in `src/styles/_animations.scss`
  (`@use`d globally). Reuse them; don't author one-off keyframes in a component.
- **Apply per the surface map:** page transitions are automatic (app shell, `src/app/app.scss`
  `router-outlet + *`) - add nothing per page (form pages, being routed pages, get this automatic
  transition too); entering list rows use `animate.enter="list-item-enter"` with the capped stagger
  `[style.animation-delay]="(i < 12 ? i * 40 : 0) + 'ms'"`; the ConfirmDialog gets
  `scrim-in`/`modal-enter` from `app-modal` (its substrate); progress fills animate `width` with
  `transition`.
- **Reduced motion is mandatory.** Motion tokens are zeroed under
  `@media (prefers-reduced-motion: reduce)`, so token-driven animation stops for free; any infinite
  or movement keyframe also needs an explicit guard (see `_animations.scss`). Verify motion still
  reads correctly with reduce on.
- Emulators usually report `reduce` (animator scale 0) so motion looks instant; set
  `animator_duration_scale 1.0` or use a real device to verify.

## Flows that must never auto-commit
- OCR (FR-2.1) and Import (FR-2.2/2.3/2.4) always end in a **user-confirmation** step. Show
  the deterministic reason for any suggested category/duplicate. Nothing saves or deletes
  silently.

## When designing a NEW screen
Check `docs/design/screens.md` first - many "missing" screens (Lock, Scan, Import, Settings,
Envelopes, Backup) are already specified there with their FR, components, commands, and
states. Build to that spec rather than inventing layout.
