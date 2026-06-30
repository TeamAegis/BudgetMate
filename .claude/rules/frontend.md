# Rules - Frontend (`src/`)

Applies to the Angular app. Read alongside root `CLAUDE.md`.

## Framework
- Angular 18+, **standalone components only** (no NgModules unless a dependency forces it).
- **CSR static build - never enable SSR / Angular Universal.** Tauri serves static files.
- Prefer **signals** for component state and **typed reactive forms** for input.
- Build output must land in `dist/vault/browser` with `baseHref: "/"` (the application/esbuild
  builder adds the `browser/` subfolder - `frontendDist` must point inside it or you get a blank
  window). The path is set in `CLAUDE.md` commands; keep them consistent.
- Use the new control flow (`@if` / `@for` / `@switch`), not `*ngIf` / `*ngFor`. **`@for` always
  needs a `track`** (e.g. `track tx.id`) - without it you get DOM churn / wrong-row bugs. Prefer
  `inject()` over constructor injection.

## Reactivity & change detection
- Target **zoneless** + `ChangeDetectionStrategy.OnPush`; drive the UI from signals.
- IPC results resolve **outside Angular's awareness** - update a signal in the `.then()`/event
  callback to re-render. **Never mutate an array/object signal in place** (`sig().push(x)` does
  nothing); replace the reference: `sig.set([...])` / `sig.update(a => [...a, x])`.
- `computed()` for derived state (pure, no writes); use `effect()` only to sync signal state to
  imperative APIs - **never** to derive one signal from another, and never read+write the same
  signal in one effect (infinite loop).
- Lazy-loaded heavy views (`import`, `reports`) may also use `@defer`; deferred deps must be
  standalone and not referenced outside the block (incl. `@ViewChild`) or they load eagerly.

## Boundaries (non-negotiable)
- **No business logic in TypeScript.** Money math, currency conversion, dedup, recurrence,
  categorisation, and validation of financial invariants all live in Rust. TS calls Rust and
  formats the result.
- **All IPC goes through `core/bridge`.** Add a typed wrapper there
  (`invoke<ReturnType>('cmd', args)`); feature code imports the wrapper, never `@tauri-apps/api`
  directly. This keeps the ACL auditable.
- Keep the Tauri command surface small - if a screen needs new data, prefer extending an
  existing Rust query over adding many fine-grained calls.

## Structure
- `core/` - bridge, models (mirror Rust DTOs 1:1), lock/unlock flow, guards.
- `features/<name>/` - one folder per feature area (transactions, budgets, goals, reports,
  import, settings). Smart components here.
- `shared/` - dumb/presentational components, money/date pipes, chart wrappers. Reusable UI
  components live in `shared/ui/` (one folder per component, `app-<name>` selector). **Reuse or
  extend these rather than re-inlining markup/SCSS in a feature** - see the `ui-component` skill.

## Performance
- Lazy-load `import` (OCR review) and `reports` (charts) routes; they must not block first
  paint (cold-start budget).
- Charts: import only the Chart.js controllers/elements used; never load Chart.js (or fonts)
  from a CDN.
- No source maps in production builds.

## Privacy
- No remote anything: no Google Fonts, no CDN scripts, no analytics, no external image hosts.
  Everything is bundled. CSP is strict.

## Money & display
- Receive money from Rust as minor units (+ currency); format with a shared pipe. Never do
  arithmetic on money in TS beyond what a formatter needs.

## When adding a feature
Follow the `new-feature` skill (`.claude/skills/new-feature/`). Always: add the Rust command +
DTO first, mirror the DTO in `core/models`, add a bridge wrapper, then build the component.

When building/changing any screen or presentational component, follow the `new-screen` skill
(`.claude/skills/new-screen/`) and `.claude/rules/design.md`: design tokens only, `@lucide/angular`
icons, the shared money pipe, and the five required states. Screen specs live in
`docs/design/screens.md`.

**Add/edit forms are full-screen pages, not modals.** Each is a pair of lazy routes `<area>/new` and
`<area>/:id/edit` with route data `{ title, back: true, hideNav: true }`; the back arrow is *Cancel*
and the primary *Save* lives in a **fixed bottom action bar** (`FormActions`, `app-form-actions`)
that lifts with `--keyboard-inset` so the Android soft keyboard never hides it. The **destructive**
action (Delete/Archive) is a danger icon-button at the top-right of the header, published via
`HeaderActionService` (`core/layout/header-action.service.ts`) with an optional
`icon: 'trash' | 'archive'` - not Save-in-the-header. Never a centred modal. `ConfirmDialog` is the
only overlay in the app. See `docs/design/screens.md` §8.0 and ADR 0003 (form action placement,
superseding `docs/adr/0002-page-based-forms-no-modals.md` on Save/Delete placement).

**Adding a transaction is a two-step flow before the form** (ADR 0004): a kind chooser
(`expenses/new`) then a per-kind category picker (`expenses/new/:kind`), both navigation lists with
no Save bar, then the entry form (`expenses/new/:kind/:categoryId`) which shows the chosen category
(a tappable context row) instead of a dropdown - the category carries the type, so Rust still
derives the sign and no new command is needed. Changing the category reopens the picker carrying the
in-progress entry in nav state (lossless). Transaction *edit* and all other forms stay single pages.
