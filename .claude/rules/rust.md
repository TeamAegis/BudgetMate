# Rules - Rust Core (`src-tauri/`)

Applies to the Rust backend. Read alongside root `CLAUDE.md`.

## Role
The Rust core is the source of truth: all business logic, money math, crypto, DB access,
import/export, rule engine, dedup, and recurrence. It must be unit-testable without a running
WebView.

## Hard rules
- **No networking crates.** `reqwest`, `hyper`, `ureq`, `surf`, raw `tokio::net`, sockets -
  none. No `tauri-plugin-http`. The CI no-network guard enforces this.
- **No telemetry / analytics / remote logging.**
- **Money is `rust_decimal` or integer minor units. Never `f32`/`f64` for money.** A grep gate
  in CI rejects float money. (Domain rationale, ratios, and Mauritius statutory figures:
  `docs/financial-knowledge.md`.)
- **All multi-statement DB writes run in one transaction** (ACID). See
  `.claude/rules/database.md`.

## Module layout (`src-tauri/src/`)
- `lib.rs` - `#[cfg_attr(mobile, tauri::mobile_entry_point)]`, plugin registration, command
  registration.
- `db/` - connection (SQLCipher key set via `PRAGMA key`), migrations, queries, transactions.
- `crypto/` - passphrase KDF (Argon2id), key handling (in-memory only, zeroised on lock).
- `import/` - `csv`, `ofx`/`qfx` (`ofx-rs`) parsers → normalised `StagedTx`.
- `rules/` - deterministic if-then engine + dedup.
- `domain/` - entities, money types, invariants (split-sum, fx conversion, recurrence).
- `export/` - `rust_xlsxwriter` (xlsx), csv, json.
- `commands/` - thin `#[tauri::command]` wrappers that validate input and delegate to modules.

## Commands & IPC
- Commands are thin: validate → call domain/db → return a `serde`-serialisable DTO. No heavy
  logic in the command body.
- Every DTO crossing IPC has a matching TS interface in `src/app/core/models` - update both in
  the same change.
- Long operations (OCR post-processing, large imports, xlsx export) must not block the UI
  thread; run them so the WebView stays responsive. On Android, native plugin work uses
  coroutines and posts results back.
- Large binary returns (file/export bytes) go back via `tauri::ipc::Response` or a Channel -
  never as serialised JSON (serialising large blobs stalls the app).

## Command & async gotchas (high-frequency bugs)
- **Commands registered in `lib.rs` must NOT be `pub`** - the glue codegen defines
  `__cmd__<name>` and `pub` causes `error[E0255]: name defined multiple times`. Command names
  must be unique; args `Deserialize`, returns `Serialize`.
- **Never hold a `std::sync::Mutex` guard across `.await`** (`MutexGuard cannot be sent between
  threads safely`): read the value in a `{ }` scope so the guard drops before awaiting, or use
  `tokio::sync::Mutex` (`tauri::async_runtime::Mutex`) when the lock genuinely must span the await.
- **Never do blocking I/O (rusqlite, file I/O) directly in an `async` command** - it stalls the
  Tokio pool. Offload with `tokio::task::spawn_blocking(...)`.
- **Managed state:** `app.manage(Mutex<AppState>)` and inject the *same* `State<'_, Mutex<AppState>>`
  type - a type mismatch panics at runtime, not compile time (use a type alias). Don't wrap
  Tauri-managed state in `Arc`; Tauri already shares it. Only the first managed value per type is used.

## Error handling across IPC
- Everything a command returns - **including errors** - must `serde::Serialize`. Use one app-wide
  `AppError` enum (`thiserror` + a `Serialize` impl, with `#[from]` so `?` converts external errors)
  in `error.rs`; set it up early - retrofitting consistent errors later is painful. A command error
  rejects the `invoke` promise; a tagged enum lets the frontend `switch` on the kind. Log once at the
  command boundary, not scattered through business logic. Reserve `unwrap`/`expect` for unrecoverable
  startup only.

## Crypto specifics
- DB key derived from user passphrase (Argon2id); biometric unlock releases a keystore-held
  key into memory only; zeroise on background/lock.
- Never log keys, passphrases, or decrypted secrets.

## Build profile (size budget)
Keep the release profile size-optimised (`lto=true`, `strip=true`, `panic="abort"`,
`codegen-units=1`, `opt-level="z"` - `"z"` is our default; benchmark against `"s"` if size
regresses). Don't add heavy dependencies casually - every crate costs binary size. The same
profile drives the Android `.so`; watch the dependency tree for bloat (`cargo-bloat`).

## Testing
- Pure domain/rule/dedup/recurrence logic must have unit tests that run without Tauri.
- `cargo clippy -- -D warnings` must pass.
