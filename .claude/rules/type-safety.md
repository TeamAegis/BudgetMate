# Rules - Type safety across the IPC boundary (Rust ↔ TypeScript)

Applies to every DTO and command crossing Tauri IPC. Read alongside `.claude/rules/rust.md`
(Commands & IPC, Error handling) and `.claude/rules/frontend.md` (Boundaries). Rationale and the
decision to defer codegen: `docs/adr/0001-ipc-type-safety.md`.

## Source of truth
- The Rust struct is the contract. The TS interface in `src/app/core/models` MIRRORS it; never the
  other way round. Rust defines the shape and the invariants; TS only restates the shape for the
  compiler and formats the result.

## Hard rules
- Every DTO crossing IPC has a matching TS interface in `src/app/core/models/index.ts`. Update BOTH
  in the same change (the canonical statement of CLAUDE.md Definition-of-done #4).
- Every command DTO carries `#[serde(rename_all = "camelCase")]` on the Rust side; the TS interface
  uses those camelCase names verbatim. No snake_case crosses the wire.
- Every `#[tauri::command]` returns `Result<T, AppError>`, never `Result<T, String>`. Errors are
  typed and serialisable (see `src-tauri/src/error.rs` and `.claude/rules/rust.md` Error handling).
  The TS side models the rejection as the `AppError` discriminated union in `core/models`.
- The contract guard (`scripts/guards.mjs`, run by `npm run guards`) must pass: it fails CI when a
  Rust serde DTO has a field with no counterpart in the mirrored TS interface (or vice versa), or an
  optionality mismatch. Do not work around a guard failure; fix the mirror.
- All wrappers live in `src/app/core/bridge`; feature code never imports `@tauri-apps/api` (enforced
  by eslint `no-restricted-imports`). A new command means a new typed wrapper here.

## Where types live
- Output DTOs: `src-tauri/src/domain/*.rs` (plus `commands/mod.rs` for app-level ones such as
  `AppInfo`, `DbHealth`).
- Input DTOs (`NewX` / `UpdateX`): declared in the relevant `src-tauri/src/commands/*.rs`.
- TS mirror for both: `src/app/core/models/index.ts` (one file, sectioned by domain).
- Typed `invoke<T>()` wrappers: `src/app/core/bridge/tauri-bridge.ts`.
- `AppError` enum: `src-tauri/src/error.rs`; its TS mirror is a discriminated union in
  `src/app/core/models/index.ts`.

## Adding a new command (checklist)
1. Rust DTO(s) with `#[derive(Serialize/Deserialize)]` + `#[serde(rename_all = "camelCase")]`.
2. `#[tauri::command]` returns `Result<T, AppError>`.
3. Mirror every DTO field in `core/models` (same change).
4. Add a typed wrapper in `tauri-bridge.ts`.
5. Run `npm run guards`; the contract guard must pass.
(Full end-to-end order: the `new-feature` skill.)

## Offline / build-time constraint
- Any type tooling MUST be build-time only and offline (no runtime network, no remote schema fetch).
  The contract guard is pure Node with no dependencies, runs in `npm run guards`, and reads files off
  disk only.
- We deliberately do NOT use runtime type reflection or codegen (`tauri-specta`, `ts-rs`) at this
  stage. Manual mirror plus the CI guard is the contract. If that changes, record it in `docs/adr/`.

## Gotchas (high-frequency drift bugs)
- serde rename mismatch: a Rust field renamed but not the TS interface (or the `#[serde]` attribute)
  goes silently `undefined` at runtime. The guard catches the field-name half; you still own renames.
- Optionality: Rust `Option<T>` maps to TS `field?: T | null`. A non-optional Rust field mirrored as
  optional TS (or the reverse) is a real bug the guard flags.
- Enums: a Rust `#[serde(rename_all = "...")]` enum mirrors as a TS string-literal union (for example
  `'cash' | 'bank' | ...`). Adding a Rust variant without adding the TS literal is drift.
- Money is ALWAYS minor units (`i64`) plus currency, or a decimal STRING for fx / major-unit input.
  Never `f64` in a DTO, never money math in TS (`.claude/rules/frontend.md` Money).
