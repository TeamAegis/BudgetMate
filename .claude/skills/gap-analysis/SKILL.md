---
name: gap-analysis
description: Find gaps between the intended scope (a functional requirement, GitHub issue, or feature area) and the actual code. Use before picking up work or when auditing whether a feature area is really complete and on-spec. Delegates to the gap-analyst role; read-only (reports, never edits).
context: fork
agent: gap-analyst
disable-model-invocation: true
arguments: [target]
---

# Gap analysis: intended scope vs. code

Audit **$1** (an FR id like `FR-2.2`, a GitHub issue number, or a feature area like `import` /
`goals` / `budgets`) and report where the implementation diverges from what was intended.

> Delegation: this skill forks into the **`gap-analyst`** subagent. If `context: fork` is not honored
> by this build, spawn it explicitly with the Agent tool (`subagent_type: gap-analyst`) and pass this
> same instruction. The analyst is **read-only** - it produces findings, it does not fix them.

## Procedure
1. **Resolve the target `$1`** and gather its intended behaviour from the sources of truth:
   - `docs/functional-requirements.md` (the FR text), `docs/architecture.md` (module/invariant
     intent), `docs/design/{screens,ux-blueprint,design-system}.md` (UI states/components/flows).
   - If it's an issue: `gh issue view $1` (note `gh` may be unauthenticated - fall back to docs/code).
2. **Trace the implementation** across the stack: Rust command + domain + db (`src-tauri/src/...`),
   bridge wrapper + model (`src/app/core/...`), feature component (`src/app/features/...`).
3. **Classify** each requirement: **Done / Partial / Missing / Divergent**, each with `file:line`
   evidence.
4. **Check invariants** specifically: float money, logic in TS instead of Rust, IPC bypassing
   `core/bridge`, non-transactional multi-writes, missing required UI states, any network/telemetry,
   recurrence via scheduler instead of lazy materialisation.

## Output
A prioritized list: **Requirement → Status → Evidence (`file:line`) → Gap → Priority → Suggested
follow-up** (which role/skill: `fullstack-engineer`+`new-feature`, `new-screen`, `bug-hunter`, …).
Lead with high-priority gaps.

## Anti-patterns
- Don't fix anything - this is analysis only. Hand actionable gaps to the implementer.
- Don't assume "file exists" = "requirement met"; verify behaviour against the FR/design.
- Don't trust a recalled fact - confirm the file/symbol still exists before calling it a gap.

## References
`docs/functional-requirements.md`, `docs/architecture.md`, `docs/design/*`,
`.claude/rules/{rust,frontend,design,database}.md`. Pair the follow-up with **`doc-align`** when a gap
turns out to be a stale doc rather than missing code.
