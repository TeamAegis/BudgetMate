---
name: finance-check
description: Validate a feature, screen, or copy for financial correctness AND low-literacy usability against the domain knowledge base (docs/financial-knowledge.md). Use to confirm the money math, categorisation, budgeting and MUR formatting are valid, and that a person with limited or no financial literacy can actually understand and use it. Delegates to the finance-validator role; read-only (reports, never edits).
context: fork
agent: finance-validator
disable-model-invocation: true
arguments: [target]
---

# Finance check: is it money-correct and novice-usable?

Validate **$1** (an FR id like `FR-3.1`, a screen like `onboarding` / `add-transaction`, or a feature
area like `budgets` / `import` / `goals`) on two axes: **financial correctness** and **usability for a
person with limited or no financial literacy**.

> Delegation: this skill forks into the **`finance-validator`** subagent. If `context: fork` is not
> honored by this build, spawn it explicitly with the Agent tool (`subagent_type: finance-validator`)
> and pass this same instruction. The validator is **read-only** - it produces findings, it does not
> fix them.

## Procedure
1. **Resolve the target `$1`** and gather its intended behaviour: `docs/functional-requirements.md`
   (the FR text), `docs/design/{screens,ux-blueprint,design-system}.md` (states/components/copy), and
   the relevant sections of `docs/financial-knowledge.md` (the domain truth - cite §x).
2. **Trace what exists** across the stack: Rust money/rules/domain (`src-tauri/src/...`), the bridge
   model (`src/app/core/...`), the feature component and its user-facing copy
   (`src/app/features/...`, `shared/ui/`).
3. **Lens 1 - correctness:** money as minor units/`rust_decimal` (never float); base = `amount_minor ×
   fx_rate` and split-sum invariants; category taxonomy vs §2; envelope/budget math (FR-3.1); MUR
   formatting & multi-currency display vs §8; any tax/ratio/statutory figure matches §6/§7 **and is
   current** (figures are dated 2025/26); deterministic categorisation/dedup reasons are truly correct.
4. **Lens 2 - usability:** jargon avoided or explained for a novice; sensible beginner defaults
   (MUR, clear envelope setup, helpful empty/onboarding states); meaning never by colour alone; OCR
   (FR-2.1) and import (FR-2.2/2.3/2.4) end in a user-confirmation step that shows the deterministic
   reason and never auto-commit.

## Output
A prioritized list: **Item → Lens (correctness/usability) → Finding → Evidence (`file:line` or
`docs/financial-knowledge.md` §x) → Severity → Suggested follow-up** (which role/skill:
`bug-hunter`, `fullstack-engineer`+`new-screen`, `gap-analysis`, `doc-align`). Lead with
high-severity findings.

## Anti-patterns
- Don't fix anything - this is validation only. Hand actionable findings to the implementer.
- Don't recommend out-of-scope features (tax calculators, ratio dashboards, debt amortization,
  investing). `docs/financial-knowledge.md` is reference, not a backlog - flag clarity/correctness,
  not missing scope. A genuine v1 feature gap → hand to `gap-analysis`.
- Don't trust a statutory figure blindly - the Mauritius figures change annually; flag stale/baked-in
  figures rather than confirming them.

## References
`docs/financial-knowledge.md`, `docs/functional-requirements.md`, `docs/design/*`,
`.claude/rules/{design,frontend,database,rust}.md`. Pair the follow-up with **`gap-analysis`** when a
finding is really a missing feature, or **`doc-align`** when it's a stale doc rather than wrong code.
