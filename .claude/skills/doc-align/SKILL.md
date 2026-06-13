---
name: doc-align
description: Find where the documentation (architecture, functional requirements, design specs, rules, CLAUDE.md) has drifted from the actual code, and say which side is wrong. Use after behaviour changes or when auditing a doc for staleness. Delegates to the doc-alignment-reviewer role; read-only (reports reconciliations, never edits).
context: fork
agent: doc-alignment-reviewer
disable-model-invocation: true
arguments: [target]
---

# Doc ↔ code alignment review

Review **$1** (a doc path like `docs/architecture.md`, an area like `design` / `rust`, or `all`) and
report where the documentation no longer matches the code — and which side should change.

> Delegation: this skill forks into the **`doc-alignment-reviewer`** subagent. If `context: fork` is
> not honored, spawn it explicitly with the Agent tool (`subagent_type: doc-alignment-reviewer`). The
> reviewer is **read-only** — it proposes reconciliations; edits are a follow-up by you or the
> `fullstack-engineer`.

## Procedure
1. **Read the target doc(s)** alongside the code they describe:
   - `docs/architecture.md` → `src-tauri/src/` modules, `Cargo.toml`, `gen/android`.
   - `docs/functional-requirements.md` → implemented commands/components.
   - `docs/design/*` → `src/styles/_tokens.scss`, `src/app/shared/ui/`, feature components,
     BottomNav tabs, required states.
   - `.claude/rules/*` & `CLAUDE.md` → real commands, paths, pinned versions, skill references.
2. **Verify each substantive claim** against the code. Skip cosmetic wording; flag mismatches that
   would mislead a developer.
3. **Classify**: **stale-doc** (code right, doc wrong), **code-drift** (doc/intent right, code
   diverged), or **ambiguous**. Verify a named file/flag/version still exists before asserting drift.

## Output
Grouped by document: **Doc claim (path + quoted line) → Reality (`file:line`) → Verdict → Recommended
reconciliation** (the specific doc wording to change, or the code fix to make).

## Anti-patterns
- Don't edit docs or code — output a reconciliation list only.
- Don't report style/typos; report substantive, misleading deviations.
- Don't flag a deviation from memory — confirm against the current files first.

## References
All of `docs/`, `.claude/rules/`, `CLAUDE.md`. When a deviation is actually a missing feature rather
than a doc/code mismatch, hand it to **`gap-analysis`**; when the fix is a code change, hand it to the
**`fullstack-engineer`**.
