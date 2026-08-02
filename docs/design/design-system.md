# BudgetMate - Design System

The visual language, taken from the actual Figma file and reconciled with the offline/no-CDN
constraints. Values here are the source of truth; `src/styles/_tokens.scss` and
`design-tokens.json` mirror them.

---

## 1. Brand & tone
BudgetMate is calm, trustworthy, and in-the-user's-control. Warm coral primary on generous
white space; soft rounded cards; friendly illustrations for empty states. Nothing alarmist,
nothing that implies surveillance or cloud - the design should *feel* private and local.

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

### 2.2 Semantic (added - not in Figma, required by the FRs)
The Figma has no success/error/warning states, but envelope budgeting (FR-3.1), dedup
(FR-2.4), and over-budget warnings need them. Defined to harmonise with the coral:
| Token | Value | Use |
|---|---|---|
| `--c-positive` | `#2E9E6B` | Income, on-track, savings progress. |
| `--c-positive-700` | `#1B7A4F` | **Accessible** green for *small text/icons on white or a soft tint* (see §2.3). |
| `--c-warning` | `#E8A13A` | Approaching budget cap, dedup "review" flag. |
| `--c-warning-700` | `#8A5300` | **Accessible** amber for *small text/icons on white or a soft tint* (see §2.3). |
| `--c-danger` | `#D8453B` | Over budget, destructive actions, errors. |
| `--c-danger-700` | `#B3261E` | **Accessible** red for *small text/icons on white or a soft tint* (see §2.3). |
| `--c-info` | `#3A86C8` | Neutral info, tips. |
| `--c-info-700` | `#1F5F94` | **Accessible** blue for *small text/icons on white or a soft tint* (see §2.3). |

### 2.3 Accessibility note (important)
`#FF7755` on white is ≈ **2.8:1** contrast - it **fails** WCAG AA for normal text (needs
4.5:1) and is borderline for large text (needs 3:1). In the current Figma, nav labels and
captions use coral on white at 12-13px, which is **not accessible**.
- **Rule:** use `--c-primary` for large/bold text (≥24px or ≥19px bold), fills, and icons
  paired with a text label. For small coral text/labels on white, use `--c-primary-700`
  (`#D84F2C` ≈ 4.6:1). Verify any new pairing.
- **White-on-coral fills** (e.g. the SegmentedToggle active segment) use `--c-primary-700` for the
  fill, not the lighter `--c-primary` - white text on `--c-primary` fails AA, on `--c-primary-700`
  it clears it. Coral text/icons on white likewise use `--c-primary-700` throughout.

#### Semantic colours - contrast (fill, not foreground text)
The §2.2 semantics are tuned to harmonise with coral, so most **fail AA as small text on white**.
Use them as **fill/background only** - paired with their soft tints for banner/surface fills - and
never as foreground body text on white. The icon-not-colour-alone rule (§2.2, §5) still applies on
top of this: a semantic state always carries a sign/icon/label, not just hue.
| Token | On white | Allowed use |
|---|---|---|
| `--c-warning` (`#E8A13A`) | ≈ **2.6:1** - fails AA | Fill/border only, on `--c-warning-soft`; never text on white. |
| `--c-danger` (`#D8453B`) | borderline | Fill/icon (paired with label/sign), on `--c-danger-soft`; never small text on white. |
| `--c-info` (`#3A86C8`) | borderline | Fill/icon (paired with label), on `--c-info-soft`; never small text on white. |
| `--c-positive` (`#2E9E6B`) | ≈ 3.3:1 | Large/bold text + fills only (e.g. signed amounts ≥19px bold); not small body text. |
| `--c-warning-700` (`#8A5300`) | ≈ 6.3:1 - passes AA | Accessible amber for small text/icons on white or `--c-warning-soft` (on `--c-warning-soft` itself ≈ 5.8:1 - AA). |
| `--c-danger-700` (`#B3261E`) | ≈ 6.5:1 - passes AA | Accessible red for small text/icons on white or `--c-danger-soft` (on `--c-danger-soft` itself ≈ 5.7:1 - AA). |
| `--c-info-700` (`#1F5F94`) | ≈ 6.7:1 - passes AA | Accessible blue for small text/icons on white or `--c-info-soft` (on `--c-info-soft` itself ≈ 6.0:1 - AA). |
| `--c-positive-700` (`#1B7A4F`) | ≈ 5.3:1 - passes AA | Accessible green for small text/icons on white or `--c-positive-soft` (on `--c-positive-soft` itself ≈ 4.8:1 - the tightest margin, still clears the 4.5:1 AA floor). |

The soft tokens (`--c-danger-soft`, `--c-warning-soft`, `--c-positive-soft`, `--c-info-soft`) are
the Banner/surface background tints behind their parent colour (see §7 Banner). Foreground text and
icons on a soft tint use `--c-text` or the tone's accessible `-700` variant (`--c-warning-700`,
`--c-danger-700`, `--c-info-700`, `--c-positive-700`), never the base semantic hue. **Dark-mode
contrast caveat:** these ratios are for the light theme only - re-verify every pairing when the
dark-mode override lands (see §2.4).

### 2.4 Dark mode (deferred to v2)
**Dark mode is deferred to v2.** Tokens are light-only today. When it lands, a
`@media (prefers-color-scheme: dark)` override block in `_tokens.scss` will redefine the same
custom-property names - no component churn. The contract that makes this drop-in possible:
**never hardcode a hex/colour in a component** (design.md), always reference `var(--c-…)`. A
component that inlines a colour today blocks the v2 theme layer.

### 2.5 Charts (FR-3.3 Analytics)
Bundled Chart.js (canvas) only - never a remote chart script. Chart.js draws to a `<canvas>` 2D
context, which does not resolve `var(--x)` itself, so `shared/charts/chart-setup.ts`'s `chartColor()`
resolves these tokens to a literal colour once at render time; components still never hardcode a hex.
| Token | Value | Use |
|---|---|---|
| `--chart-cat-1` .. `--chart-cat-4` | `--c-primary`, `--c-info`, `--c-positive`, `--c-warning` | Pie per-category slices 1-4 (large fills - `--c-primary` itself is allowed here, unlike small text/strokes; see §2.3). |
| `--chart-cat-5` | `#8B5FBF` (purple) | Pie slice 5 - added categorical hue. |
| `--chart-cat-6` | `#2BA9A1` (teal) | Pie slice 6 - added categorical hue. |
| `--chart-cat-7` | `#D6598F` (rose) | Pie slice 7 - added categorical hue. |
| `--chart-cat-8` | `--c-text-muted` | Reserved for the pie chart's "Other" rollup slice (categories beyond the 7 explicit hues are summed into one "Other" slice, not silently recoloured by wrapping the palette). |
| `--chart-line` | `--c-primary-700` (`#D84F2C`) | Spend-over-time line/point colour. Uses the **accessible** `-700` coral, not `--c-primary` - a thin stroke/point is small-scale coral, and `--c-primary` alone is ≈2.6:1 on white (fails WCAG 2.2 SC 1.4.11's 3:1 non-text floor; see §2.3). |
| `--chart-grid` | `--c-border` | Line chart axis gridlines. |
| `--chart-height` | `240px` | Canvas container height (`PieChart`/`LineChart`). |

---

## 3. Typography

**Family:** **Poppins** - **self-hosted/bundled** (NFR-P4: never load from Google Fonts/CDN).
Ship the needed weights as local `woff2` and declare with `@font-face`. Fallback stack:
`Poppins, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

**Weights in use (from Figma):** ExtraLight 200, Light 300, Regular 400, Medium 500,
Bold 700.

### Type scale
**rem-based (root = 16px)** so OS dynamic-type scaling is honoured - sizes scale with the user's
font setting, layouts must reflow (§ux-blueprint §7). px equivalents are shown in parentheses for
reference only; never hardcode the px.
| Token | Size / weight | Used for (Figma origin) |
|---|---|---|
| `--t-wordmark` | 2rem (32px) / 700, tracking 4.8px | "BudgetMate" logo only. |
| `--t-screen-title` | 1.875rem (30px) / 700 | Screen headers ("Expenses", "Goals", "Transactions"). |
| `--t-balance` | 2rem (32px) / 200 | The big balance figure ("Rs 10,000"). |
| `--t-dialog` | 1.25rem (20px) / 600 | Dialog titles (ConfirmDialog - §7). |
| `--t-title` | 1rem (16px) / 500 | Card titles ("Current Balance"). |
| `--t-section` | 0.875rem (14px) / 500 | Section labels ("Goals", "Usable Balance Trend"). |
| `--t-body` | 0.8125rem (13px) / 400 | Body, list titles, amounts. |
| `--t-caption` | 0.75rem (12px) / 300 | Nav labels, helper text, "More Goals >". |

**Line-height tokens:** `--lh-body: 1.5` for multi-line body/paragraph text; `--lh-tight: 1.2`
for headings and single-line labels (titles, balance, nav). Use the tokens - don't set raw
line-heights. Avoid weights below Light for body text on small screens (legibility).

---

## 4. Spacing, layout & shape

### 4.1 Spacing scale (4px base)
`--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`,
`--space-5: 20px`, `--space-6: 24px`, `--space-8: 32px`.
> Figma used some odd values (18, 31). Standardise: **screen gutter = 24px**
> (`--space-6`), **card padding = 20px** (`--space-5`). Keep these consistent - the Figma is
> inconsistent here and should be normalised in build.

### 4.2 Layout frame
- Mobile artboard: **412 × 917** (Android reference). Design fluid, not fixed - must adapt to
  iOS safe areas and varying heights.
- **Header:** 80px tall. Leading slot = back affordance on pushed screens (else empty); centre-left
  = wordmark (Home) or screen title (sub-screens); trailing = settings icon, shown only on the
  bottom-nav tabs. The screen name lives **only** here - screens never render an in-body title.
- **Bottom nav:** 80px tall, surface `--c-surface`, 4 tabs.
- Reserve OS safe-area insets (notch / home indicator) via env() padding.

### 4.3 Radius
`--radius-sm: 5px` (chips, chart bars) · `--radius-button: 14px` (action buttons - slightly
rounded, **not** a full pill; the shared `Button` uses this) · `--radius-md: 10px` (section cards) ·
`--radius-lg: 20px` (hero balance card) · `--radius-pill: 999px` (progress track, toggles,
FAB).

### 4.4 Elevation
- `--elev-card: 5px 5px 0px 0px rgba(255,203,203,0.29)` - the signature offset pink shadow
  (hero card).
- `--elev-float: 0 6px 16px rgba(0,0,0,0.12)` - FAB / FabMenu / confirm dialog (added; Figma had none).

### 4.5 Overlay & stacking
- `--c-scrim: rgba(0,0,0,0.40)` - confirm-dialog backdrop dim.
- `--backdrop-blur: 6px` - confirm-dialog backdrop blur (`backdrop-filter: blur(var(--backdrop-blur))`),
  so the screen behind the dialog is legibly de-emphasised without going fully opaque.
- **Z-index scale** (only these layers float; everything else is in flow):
  `--z-dropdown: 20` (SelectField listbox) · `--z-fab-menu: 900` (the Expenses FabMenu, between
  `--z-dropdown` and `--z-modal`) · `--z-modal: 1000` (confirm-dialog scrim + dialog) ·
  `--z-modal-nested: 1010` (a dialog layered over another - reserved for a ConfirmDialog raised over
  an open overlay).
- **Scrollbars are hidden app-wide** (native-app feel - it's an app, not a website): content still
  scrolls, but no scrollbar track is drawn, on every scroll container (page, dropdown, the confirm
  dialog body). On a **form page**, `SelectField` sits inline and its listbox overlays normally
  (`--z-dropdown`); forms are full-screen pages now, so there is no dialog to expand in-flow.
  - **Exception - preserve a scroll affordance in long lists.** Where positional awareness matters
    (Import dedup-review list, Analytics, any list taller than one viewport) keep a visible scroll
    indicator so the user knows there's more and where they are (ui-ux §2.10). Hiding the scrollbar
    is for chrome/short containers, not for long scannable data.

---

## 5. Iconography

**Icon library: [`@lucide/angular`](https://lucide.dev/guide/angular) - the single, mandatory
source for ALL icons in the app.** Lucide is single-weight outline line icons (exactly the style
this system wants), MIT-licensed, and ships each icon as a tree-shakable standalone Angular
component that renders an **inline SVG** - bundled in the JS, **no CDN, no icon font, no network
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
- **Sizes:** nav icons **22-24px**, inline/action icons **24px**, larger feature glyphs up to
  **32px**. Tokens: `--icon-size-sm` (24), `--icon-size-md` (32). Stroke width **1.75**.
- Icons inherit `currentColor`. **Active** nav icon + label use `--c-primary-700` (the
  AA-accessible coral on white); **inactive** use `--c-text-muted`. Never rely on colour alone -
  pair an icon with a text label or sign.

### Accessibility
- Every standalone/interactive icon needs an accessible name (`aria-label` / `title`); decorative
  icons paired with visible text use `aria-hidden="true"`.
- Keep tap targets ≥ `--tap-target-min` (**48px** - Android v1 primary target; ≥ the WCAG 2.2
  SC 2.5.8 24px floor and the iOS 44pt minimum) even when the glyph is smaller.

### Common mappings (extend as needed)
Home `house` · Expenses `wallet` · Goals `target` · Analytics `pie-chart` · Settings `settings` ·
Add `plus` · Scan receipt `scan-line` · Import `file-down` · Over-budget/alert `triangle-alert` ·
Success `circle-check` · Duplicate/review `copy` · Transaction direction (income) `arrow-up` ·
Transaction direction (expense) `arrow-down`.

---

## 6. Motion
Subtle and fast (supports the <800ms-feel goal; nothing that delays first paint). This is the
canonical motion spec; `.claude/rules/design.md → Motion` enforces it for new work.

### 6.1 Principles
- Subtle and quick - motion confirms a change, it never gates interaction.
- No skeleton-blocking animation on cold start - show content progressively.
- Always honour `prefers-reduced-motion` (see §6.5).

### 6.2 Motion tokens
Pull durations/easing from `src/styles/_tokens.scss` (mirrored in `design-tokens.json`); never
hardcode a duration or easing:
- `--motion-fast: 150ms` - taps, toggles, chip/press, scrim fade.
- `--motion-standard: 200ms` - page/list entrance, modal dialog.
- `--motion-slow: 300ms` - progress-bar fill, skeleton pulse cycle.
- `--easing: cubic-bezier(0.2, 0, 0, 1)` - the single ease-out curve for everything.

### 6.3 Keyframe and class library
The one source is `src/styles/_animations.scss` (`@use`d globally); reuse these, don't author
ad-hoc keyframes in a component:
- `fade-in`, `fade-in-up`, `scrim-in`, `modal-enter`, `skeleton-pulse`, `spin`.
- `.list-item-enter` (the only enter-class) for items entering a list.

### 6.4 Per-surface mapping
- **Page transitions** - automatic via the app shell (`src/app/app.scss` `router-outlet + *`,
  `fade-in`). Screens add nothing per page. **Form pages** are routed pages, so they get this
  automatic page-transition - no per-page motion.
- **List rows** - `animate.enter="list-item-enter"` (Angular 20 native CSS hook), with a capped
  stagger: `[style.animation-delay]="(i < 12 ? i * 40 : 0) + 'ms'"` (40ms steps, no delay past 12
  rows so long lists don't drag).
- **Confirm dialog** - `app-modal` (the ConfirmDialog substrate) applies `scrim-in`
  (`--motion-fast`) + `modal-enter` (`--motion-standard`) itself; ConfirmDialog gets it for free.
- **Skeletons / spinners** - `.anim-skeleton-pulse` / `.anim-spin` (infinite, cancelled under reduce).
- **Progress** - animate `width` with `transition: width var(--motion-slow) var(--easing)`
  (e.g. GoalProgressRow fills from 0 on mount).

### 6.5 Reduced-motion contract
The motion tokens are zeroed under `@media (prefers-reduced-motion: reduce)` in `_tokens.scss`, so
token-driven motion stops with no extra work; `_animations.scss` additionally cancels the
infinite/movement keyframes. Any new animation must be token-driven (so it inherits this) or add its
own reduce guard.

> Note: most Android **emulators** report `prefers-reduced-motion: reduce` because
> `animator_duration_scale` defaults to 0 - so motion looks instant there. Set it to 1
> (`adb shell settings put global animator_duration_scale 1.0`) or test on a real device to see it.

---

## 7. Component library

Each component lists its origin (Figma node or "new" if required by FRs but absent in Figma)
and the tokens it consumes. Components are dumb/presentational (`shared/`) unless noted.

> **Built so far** (`src/app/shared/ui/`): AppHeader, BottomNav, EmptyState, Button (primary /
> ghost / **danger** variants, slightly rounded via `--radius-button`), Card, FormField, IconButton,
> Banner, ListRow (with optional `[lead]` slot), SelectField, Skeleton, Spinner,
> **Modal** (ConfirmDialog substrate only), **ConfirmDialog**, **FabMenu**, **GoalProgressRow**,
> **FormActions** (bottom Save bar), **BalanceCard**, **ActionTile**, **SettingsRow**,
> **EnvelopeCard**, **AllowanceRow**, **AllowanceSummaryCard**, **NavDrawer** (secondary-destination
> navigation sheet, ADR 0013), **PrivacyNote** (`app-privacy-note`, static persistent
> trust/reassurance note - not a live region, unlike the transient Banner).
> Reuse/extend these rather than re-inlining markup - see the `ui-component`
> skill. The remaining entries below are still to be built as they're needed.

### Present in Figma

#### Chrome and navigation
- **AppHeader** - leading back affordance (pushed screens) + title/wordmark + trailing icon.
  Variants: brand (home, `--t-wordmark`) / titled (sub-screens, `--t-screen-title`). It is the
  **only** place a screen name appears - no in-body screen titles. Driven by the active route's
  `data.title` / `data.back`; the trailing settings icon shows only when there is no back affordance
  (i.e. the bottom-nav tabs).
- **BottomNav** - 4 tabs. **Canonical tabs: Home · Expenses · Goals · Analytics.**
  Note: Figma inconsistently labels the 4th tab "Charts" on some screens and "Analytics" on
  others, and tab x-positions drift between screens - **normalise to evenly-spaced flexbox
  and one label ("Analytics")**.
  The active tab comes from `NavTabService` (`core/layout/nav-tab.service.ts`), **not** from
  `routerLinkActive`. URL-prefix matching alone lit no tab at all on the routes outside the four tab
  prefixes (`/settings/**`, `/budgets/**`, `/allowances/**`, `/import/**`), so a pushed screen looked
  like it had lost its place. Resolution order: the route's `data.tab` override, else the URL's first
  segment when it is a tab root, else that area's owner (`settings`/`budgets`/`allowances` -> Home,
  `import` -> Expenses), else nothing (correct for the chromeless lock screens). The back arrow is
  unaffected and stays history-based (`Location.back()`, ADR 0004); for "return to where I came
  from" after a save, see `core/navigation/origin.ts`.
#### Home and data surfaces
- **BalanceCard** (`app-balance-card`, **built**) - the Home hero, and a **self-contained** one.
  `--c-primary-40` fill, `--radius-lg`, `--elev-card` (the signature offset pink shadow). Renders an
  optional money figure (`--t-balance`, via the money pipe) when one is supplied; otherwise an honest
  caption. Also takes a **`note`** (the plain-language explainer for the figure, e.g. what it already
  sets aside) and projects a **`[footer]` slot** for the compact secondary figures (Spent this month /
  Total balance), separated by a hairline in `--c-on-primary-rule`; the footer collapses via `:empty`
  when nothing is projected. Hierarchy is one step per level - uppercase caption label -> figure ->
  note -> rule -> footer stats - so nothing competes with the headline. The note and footer live INSIDE
  the card deliberately: they used to sit under it as loose muted text and separate stat cards of
  competing weight, which left the hero a flat slab trailing debris. Display-only.
- **ActionTile** (`app-action-tile`, **built**) - labelled Home quick-action tile, `--c-primary-05`,
  `--radius-button`, Lucide icon + caption (the old-MCB-Juice Home grid; labelled tiles only, never
  icon-only). Real actions: *Add expense* (-> `/expenses/new`), *Scan receipt* (-> `/import`),
  *Add goal* (-> `/goals/new`).
- **GoalProgressRow** (`app-goal-progress-row`, **built**) - label, pill progress track with knob,
  `current / target` amounts (via the money pipe). Track `--c-primary-10`, fill + knob
  `--c-primary`; fill animates from 0 on mount (`--motion-slow`, reduced-motion honoured).
  **Completed** state: full `--c-positive` track (knob hidden), trailing check icon, strikethrough
  title/amounts - completion is shown by icon + text, never colour alone (a11y). Display-only
  (progress derived from the saved amount); the whole row is a button that emits `edit`.
- **TrendChart** - bar series + line overlay, "Usable Balance Trend". Bars `--c-primary`,
  `--radius-sm` top. **Implement with bundled Chart.js (canvas)**, not static images.
- **TransactionListItem** - leading **monogram avatar** (via `ListRow`'s `[lead]` slot), title, date,
  trailing signed amount (`+ Rs 500`). Sign coloured: income `--c-positive`, expense
  `--c-danger-700`/`--c-text`. Income rows use the positive tint on the avatar **paired with the signed
  amount** - never colour alone.
#### Actions and toggles
- **SegmentedToggle** - two visual treatments behind one behaviour and one a11y contract (a
  `radiogroup` of `radio`s, arrow-key navigable, roving tabindex):
  - `layout="pill"` (**default**) - Daily/Weekly/Monthly and Ongoing/Completed. Pill, active segment
    `--c-primary-700` (white-on-coral clears AA; the lighter `--c-primary` failed it - see §2.3).
    Use for **filters and mode switches**: what you are looking at. Segment labels never wrap.
  - `layout="list"` - full-width stacked rows at `--radius-md`, each with an optional plain-language
    `hint` line and a filled/hollow circle glyph marking the selection (shape + tint + `aria-checked`,
    never colour alone). Use for a **form answer**, above all one that reveals or hides other fields.
    Rationale: GOV.UK builds its conditionally-revealed-question pattern on stacked radios and warns
    against revealing follow-ups from inline side-by-side options; Material 3 recommends vertically
    listed radios for a single choice of <= 5 and advises against horizontal radio lists. The rows
    also fit a hint, which the pill cannot - and that serves low-financial-literacy users
    (`financial-knowledge.md` §9). Applied to the Allowance form's **Kind** and **Period**.
  - Choose by asking "is this an answer I am saving, or a view I am switching?" Do not flip the
    default: the filters are textbook-correct as pills.
- **FAB** - 60px coral circle, `+` icon, `--elev-float`. Goals uses a simple single-action FAB
  (-> `/goals/new`); Expenses uses the **FabMenu** below instead. The **host list must reserve
  bottom space** so the FAB/FabMenu never occludes the last row: `padding-bottom` ≥
  `--layout-fab-size + --space-6` (≈84px). Without it the final transaction/goal hides behind the
  button (ui-ux §2.10). See `screens.md` §4.1, §5.1.
- **FabMenu** (`app-fab-menu`, `src/app/shared/ui/fab-menu/`) - the quick-add on **Home and
  Expenses**: a **tap**-to-open FAB that reveals **labelled** items, replacing the old
  undiscoverable long-press FAB. Floats at `--z-fab-menu` (between `--z-dropdown` and `--z-modal`),
  `--elev-float`. Each item is a labelled Lucide icon + text (never icon-only); closes on item tap,
  Escape, or outside tap. Items are supplied by the host, so the two menus differ:
  - **Expenses** - *Add expense*, *Add income*, *Scan receipt* (-> `/import`).
  - **Home** - the same three plus *Add allowance* (-> `/allowances/new`) and *Add budget*
    (-> `/budgets/new`), which are otherwise reachable only by digging through Settings. The
    allowance/budget items reuse the glyphs their Settings rows use (`lucideHandCoins` /
    `lucidePiggyBank`) so the same destination looks the same everywhere.
  - *Add expense* / *Add income* deep-link past the kind chooser (`/expenses/new/expense`,
    `/expenses/new/income`) - picking the labelled item **is** that decision (ADR 0004).
  - The menu **yields to a teaching empty state**: while an empty state's CTA is on screen the
    FabMenu is not rendered, so only one add affordance shows at a time.
  - Home keeps its labelled quick-action **tile grid** as well: the tiles are the discoverable,
    read-while-scrolling entry point, the FAB is the thumb-zone shortcut.
#### Forms and overlays
- **Form page** (pattern, not a single component) - **every add/edit form is a full-screen routed
  page**, not a modal: a pair of lazy routes `<area>/new` and `<area>/:id/edit` with route data
  `{ title, back: true, hideNav: true }`. The page renders a normal `<form>` in `.app-content`
  (extended by `var(--keyboard-inset)` so bottom fields clear the keyboard, and reserving bottom
  padding so the last field clears the Save bar). The header back arrow is *Cancel*; the primary
  *Save* lives in a **fixed bottom action bar** (`FormActions`, below) that lifts with
  `--keyboard-inset` so the Android soft keyboard never hides it. On the **edit** page the
  destructive action is a **danger icon-button at the top-right of the header** (via
  `HeaderActionService`, which carries an optional `icon: 'trash' | 'archive'`) - **Delete**
  (Transaction, Goal, Rule) or **Archive** (Account, Category) - opening a ConfirmDialog; Recurring
  has no delete. `transaction-form` is the canonical example. Page entrance uses the automatic route
  page-transition (no per-page motion). This bottom-Save / header-Delete placement supersedes the
  earlier Save-in-the-header pattern - see `screens.md` §8.0 and ADR 0003 (form action placement),
  which supersedes `docs/adr/0002-page-based-forms-no-modals.md` on this point.
- **FormActions** (`app-form-actions`, **built**) - the fixed **bottom action bar** that hosts a
  form page's primary *Save* (and any secondary action). Pinned to the bottom of the form page and
  lifted by `var(--keyboard-inset)` so it stays above the Android soft keyboard; the page reserves
  matching bottom padding so the last field clears it. Replaces the retired Save-in-the-header
  approach (ADR 0003). Buttons use the shared `Button` (slightly rounded via `--radius-button`).
- **Modal** (`app-modal`) - the small centred confirm/alert **substrate for ConfirmDialog only** -
  **not** a form container. Content-sized card (`--radius-lg`, `--elev-float`, `max-width 420px`) over
  a dimmed + blurred scrim (`--c-scrim` + `--backdrop-blur`, `--z-modal`); sizes to its content
  rather than `max-height 90vh`. Takes a role input (so ConfirmDialog can set `role="alertdialog"`)
  and a `describedById` (wiring the message via `aria-describedby`). Behaviour: `aria-modal`, labelled
  by its title, focus trap + restore, body scroll-lock, dismiss on Escape / backdrop-click
  (suppressed while `busy`), enter animation `scrim-in` + `modal-enter` (reduced-motion honoured).
  **Retired as a form container** - do not use `app-modal` for forms (forms are pages, see above).
- **ConfirmDialog** (`app-confirm-dialog`) - the **only centred dialog in the app**: a small,
  content-sized centred dialog built on `app-modal`, with `role="alertdialog"` and its message wired via
  `aria-describedby`. Two-button (title, message, danger confirm + ghost cancel). Used before delete /
  archive / restore-replace / over-budget acknowledgement (§8.2). Emits `confirm` / `cancelled`.
- **NavDrawer** (`app-nav-drawer`, **built**) - the navigation sheet for the app's **secondary**
  destinations (ADR 0013), opened by a leading hamburger in the header on top-level tabs only (a screen
  with Back keeps Back in that slot). Slides in from the leading edge over a dimmed + blurred scrim
  (`--c-scrim` + `--backdrop-blur`, `--z-drawer`, between the FabMenu and `--z-modal` so a
  ConfirmDialog still layers over it). Width is `--layout-drawer-w` (screen width minus 56px, capped at
  280px - Material's phone modal-drawer rule), leaving a strip of page visible so it reads as a sheet,
  not a page. Rows are `--tap-target-min` tall with icon + label + hint; the current destination gets
  `aria-current="page"` plus a heavier label, never a tint alone. Behaviour matches `app-modal`
  (`role="dialog"` + `aria-modal`, focus trap + restore, body scroll-lock, dismiss on Escape / scrim);
  any navigation closes it, which also covers Android hardware Back. Enter animation `drawer-in` +
  `scrim-in`; under reduced motion it cross-fades in place instead of sliding. Contents come from
  `core/layout/nav-destinations.ts` (shared with the Settings list) and **exclude the four BottomNav
  tabs** on purpose. It is a navigation surface only - never a form or content host.
#### Lists, inputs and empty states
- **EmptyState** - centred illustration + message + CTA ("No goals? Create one!",
  "Tap the Button below…", "No Data").
- **TextField (underline)** - income/type inputs: label, value, bottom rule. For amounts use
  a numeric keypad.
- **ListRow** (`app-list-row`, **built**) - generic list row (title, optional subtitle/meta, trailing
  slot). Gained an optional **`[lead]` slot** for a leading avatar/monogram (used by
  TransactionListItem for the per-row monogram avatar).
- **SettingsRow** (`app-settings-row`, **built**) - a Settings list row: leading Lucide icon + label
  + optional hint + a trailing chevron or inline control. Used to build the grouped Settings screen
  (Your money / General / Security - see `screens.md` §7.1). Display/presentational; the feature
  feeds it data and handles the tap.
  A **wide trailing control wraps onto its own line** (`flex-wrap` on the host, `min-width: 12rem` on
  the text column, `margin-left: auto` on the trailing slot). Without this, a row pairing a hint with
  a `SelectField` (Base currency, Auto-lock, Duplicate detection) squeezed the label and hint into a
  one-word-per-line column with the control overlapping them.
- **EnvelopeCard** (`app-envelope-card`, **built**, FR-3.1) - category name, cap/spent amounts (via
  the money pipe) and an 8px (`--progress-track-h`) pill track. Three Rust-computed states: **under**
  (`--c-positive` fill, no icon - nothing to flag), **approaching** (`--c-warning` fill +
  `lucideTriangleAlert` + "Rs X left"), **over** (`--c-danger` fill + icon + "Rs Y over"). Meaning is
  never colour-alone - approaching/over always pair the fill with the icon + a plain-language label.
  Next to the category name sits a **status tag in words** ("on track" / "getting close" / "over"),
  tinted to match the fill; the **percent figure moves to the right of the amounts row**, so the head
  carries the state and the amounts row carries the numbers. The **over** state additionally tints the
  whole card (`--c-danger-soft` + a danger-tinted border) so the state reads as tone and shape, not
  only as a bar colour - a third reinforcement, never the sole cue.
  The bar visually clamps at 100% width even when over (the label/percent carry "how much over", not
  an overflowing bar) - phrased as information, not punitively (see "Over-budget is gentle" below).
  Display-only; the whole card is a button that emits `open` (the Budgets screen navigates to the
  budget's edit page).
- **AllowanceRow** (`app-allowance-row`, **built**, FR-3.4) - name + a cadence badge
  (Weekly/Monthly/One-time), an 8px (`--progress-track-h`) balance-of-target pill track
  (`--c-positive` fill, clamped 0-100), and a plain-language status line. The normal/underfunded
  cases read as information ("Fully set aside for this period" / "Tops back up to your weekly or
  monthly amount" / "Set aside to spend" for one-time - no icon, nothing alarming). **Over-allowance**
  and **paused** are icon + label, never colour alone - `lucideTriangleAlert` + "Rs X over" for a
  negative balance, `lucidePause` + "Paused - not set aside right now" for an inactive allowance
  (mirrors EnvelopeCard's icon-plus-label convention). Display-only; the whole row is a button that
  emits `open` (the Allowances screen navigates to the allowance's edit page). The over-allowance
  status line intentionally uses the gentler amber `--c-warning-700` tone rather than the danger tone
  EnvelopeCard uses when over budget, because an allowance self-heals at its next refresh (the
  imprest model tops it back up), so going over is a lower-stakes, temporary state than an over-budget
  category.
- **AllowanceSummaryCard** (`app-allowance-summary-card`, **built**, FR-3.4) - Home's allowances card:
  a title row (`lucideHandCoins` + chevron), a "Rs X used of Rs Y" figure pair, an 8px
  (`--progress-track-h`) used-of-set-aside pill track (`--c-positive` fill, clamped 0-100), and a
  plain-language line ("Rs X left across N allowances"). **Over** is gentle and icon + label, never
  colour alone: `lucideTriangleAlert` + "Rs X over what you set aside" with the fill switching to
  `--c-warning` (the same lower-stakes amber AllowanceRow uses, for the same self-healing reason).
  Both figures come from Rust (`AllowanceSummary.usedMinor` / `.targetTotalMinor`) - the component only
  formats and clamps geometry. Replaces the loose "Rs X set aside across your allowances" sentence that
  used to trail the Home hero. The whole card is a button emitting `open` (Home navigates to
  `/allowances`).

### New - required by FRs, absent in Figma (specified here, to design)
- **LockScreen** - biometric prompt + passphrase fallback (FR-5.1). App entry gate.
- **ReceiptScanSheet** - camera/preview → OCR progress → **editable extracted fields**
  (merchant/date/total) for confirmation (FR-2.1).
- **ImportWizard** - file picker → column mapping (CSV) → rule preview → **dedup review list**
  → confirm (FR-2.2/2.3/2.4).
- **SplitEditor** - add/remove split rows; live "remaining to allocate" that must reach 0
  (FR-1.2).
- **CurrencyField** - amount + currency selector + user-entered FX rate + computed base
  amount (FR-1.4).
- **RecurringRuleForm** - template + schedule picker (FR-1.3).
- **RuleBuilderRow** - "If [field] [op] [value] → set [field] [value]" (FR-2.3).
- **SettingsList + BackupRestorePanel** - base currency, lock timeout, export, encrypted
  backup/restore (FR-4.x, FR-5.2).
- **Banner/Toast** - success/warning/error feedback (semantic colours). Background is the tone's
  soft tint (`--c-*-soft`); foreground (icon + text) uses the tone's accessible `-700` variant
  (`--c-warning-700`, `--c-danger-700`, `--c-positive-700`, `--c-info-700`), never the base hue, so
  both clear AA on the tint.

---

## 8. Currency & number formatting
- Default currency **MUR**, symbol **"Rs"**, format `Rs 1,234` (no decimals shown when whole;
  2 decimals otherwise). Formatting is done by a shared Angular pipe from **integer minor
  units** received from Rust - never computed in TS.
- Multi-currency rows show original amount + `(≈ Rs … )` base conversion (FR-1.4).
- Negative/expense amounts and positive/income amounts are visually distinguished by colour +
  sign, not colour alone (accessibility).
