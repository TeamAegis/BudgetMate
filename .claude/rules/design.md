# Rules — Design / UI (`src/` styling & components)

Applies when building or changing any UI. Read alongside `.claude/rules/frontend.md`. Full
spec: `docs/design/` (README, design-system, ux-blueprint, screens).

## Tokens
- **Use design tokens only.** Pull from `src/styles/_tokens.scss` (CSS custom properties).
  Never hardcode hex colours, px sizes, radii, or shadows in components — reference
  `var(--c-…)`, `var(--space-…)`, `var(--radius-…)`, `var(--t-…)`.
- If a needed token doesn't exist, add it to `_tokens.scss` (and `design-tokens.json`) with a
  comment, don't inline a magic value.

## Brand & assets (offline)
- Font is **Poppins, self-hosted** via local `@font-face` + bundled `woff2`. **Never** link
  Google Fonts or any CDN (NFR-P4). Same for icons and illustrations — all bundled locally.
- No remote images, no online avatars, no network-dependent UI. Their absence is a feature.

## Accessibility (enforced)
- Coral `#FF7755` on white fails AA for small text. Use `--c-primary-700` for small coral
  text/icons on white; reserve `--c-primary` for large/bold text, fills, and icons with a
  separate label. Verify contrast for any new pairing (AA: 4.5:1 body, 3:1 large).
- Never signal meaning by colour alone (income/expense, over-budget, dedup) — pair with
  sign/icon/label.
- Tap targets ≥ 44×44pt. Inputs have visible labels. Honour `prefers-reduced-motion` and OS
  dynamic type.

## Icons
- **All icons use [`@lucide/angular`](https://lucide.dev/guide/angular).** It is the single,
  mandatory icon source — bundled inline SVG, tree-shakable, no CDN/icon-font/network (NFR-P4).
- Import only the icons a component needs and add them to its `imports`; reference via the
  `lucide…` attribute directive on an `<svg>` (e.g. `<svg lucideWallet [size]="24">`). Do **not**
  hand-roll ad-hoc `<svg>` icons, add an icon font, or introduce a second icon library.
- Global defaults live in `provideLucideConfig({ strokeWidth: 1.75 })` (`app.config.ts`). Sizes:
  nav 22–24, inline 24, feature glyphs ≤32 (`--icon-size-sm/md`). Icons inherit `currentColor`.
- Every interactive icon has an accessible name (`aria-label`/`title`); decorative icons paired
  with text use `aria-hidden`. Tap targets ≥ 44px. See `docs/design/design-system.md` §5 for the
  name→icon mapping.

## Components
- Build the components named in `design-system.md` §7; keep them dumb/presentational in
  `shared/` and feed data from feature components (which call `core/bridge`).
- **Charts:** bundled **Chart.js (canvas)** only — never a remote chart script, never static
  image charts. (TrendChart, pie, line.)
- BottomNav canonical tabs: **Home · Expenses · Goals · Analytics** (one label set — do not
  reintroduce the Figma "Charts/Analytics" inconsistency).

## Money & data display
- Format all amounts with the shared money pipe from **integer minor units** supplied by Rust.
  Never do money arithmetic in TS. Default currency MUR ("Rs"); show base conversion for
  foreign-currency rows (FR-1.4).

## States
- Every data screen implements all five states: loading (non-blocking), empty (illustration +
  CTA), populated, error (plain-language + action), busy/processing (OCR/import/export with
  progress, UI stays responsive). Plus the special states in `ux-blueprint.md` §5
  (locked, over-budget, dedup-review, low-confidence-OCR).

## Flows that must never auto-commit
- OCR (FR-2.1) and Import (FR-2.2/2.3/2.4) always end in a **user-confirmation** step. Show
  the deterministic reason for any suggested category/duplicate. Nothing saves or deletes
  silently.

## When designing a NEW screen
Check `docs/design/screens.md` first — many "missing" screens (Lock, Scan, Import, Settings,
Envelopes, Backup) are already specified there with their FR, components, commands, and
states. Build to that spec rather than inventing layout.
