---
name: new-feature
description: Scaffold a new end-to-end feature in Vault the correct way - Rust command and DTO first, then mirror the DTO in Angular models, add a typed bridge wrapper, then build the standalone component. Use whenever adding any user-facing capability that needs data from the Rust core (e.g. a new report, a new transaction field, a new budget type).
---

# Adding a feature end-to-end

Vault's golden path is **Rust first, presentation last**. Logic lives in Rust; Angular formats
and presents. Follow this order every time.

## Step 1 — Rust domain + command (`src-tauri/src/`)
1. Add/extend the domain logic in `domain/` (money as minor units / `rust_decimal`; enforce
   invariants).
2. If it touches the DB, add the query/write in `db/` inside a transaction (see
   `.claude/rules/database.md`). For schema changes, use the `db-migration` skill.
3. Add a thin `#[tauri::command]` in `commands/` that validates input, calls the domain/db
   layer, and returns a `serde`-serialisable DTO. No heavy logic in the command body.
4. Register the command in `lib.rs`.
5. Unit-test the domain logic (must run without Tauri).

## Step 2 — Tauri ACL
Grant the new command to the window's capability in `src-tauri/capabilities/*.json`. Grant the
minimum — only this command. Do not widen existing broad grants.

## Step 3 — Mirror the DTO (`src/app/core/models/`)
Add/update the TypeScript interface so it matches the Rust DTO 1:1. **Same change, same PR.**

## Step 4 — Bridge wrapper (`src/app/core/bridge/`)
Add a typed function: `export const getX = (args): Promise<X> => invoke<X>('get_x', args)`.
Feature code calls this — never `@tauri-apps/api` directly.

## Step 5 — Angular feature (`src/app/features/<name>/`)
- Standalone component, signals for state, typed forms for input.
- Call the bridge wrapper; format money with the shared pipe; render with shared/dumb
  components.
- If the feature is heavy (OCR/charts), make its route lazy-loaded.

## Step 6 — Verify the rules
- No business logic leaked into TS.
- No network/telemetry added.
- Money never a float.
- DB writes transactional.
- DTO ↔ model in sync.
- Tests + clippy + lint green.

## Step 7 — Docs
If the feature changes behaviour or adds an FR, update `docs/functional-requirements.md` and,
if it affects structure/flow, `docs/architecture.md`.

## Anti-patterns to reject
- Doing money math or dedup/recurrence in TypeScript.
- Calling `invoke` from a feature component instead of the bridge.
- Adding a networking crate "just to fetch FX rates" — multi-currency uses **user-defined**
  rates, no API.
- Bundling a heavy OCR/ML dependency without checking the size budget.
