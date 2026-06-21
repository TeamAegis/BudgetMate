# 0001 - IPC type safety: manual mirror + AppError + contract guard

- Status: Accepted
- Date: 2026-06-21
- Deciders: project maintainer

## Context
DTOs cross the Tauri IPC boundary between the Rust core and the Angular frontend. Today the Rust serde
structs (with `#[serde(rename_all = "camelCase")]`) are mirrored by hand into TypeScript interfaces in
`src/app/core/models/index.ts`, and the bridge wrappers in `src/app/core/bridge/tauri-bridge.ts` are
hand-typed. The mirror is correct but unguarded: a developer can change a Rust DTO and forget the TS
side, with no failure until runtime. Separately, every command returns `Result<T, String>`, so errors
are untyped across IPC even though `.claude/rules/rust.md` already prescribes a serialisable
`AppError` enum that was never implemented.

The product is strictly offline. Build-time codegen is allowed; runtime network is not. The Rust
release profile is size-optimised (`opt-level = "z"`, `lto`, `panic = "abort"`), so every added crate
and proc-macro is scrutinised.

## Decision
1. Implement the prescribed `AppError` (a `thiserror` + `serde::Serialize` tagged enum in
   `src-tauri/src/error.rs`); every command returns `Result<T, AppError>`. Mirror it as a
   discriminated union in `core/models` so the frontend can switch on the error kind.
2. Keep the hand-written, commented bridge and TS mirror as the contract.
3. Add a pure-Node CI contract guard in `scripts/guards.mjs` that fails on Rust-vs-TS DTO drift (field
   presence and optionality).
4. Record the rule in `.claude/rules/type-safety.md`.

Defer adopting `tauri-specta` (codegen of a typed `bindings.ts`).

## Consequences
- Drift is caught at CI time, not runtime, while the curated bridge keeps its money-invariant comments
  (signed amounts, decimal-string fx rates, desktop stubs) that codegen would erase.
- The guard is coarse by design (field presence and optionality, not deep type equality), so type-shape
  invariants remain human-owned.
- No new runtime or build dependency is added; the guard is dependency-free and offline.

## Alternatives considered
- **tauri-specta v2 (codegen):** generates a typed `bindings.ts` (typed invoke, events, error unions).
  Rejected for now because of the roughly 40-command migration, a new proc-macro dependency against the
  size budget, and the collision with the curated bridge and the "all IPC through core/bridge" boundary
  (eslint bans `@tauri-apps/api` outside `core/bridge`). It remains a strong future option.
- **ts-rs / typeshare:** generate types only, with no typed command wrappers; less benefit than specta
  for the same maintenance surface.

## Revisit trigger
Open a superseding ADR to adopt `tauri-specta` if the command count grows materially or mirror drift
repeatedly escapes the guard. If adopted, the generated `bindings.ts` must live under
`src/app/core/bridge/` to preserve the eslint boundary, and the contract guard is retired in its
favour.
