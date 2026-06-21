---
name: research-feature
description: Research how to build a new feature or pick a library/approach using the internet, filtered through BudgetMate's strictly-offline, no-network, on-device product promise. Use when scoping new work that needs an external option compared. Delegates to the feature-researcher role; read-only (recommends, never edits).
context: fork
agent: feature-researcher
disable-model-invocation: true
arguments: [question]
---

# Research a feature (offline-constrained)

Research **$1** and return sourced, decision-ready options - every one of which must fit
BudgetMate's hard promise: **no network, no cloud, no telemetry, fully on-device.**

> Delegation: this skill forks into the **`feature-researcher`** subagent (which has WebSearch /
> WebFetch). If `context: fork` is not honored, spawn it explicitly with the Agent tool
> (`subagent_type: feature-researcher`). The researcher is **read-only** - it recommends, it does not
> edit.

## Procedure
1. **Pin the question and constraints** (offline, Android-first, binary-size budget, licence). Ask
   1-2 clarifying questions only if scope is ambiguous.
2. **Search the web broadly**, then fetch the most authoritative/current sources (official docs,
   crate/library pages, primary articles). Record version + date.
3. **Apply the offline filter** to each candidate - **disqualify, with a reason, anything** needing
   network/cloud/an API key at runtime, phoning home, bundling telemetry, or pulling remote
   fonts/scripts/CDN assets. Prefer Rust crates for logic, bundled-local assets, on-device native
   APIs (Android ML Kit / Apple Vision).
4. **Cross-check the codebase** so recommendations fit the existing stack and `docs/architecture.md`.

## Output
**Question → Constraints → Options (each: what it is · offline-fit verdict · trade-offs · licence/size
· source link) → Recommendation + why → Next step / implementing skill** (`new-feature`,
`mobile-plugin`, `new-screen`). Cite sources inline.

## Anti-patterns
- Never recommend a network/cloud/telemetry-dependent solution "with caveats" - it's disqualified.
- Don't propose swapping core stack (Tauri/Angular/SQLCipher/`rust_decimal`) unless asked.
- Don't write code or edit files - this is research; implementation is a separate step.

## References
`docs/architecture.md` (stack, §10 size, §11 scope), `docs/functional-requirements.md`,
`.claude/rules/*`. For a heavier, fact-checked multi-source report, use the global **`deep-research`**
skill instead.
