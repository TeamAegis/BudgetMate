---
name: review-vault
description: Review a diff or area against BudgetMate's load-bearing invariants (minor-units money, IPC-through-bridge, three-file ACL, ACID writes, Rust async gotchas, zero-internet, design/a11y). Use before opening or merging a PR, or when auditing an area. Complements the generic built-in /code-review and /security-review with Vault-specific checks. Delegates to the code-reviewer role; read-only (reports, never edits).
context: fork
agent: code-reviewer
disable-model-invocation: true
arguments: [target]
---

# Review (Vault invariants): is the change correct and on-contract?

Review **$1** (a diff, a PR number, or a feature area like `import` / `goals` / `transactions`)
against the project's load-bearing invariants and code-level correctness. Defaults to the working diff
when `$1` is empty.

> Delegation: this skill forks into the **`code-reviewer`** subagent. If `context: fork` is not
> honored by this build, spawn it explicitly with the Agent tool (`subagent_type: code-reviewer`) and
> pass this same instruction. The reviewer is **read-only**; it produces findings, it does not fix
> them.
>
> This is not the generic built-in `/code-review` (bugs) or `/security-review` (security): it adds the
> Vault-specific invariants those do not know. Run them alongside it for broad coverage.

## Procedure
1. **Resolve the target `$1`**: a diff (default `git --no-pager diff main...HEAD`), a PR
   (`gh pr diff $1`, which may be unauthenticated; fall back to the local diff), or a named area.
2. **Read the changed files** plus the rules they touch
   (`.claude/rules/{type-safety,rust,frontend,database,tauri,android,design,engineering,style}.md`).
3. **Walk the checklist**: money (minor units, split-sum, base recompute, no TS math); IPC boundary
   (1:1 DTO mirror, bridge-only, three-file ACL, serialisable `AppError`); data integrity (ACID
   writes, forward-only migrations); privacy (no network/telemetry/CDN/INTERNET); Android/WebView
   (visualViewport, `@for` track, listener cleanup, 16KB alignment); Rust async gotchas (no Mutex
   across await, no blocking IO in async, non-pub commands, managed-state type); presentation surface
   (tokens, Lucide, no colour-only meaning); maintainability (thin commands, tests for new logic).
4. **Route depth** to the scoped validators: money meaning to `/finance-check`, UI/a11y to
   `/design-check`, doc drift to `/doc-align`.

## Output
A prioritized list: **Item -> Category -> Finding -> Evidence (`file:line`) -> Severity -> Suggested
follow-up** (which role/skill: `bug-hunter`, `fullstack-engineer`, `/finance-check`, `/design-check`,
`/doc-align`, `db-migration`). Lead with high-severity findings.

## Anti-patterns
- Don't fix anything; this is review only. Hand actionable findings to the implementer.
- Don't duplicate the generic bug/security pass; focus on the Vault invariants and structure.
- Don't redesign the feature or recommend out-of-scope work; review what changed.
- Don't trust a recalled fact; confirm the file/symbol still exists before flagging it.

## References
`.claude/rules/*`, `docs/architecture.md`. Hand off to `/finance-check` (money meaning),
`/design-check` (UI/a11y), `/doc-align` (stale docs), or `bug-hunter` (fix a found defect).
