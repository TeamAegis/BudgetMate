---
name: design-check
description: Validate a screen, component, or UX blueprint for UI/UX soundness AND accessibility/design-system conformance against the principles knowledge base (docs/design/ui-ux-principles.md) and the project design law. Use to confirm a layout respects the UX laws, thumb-zone reach, the five states, contrast/tap-targets/labels, design tokens, Lucide icons and motion - and is usable by someone one-handed, low-vision, or using a screen reader. Delegates to the design-validator role; read-only (reports, never edits).
context: fork
agent: design-validator
disable-model-invocation: true
arguments: [target]
---

# Design check: is it principle-sound, accessible, and on-system?

Validate **$1** (a screen like `home` / `add-transaction`, a `shared/ui` component like
`app-balance-card`, an FR id like `FR-2.1`, or a blueprint doc/area like `ux-blueprint` / `analytics`)
on two axes: **UX soundness** (does every choice trace to a UX principle?) and **accessibility &
design-system conformance** (WCAG 2.2 AA + the project's tokens/icons/states/motion law).

> Delegation: this skill forks into the **`design-validator`** subagent. If `context: fork` is not
> honored by this build, spawn it explicitly with the Agent tool (`subagent_type: design-validator`)
> and pass this same instruction. The validator is **read-only** - it produces findings, it does not
> fix them.

## Procedure
1. **Resolve the target `$1`** and gather its intended design: `docs/design/ux-blueprint.md`
   (principles/IA/flows/states), `docs/design/design-system.md` (tokens/components), `docs/design/
   screens.md` (per-screen spec + FR ids), and the relevant sections of `docs/design/ui-ux-principles.md`
   (the heuristic truth - cite §x). For a **blueprint** target, audit the spec text itself.
2. **Trace what exists:** the feature component + template/SCSS (`src/app/features/...`), the
   presentational components (`src/app/shared/ui/...`), and tokens (`src/styles/_tokens.scss`).
3. **Lens 1 - UX soundness:** primary CTA/nav in the bottom-third thumb zone and visually distinct
   (§1.5, §3.1, Von Restorff); ≤5 primary destinations with progressive disclosure (Hick §1.4);
   one focal point + layer-cake scan (§1.3, §3.3); feedback ~100-400ms with skeletons not blocking
   spinners (Doherty §2.7); forms have top labels, right keyboard, inline human errors, never clear
   input (§2.9); motion purposeful + token-driven + reduced-motion (§2.11); **zero anti-patterns /
   dark patterns** (§4).
4. **Lens 2 - accessibility & conformance:** contrast ≥4.5:1 body / ≥3:1 large incl. the
   coral-on-white `--c-primary-700` rule (§2.4, `design.md`); never colour alone - pair sign/icon/label;
   targets ≥44-48px; icons have accessible names (`aria-label`/`aria-hidden`); **design tokens only**
   (no hardcoded hex/px/radii/durations), `@lucide/angular` icons only, money via the shared pipe,
   reuse `shared/ui/`, all bundled / no CDN (NFR-P4); all five states present (loading, teaching-empty,
   populated, error, busy) + any special state. Remember the **Android WebView caveat**: safe-area/
   keyboard via the `visualViewport` workaround, not native APIs (`.claude/rules/android.md`).

## Output
A prioritized list: **Item → Lens (ux / a11y-conformance) → Finding → Evidence (`file:line` or
`docs/design/ui-ux-principles.md` §x) → Severity → Suggested follow-up** (which role/skill:
`bug-hunter`, `fullstack-engineer`+`new-screen`/`ui-component`, `gap-analysis`, `doc-align`,
`finance-check`). Lead with high-severity findings.

## Anti-patterns
- Don't fix anything - this is validation only. Hand actionable findings to the implementer.
- Don't recommend out-of-scope features. `ui-ux-principles.md` is a principles reference, not a
  backlog - flag soundness/accessibility/consistency defects, not missing scope. A genuine v1 feature
  gap → hand to `gap-analysis`.
- Don't treat the guide's Material-3/Compose mechanics or its dp/sp numbers as literal - apply the
  transferable principle; **the BudgetMate token in `design-system.md` / `_tokens.scss` wins** on any
  concrete value (see that file's header note).
- Money-meaning, jargon, or finance copy is `finance-check`'s job - you cover presentation/layout/a11y.

## References
`docs/design/ui-ux-principles.md`, `docs/design/{ux-blueprint,design-system,screens}.md`,
`docs/design/README.md`, `src/styles/_tokens.scss`, `.claude/rules/{design,frontend,android}.md`.
Pair the follow-up with **`gap-analysis`** when a finding is really a missing feature, **`doc-align`**
when it's a stale doc rather than wrong code, or **`finance-check`** when it's about the numbers/jargon.
