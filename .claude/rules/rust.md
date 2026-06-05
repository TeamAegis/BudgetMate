# Rules — Rust Core (`src-tauri/`)

Applies to the Rust backend. Read alongside root `CLAUDE.md`.

## Role
The Rust core is the source of truth: all business logic, money math, crypto, DB access,
import/export, rule engine, dedup, and recurrence. It must be unit-testable without a running
WebView.

## Hard rules
- **No networking crates.** `reqwest`, `hyper`, `ureq`, `surf`, raw `tokio::net`, sockets —
  none. No `tauri-plugin-http`. The CI no-network guard enforces this.
- **No telemetry / analytics / remote logging.**
- **Money is `rust_decimal` or integer minor units. Never `f32`/`f64` for money.** A grep gate
  in CI rejects float money.
- **All multi-statement DB writes run in one transaction** (ACID). See
  `.claude/rules/database.md`.

## Module layout (`src-tauri/src/`)
- `lib.rs` — `#[cfg_attr(mobile, tauri::mobile_entry_point)]`, plugin registration, command
  registration.
- `db/` — connection (SQLCipher key set via `PRAGMA key`), migrations, queries, transactions.
- `crypto/` — passphrase KDF (Argon2id), key handling (in-memory only, zeroised on lock).
- `import/` — `csv`, `ofx`/`qfx` (`ofx-rs`) parsers → normalised `StagedTx`.
- `rules/` — deterministic if-then engine + dedup.
- `domain/` — entities, money types, invariants (split-sum, fx conversion, recurrence).
- `export/` — `rust_xlsxwriter` (xlsx), csv, json.
- `commands/` — thin `#[tauri::command]` wrappers that validate input and delegate to modules.

## Commands & IPC
- Commands are thin: validate → call domain/db → return a `serde`-serialisable DTO. No heavy
  logic in the command body.
- Every DTO crossing IPC has a matching TS interface in `src/app/core/models` — update both in
  the same change.
- Long operations (OCR post-processing, large imports, xlsx export) must not block the UI
  thread; run them so the WebView stays responsive. On Android, native plugin work uses
  coroutines and posts results back.

## Crypto specifics
- DB key derived from user passphrase (Argon2id); biometric unlock releases a keystore-held
  key into memory only; zeroise on background/lock.
- Never log keys, passphrases, or decrypted secrets.

## Build profile (size budget)
Keep the release profile size-optimised (`lto=true`, `strip=true`, `panic="abort"`,
`codegen-units=1`, `opt-level="z"`). Don't add heavy dependencies casually — every crate
costs binary size.

## Testing
- Pure domain/rule/dedup/recurrence logic must have unit tests that run without Tauri.
- `cargo clippy -- -D warnings` must pass.
