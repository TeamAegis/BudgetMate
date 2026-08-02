# 13. A navigation drawer for secondary destinations

Date: 2026-07-30

Status: Accepted. Amends `.claude/rules/design.md` ("ConfirmDialog is the only overlay in the app")
and the components section of `docs/design/design-system.md` §7.

## Context

Seven money-setup and data destinations - Allowances, Budgets, Accounts, Categories, Recurring,
Rules, Import (plus Export and Backup) - had no navigation home. They were reachable only by opening
Settings from the Home header gear and scrolling a long list of rows. Two of them, Allowances and
Budgets, are recurring-use features, not one-time preferences.

That placement is wrong twice over:

- **Wrong room.** Settings is where people look for *preferences* (currency, auto-lock), not for a
  feature they use weekly. Putting a feature there makes it feel optional and administrative.
- **Not discoverable.** Nielsen Norman Group measure roughly a 21% drop in task completion for
  destinations a user cannot see. Two mitigations already existed - the Home FabMenu's *Add
  allowance* / *Add budget* items (ADR 0005 era) and a one-line "Rs X set aside across your
  allowances" sentence on Home - and both are add-actions or trivia, not a way to *navigate* to the
  feature.

The BottomNav cannot absorb them. Its four tabs (Home, Expenses, Goals, Analytics) are a fixed
canonical label set, and the documented sweet spot for a bottom bar is 3-5 primary destinations;
pushing it to eleven would shrink tap targets below the 44px floor and truncate labels on a 360dp
screen.

The same research that condemns hidden navigation names the pairing that resolves this: a bottom bar
for the 3-5 primary sections **plus** a drawer for secondary items. The discoverability finding
argues against hiding *primary* destinations, which is precisely why this drawer does not contain
any of the four tabs.

## Decision

Add a **modal navigation drawer** (`shared/ui/nav-drawer`), opened by a leading hamburger button in
the app header on top-level tabs, listing the secondary destinations in two groups ("Your money",
"General"). The four primary tabs are deliberately absent.

- **Geometry** follows Material's modal-drawer rule for phones: width is the screen width minus 56px
  capped at 280px (`--layout-drawer-w`), so a strip of the dimmed page stays visible and the sheet
  never reads as a full page. Rows are `--tap-target-min` tall.
- **One source of truth for the contents.** Both the drawer and the Settings list render from
  `core/layout/nav-destinations.ts`, so a new destination cannot land in one surface and be forgotten
  in the other.
- **The leading slot belongs to Back first.** The hamburger renders only when the route has no back
  affordance, so a pushed screen or form page never trades Back for a menu.
- **Dialog behaviour** matches `app-modal`: focus trap, focus restore to the trigger, body scroll
  lock, Escape and scrim dismiss, `role="dialog"` + `aria-modal`. Existence is open (the shell
  renders the component only while open), which is what hangs that behaviour off the lifecycle.
- **Any navigation closes it**, which also covers Android's hardware Back popping history without the
  drawer knowing.
- The current destination carries `aria-current="page"` and a heavier label weight, not only a tint.

The rows stay in Settings as well. Being in Settings was never the defect - being *only* in Settings
was.

## Consequences

- `.claude/rules/design.md`'s "ConfirmDialog is the only overlay in the app" no longer holds. The
  rule's intent - no centred modal is ever a form container, and forms are routed pages (ADR 0002 /
  0003) - is untouched: this is a navigation sheet, not a form host, and ConfirmDialog remains the
  only *centred dialog*. The rule is restated accordingly.
- A new z-layer, `--z-drawer` (950), sits above the page, BottomNav, and FabMenu, and below
  `--z-modal` so a ConfirmDialog can still layer over it.
- The Home allowance sentence is replaced by a real card with usage progress
  (`shared/ui/allowance-summary-card`), which needed two new Rust-derived figures on
  `AllowanceSummary` (`targetTotalMinor`, `usedMinor`) so no caller does money math in TS.
- Two navigation surfaces now exist for the same destinations. The shared list keeps them honest, but
  a future destination must be added there, not inline in a template.

## Alternatives considered

- **A fifth bottom-nav tab for Allowances.** Rejected: it breaks the canonical four-tab label set,
  crowds five labels into ~360dp, and solves the problem for exactly one of the seven buried
  destinations.
- **Leave them in Settings and lean on the FabMenu.** Rejected: the FabMenu offers *add* actions, not
  navigation, so there is still no way to go and look at your allowances.
- **Promote the destinations onto Home as cards.** Rejected as the general answer - it does not scale
  to nine destinations and would bury the actual dashboard. Adopted for Allowances specifically,
  where the usage figure is genuinely dashboard content.
