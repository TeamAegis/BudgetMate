# BudgetMate — Design System

The visual language, taken from the actual Figma file and reconciled with the offline/no-CDN
constraints. Values here are the source of truth; `src/styles/_tokens.scss` and
`design-tokens.json` mirror them.

---

## 1. Brand & tone
BudgetMate is calm, trustworthy, and in-the-user's-control. Warm coral primary on generous
white space; soft rounded cards; friendly illustrations for empty states. Nothing alarmist,
nothing that implies surveillance or cloud — the design should *feel* private and local.

---

## 2. Color

### 2.1 Core palette (from Figma)
| Token | Value | Use |
|---|---|---|
| `--c-primary` | `#FF7755` | Brand coral: logo, active nav, CTAs, chart bars, progress fill. |
| `--c-primary-700` | `#D84F2C` | **Accessible** coral for *small text/icons on white* (see §2.3). |
| `--c-primary-40` | `rgba(255,119,85,0.40)` | Hero balance-card fill. |
| `--c-primary-10` | `rgba(255,119,85,0.10)` | Goals card / soft section fill. |
| `--c-primary-05` | `rgba(255,119,85,0.05)` | Quick-action chips, subtle tiles. |
| `--c-bg` | `#FFFFFF` | App background. |
| `--c-surface` | `#FBFBFB` | Bottom nav, raised surfaces. |
| `--c-text` | `#000000` | Primary text. |
| `--c-text-muted` | `#5A5A5A` | Secondary text/labels (added; Figma used pure black at low size). |
| `--c-shadow-pink` | `rgba(255,203,203,0.29)` | Signature offset card shadow. |

### 2.2 Semantic (added — not in Figma, required by the FRs)
The Figma has no success/error/warning states, but envelope budgeting (FR-3.1), dedup
(FR-2.4), and over-budget warnings need them. Defined to harmonise with the coral:
| Token | Value | Use |
|---|---|---|
| `--c-positive` | `#2E9E6B` | Income, on-track, savings progress. |
| `--c-warning` | `#E8A13A` | Approaching budget cap, dedup "review" flag. |
| `--c-danger` | `#D8453B` | Over budget, destructive actions, errors. |
| `--c-info` | `#3A86C8` | Neutral info, tips. |

### 2.3 Accessibility note (important)
`#FF7755` on white is ≈ **2.8:1** contrast — it **fails** WCAG AA for normal text (needs
4.5:1) and is borderline for large text (needs 3:1). In the current Figma, nav labels and
captions use coral on white at 12–13px, which is **not accessible**.
- **Rule:** use `--c-primary` for large/bold text (≥24px or ≥19px bold), fills, and icons
  paired with a text label. For small coral text/labels on white, use `--c-primary-700`
  (`#D84F2C` ≈ 4.6:1). Verify any new pairing.

#### Semantic colours — contrast (fill, not foreground text)
The §2.2 semantics are tuned to harmonise with coral, so most **fail AA as small text on white**.
Use them as **fill/background only** — paired with their soft tints for banner/surface fills — and
never as foreground body text on white. The icon-not-colour-alone rule (§2.2, §5) still applies on
top of this: a semantic state always carries a sign/icon/label, not just hue.
| Token | On white | Allowed use |
|---|---|---|
| `--c-warning` (`#E8A13A`) | ≈ **2.6:1** — fails AA | Fill/border only, on `--c-warning-soft`; never text on white. |
| `--c-danger` (`#D8453B`) | borderline | Fill/icon (paired with label/sign), on `--c-danger-soft`; never small text on white. |
| `--c-info` (`#3A86C8`) | borderline | Fill/icon (paired with label), on `--c-info-soft`; never small text on white. |
| `--c-positive` (`#2E9E6B`) | ≈ 3.3:1 | Large/bold text + fills only (e.g. signed amounts ≥19px bold); not small body text. |

The soft tokens (`--c-danger-soft`, `--c-warning-soft`, `--c-positive-soft`, `--c-info-soft`) are
the Banner/surface background tints behind their parent colour (see §7 Banner). Foreground text on a
soft tint uses `--c-text`, not the semantic hue. **Dark-mode contrast caveat:** these ratios are for
the light theme only — re-verify every pairing when the dark-mode override lands (see §2.4).

### 2.4 Dark mode (deferred to v2)
**Dark mode is deferred to v2.** Tokens are light-only today. When it lands, a
`@media (prefers-color-scheme: dark)` override block in `_tokens.scss` will redefine the same
custom-property names — no component churn. The contract that makes this drop-in possible:
**never hardcode a hex/colour in a component** (design.md), always reference `var(--c-…)`. A
component that inlines a colour today blocks the v2 theme layer.

---

## 3. Typography

**Family:** **Poppins** — **self-hosted/bundled** (NFR-P4: never load from Google Fonts/CDN).
Ship the needed weights as local `woff2` and declare with `@font-face`. Fallback stack:
`Poppins, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

**Weights in use (from Figma):** ExtraLight 200, Light 300, Regular 400, Medium 500,
Bold 700.

### Type scale
**rem-based (root = 16px)** so OS dynamic-type scaling is honoured — sizes scale with the user's
font setting, layouts must reflow (§ux-blueprint §7). px equivalents are shown in parentheses for
reference only; never hardcode the px.
| Token | Size / weight | Used for (Figma origin) |
|---|---|---|
| `--t-wordmark` | 2rem (32px) / 700, tracking 4.8px | "BudgetMate" logo only. |
| `--t-screen-title` | 1.875rem (30px) / 700 | Screen headers ("Expenses", "Goals", "Transactions"). |
| `--t-balance` | 2rem (32px) / 200 | The big balance figure ("Rs 10,000"). |
| `--t-dialog` | 1.25rem (20px) / 600 | Modal/dialog titles (Modal, ConfirmDialog — §7). |
| `--t-title` | 1rem (16px) / 500 | Card titles ("Current Balance"). |
| `--t-section` | 0.875rem (14px) / 500 | Section labels ("Goals", "Usable Balance Trend"). |
| `--t-body` | 0.8125rem (13px) / 400 | Body, list titles, amounts. |
| `--t-caption` | 0.75rem (12px) / 300 | Nav labels, helper text, "More Goals >". |

**Line-height tokens:** `--lh-body: 1.5` for multi-line body/paragraph text; `--lh-tight: 1.2`
for headings and single-line labels (titles, balance, nav). Use the tokens — don't set raw
line-heights. Avoid weights below Light for body text on small screens (legibility).

---

## 4. Spacing, layout & shape

### 4.1 Spacing scale (4px base)
`--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`,
`--space-5: 20px`, `--space-6: 24px`, `--space-8: 32px`.
> Figma used some odd values (18, 31). Standardise: **screen gutter = 24px**
> (`--space-6`), **card padding = 20px** (`--space-5`). Keep these consistent — the Figma is
> inconsistent here and should be normalised in build.

### 4.2 Layout frame
- Mobile artboard: **412 × 917** (Android reference). Design fluid, not fixed — must adapt to
  iOS safe areas and varying heights.
- **Header:** 80px tall. Leading slot = back affordance on pushed screens (else empty); centre-left
  = wordmark (Home) or screen title (sub-screens); trailing = settings icon, shown only on the
  bottom-nav tabs. The screen name lives **only** here — screens never render an in-body title.
- **Bottom nav:** 80px tall, surface `--c-surface`, 4 tabs.
- Reserve OS safe-area insets (notch / home indicator) via env() padding.

### 4.3 Radius
`--radius-sm: 5px` (chips, chart bars, small buttons) · `--radius-md: 10px` (section cards) ·
`--radius-lg: 20px` (hero balance card) · `--radius-pill: 999px` (progress track, toggles,
FAB).

### 4.4 Elevation
- `--elev-card: 5px 5px 0px 0px rgba(255,203,203,0.29)` — the signature offset pink shadow
  (hero card).
- `--elev-float: 0 6px 16px rgba(0,0,0,0.12)` — FAB / modal dialog (added; Figma had none).

### 4.5 Overlay & stacking
- `--c-scrim: rgba(0,0,0,0.40)` — modal backdrop dim.
- `--backdrop-blur: 6px` — modal backdrop blur (`backdrop-filter: blur(var(--backdrop-blur))`),
  so the screen behind a form is legibly de-emphasised without going fully opaque.
- **Z-index scale** (only these layers float; everything else is in flow):
  `--z-dropdown: 20` (SelectField listbox) · `--z-modal: 1000` (modal scrim + dialog) ·
  `--z-modal-nested: 1010` (a dialog layered over another modal — e.g. a ConfirmDialog raised over
  an open edit form when the footer trash is tapped).
- **Scrollbars are hidden app-wide** (native-app feel — it's an app, not a website): content still
  scrolls, but no scrollbar track is drawn, on every scroll container (page, modal body, dropdown).
  A SelectField opened **inside a modal** expands the dialog in-flow (not an overlay) so every
  option stays reachable as the body scrolls.
  - **Exception — preserve a scroll affordance in long lists.** Where positional awareness matters
    (Import dedup-review list, Analytics, any list taller than one viewport) keep a visible scroll
    indicator so the user knows there's more and where they are (ui-ux §2.10). Hiding the scrollbar
    is for chrome/short containers, not for long scannable data.

---

## 5. Iconography

**Icon library: [`@lucide/angular`](https://lucide.dev/guide/angular) — the single, mandatory
source for ALL icons in the app.** Lucide is single-weight outline line icons (exactly the style
this system wants), MIT-licensed, and ships each icon as a tree-shakable standalone Angular
component that renders an **inline SVG** — bundled in the JS, **no CDN, no icon font, no network
request** (NFR-P4). Do not hand-roll ad-hoc inline `<svg>`s, import an icon font, or add a second
icon library.

### Usage (standalone components)
Import only the icons a component uses and add them to its `imports`; reference each by its
`lucide…` attribute directive on an `<svg>`:
```ts
import { LucideSettings, LucideHouse } from '@lucide/angular';
@Component({ imports: [LucideSettings, LucideHouse], /* … */ })
```
```html
<svg lucideSettings [size]="24" aria-label="Settings"></svg>
```
Global defaults (e.g. stroke width) are set once via `provideLucideConfig({ strokeWidth: 1.75 })`
in `src/app/app.config.ts`. For data-driven/dynamic icons, use Lucide's dynamic component with
`provideLucideIcons(...)` rather than a `@switch` of static directives.

### Sizing & colour
- **Sizes:** nav icons **22–24px**, inline/action icons **24px**, larger feature glyphs up to
  **32px**. Tokens: `--icon-size-sm` (24), `--icon-size-md` (32). Stroke width **1.75**.
- Icons inherit `currentColor`. **Active** nav icon + label use `--c-primary-700` (the
  AA-accessible coral on white); **inactive** use `--c-text-muted`. Never rely on colour alone —
  pair an icon with a text label or sign.

### Accessibility
- Every standalone/interactive icon needs an accessible name (`aria-label` / `title`); decorative
  icons paired with visible text use `aria-hidden="true"`.
- Keep tap targets ≥ `--tap-target-min` (**48px** — Android v1 primary target; ≥ the WCAG 2.2
  SC 2.5.8 24px floor and the iOS 44pt minimum) even when the glyph is smaller.

### Common mappings (extend as needed)
Home `house` · Expenses `wallet` · Goals `target` · Analytics `pie-chart` · Settings `settings` ·
Add `plus` · Scan receipt `scan-line` · Import `file-down` · Over-budget/alert `triangle-alert` ·
Success `circle-check` · Duplicate/review `copy`.

---

## 6. Motion
Subtle and fast (supports the <800ms-feel goal; nothing that delays first paint). This is the
canonical motion spec; `.claude/rules/design.md → Motion` enforces it for new work.

**Principles**
- Subtle and quick — motion confirms a change, it never gates interaction.
- No skeleton-blocking animation on cold start — show content progressively.
- Always honour `prefers-reduced-motion` (see below).

**Tokens** (`src/styles/_tokens.scss`; mirrored in `design-tokens.json`) — never hardcode a
duration or easing:
- `--motion-fast: 150ms` — taps, toggles, chip/press, scrim fade.
- `--motion-standard: 200ms` — page/list entrance, modal dialog.
- `--motion-slow: 300ms` — progress-bar fill, skeleton pulse cycle.
- `--easing: cubic-bezier(0.2, 0, 0, 1)` — the single ease-out curve for everything.

**Keyframe + class library** (`src/styles/_animations.scss`, `@use`d globally) — the one source;
reuse these, don't author ad-hoc keyframes in a component:
- `fade-in`, `fade-in-up`, `scrim-in`, `modal-enter`, `skeleton-pulse`, `spin`.
- `.list-item-enter` (the only enter-class) for items entering a list.

**Per-surface mapping**
- **Page transitions** — automatic via the app shell (`src/app/app.scss` `router-outlet + *`,
  `fade-in`). Screens add nothing per page.
- **List rows** — `animate.enter="list-item-enter"` (Angular 20 native CSS hook), with a capped
  stagger: `[style.animation-delay]="(i < 12 ? i * 40 : 0) + 'ms'"` (40ms steps, no delay past 12
  rows so long lists don't drag).
- **Modals** — `app-modal` applies `scrim-in` (`--motion-fast`) + `modal-enter` (`--motion-standard`)
  itself; consumers get it for free.
- **Skeletons / spinners** — `.anim-skeleton-pulse` / `.anim-spin` (infinite, cancelled under reduce).
- **Progress** — animate `width` with `transition: width var(--motion-slow) var(--easing)`
  (e.g. GoalProgressRow fills from 0 on mount).

**Reduced-motion contract** — the motion tokens are zeroed under
`@media (prefers-reduced-motion: reduce)` in `_tokens.scss`, so token-driven motion stops with no
extra work; `_animations.scss` additionally cancels the infinite/movement keyframes. Any new
animation must be token-driven (so it inherits this) or add its own reduce guard.

> Note: most Android **emulators** report `prefers-reduced-motion: reduce` because
> `animator_duration_scale` defaults to 0 — so motion looks instant there. Set it to 1
> (`adb shell settings put global animator_duration_scale 1.0`) or test on a real device to see it.

---

## 7. Component library

Each component lists its origin (Figma node or "new" if required by FRs but absent in Figma)
and the tokens it consumes. Components are dumb/presentational (`shared/`) unless noted.

> **Built so far** (`src/app/shared/ui/`): AppHeader, BottomNav, EmptyState, Button (primary /
> ghost / **danger** variants), Card, FormField, IconButton, Banner, ListRow, SelectField,
> Skeleton, Spinner, **Modal**, **ConfirmDialog**, **GoalProgressRow**. Reuse/extend these rather than re-inlining
> markup — see the `ui-component` skill. The remaining entries below are still to be built as
> they're needed.

### Present in Figma
- **AppHeader** — leading back affordance (pushed screens) + title/wordmark + trailing icon.
  Variants: brand (home, `--t-wordmark`) / titled (sub-screens, `--t-screen-title`). It is the
  **only** place a screen name appears — no in-body screen titles. Driven by the active route's
  `data.title` / `data.back`; the trailing settings icon shows only when there is no back affordance
  (i.e. the bottom-nav tabs).
- **BottomNav** — 4 tabs. **Canonical tabs: Home · Expenses · Goals · Analytics.**
  Note: Figma inconsistently labels the 4th tab "Charts" on some screens and "Analytics" on
  others, and tab x-positions drift between screens — **normalise to evenly-spaced flexbox
  and one label ("Analytics")**.
- **BalanceCard** — hero. `--c-primary-40` fill, `--radius-lg`, `--elev-card`. Shows Current
  Balance (`--t-balance`), Usable Balance, wallet illustration.
- **QuickActionChip** — 90×60 tile, `--c-primary-05`, `--radius-sm`, icon + caption.
  Note: Figma shows duplicate "Transaction" labels — placeholder; real actions: *Add
  Transaction*, *Add Goal*, *Scan Receipt*.
- **GoalProgressRow** (`app-goal-progress-row`, **built**) — label, pill progress track with knob,
  `current / target` amounts (via the money pipe). Track `--c-primary-10`, fill + knob
  `--c-primary`; fill animates from 0 on mount (`--motion-slow`, reduced-motion honoured).
  **Completed** state: full `--c-positive` track (knob hidden), trailing check icon, strikethrough
  title/amounts — completion is shown by icon + text, never colour alone (a11y). Display-only
  (progress derived from the saved amount); the whole row is a button that emits `edit`.
- **TrendChart** — bar series + line overlay, "Usable Balance Trend". Bars `--c-primary`,
  `--radius-sm` top. **Implement with bundled Chart.js (canvas)**, not static images.
- **TransactionListItem** — leading icon tile, title, date, trailing signed amount
  (`+ Rs 500`). Sign coloured: income `--c-positive`, expense `--c-danger`/`--c-text`.
- **SegmentedToggle** — Daily/Weekly/Monthly and Ongoing/Completed. Pill, active segment
  `--c-primary`.
- **FAB** — 60px coral circle, `+` icon, `--elev-float`. For add-transaction / add-goal. The
  **host list must reserve bottom space** so the FAB never occludes the last row: `padding-bottom`
  ≥ `--layout-fab-size + --space-6` (≈84px). Without it the final transaction/goal hides behind the
  button (ui-ux §2.10). See `screens.md` §4.1, §5.1.
- **Modal** (`app-modal`) — the app-wide form/dialog container. Centred card (`--radius-lg`,
  `--elev-float`, `max-width 420px`, `max-height 90vh`) over a dimmed + blurred scrim (`--c-scrim`
  + `--backdrop-blur`, `--z-modal`). **Every form in the app is a modal** — it renders via `@if`
  and projects a `<form class="modal-form">` with a scrollable `.modal-body` and a pinned
  `.modal-footer`. Footer convention: optional leading **trash** `IconButton` (edit mode only) ·
  `.modal-footer-spacer` · ghost *Cancel* · primary *Save* (`type="submit"`, kept inside the form
  so Enter saves). Behaviour: `role="dialog"`/`aria-modal`, labelled by its title, focus trap +
  restore, body scroll-lock, dismiss on Escape / backdrop-click (suppressed while `busy`), enter
  animation `modal-enter` (reduced-motion honoured). Replaces the old Figma "TransactionPopup".
- **ConfirmDialog** (`app-confirm-dialog`) — two-button destructive confirm built on Modal
  (title, message, danger confirm + ghost cancel). Used before delete / restore-replace /
  over-budget acknowledgement (§8.2). Emits `confirm` / `cancelled`.
- **EmptyState** — centred illustration + message + CTA ("No goals? Create one!",
  "Tap the Button below…", "No Data").
- **TextField (underline)** — income/type inputs: label, value, bottom rule. For amounts use
  a numeric keypad.

### New — required by FRs, absent in Figma (specified here, to design)
- **LockScreen** — biometric prompt + passphrase fallback (FR-5.1). App entry gate.
- **ReceiptScanSheet** — camera/preview → OCR progress → **editable extracted fields**
  (merchant/date/total) for confirmation (FR-2.1).
- **ImportWizard** — file picker → column mapping (CSV) → rule preview → **dedup review list**
  → confirm (FR-2.2/2.3/2.4).
- **SplitEditor** — add/remove split rows; live "remaining to allocate" that must reach 0
  (FR-1.2).
- **CurrencyField** — amount + currency selector + user-entered FX rate + computed base
  amount (FR-1.4).
- **EnvelopeCard** — category cap with spent/remaining bar; warning/over states using
  `--c-warning`/`--c-danger` (FR-3.1).
- **RecurringRuleForm** — template + schedule picker (FR-1.3).
- **RuleBuilderRow** — "If [field] [op] [value] → set [field] [value]" (FR-2.3).
- **SettingsList + BackupRestorePanel** — base currency, lock timeout, export, encrypted
  backup/restore (FR-4.x, FR-5.2).
- **Banner/Toast** — success/warning/error feedback (semantic colours).

---

## 8. Currency & number formatting
- Default currency **MUR**, symbol **"Rs"**, format `Rs 1,234` (no decimals shown when whole;
  2 decimals otherwise). Formatting is done by a shared Angular pipe from **integer minor
  units** received from Rust — never computed in TS.
- Multi-currency rows show original amount + `(≈ Rs … )` base conversion (FR-1.4).
- Negative/expense amounts and positive/income amounts are visually distinguished by colour +
  sign, not colour alone (accessibility).
