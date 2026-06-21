# Rules - Engineering quality (project-wide)

Testing strategy, dependency hygiene, ADRs, and maintainability for the whole repo. Read alongside
`.claude/rules/rust.md` (Testing, Build profile), `.claude/rules/database.md` (Invariants, the
canonical property-test targets), and `.claude/rules/style.md`.

## Test pyramid
- 60-70% unit: pure logic with no Tauri / WebView / real DB. All money, dedup, recurrence,
  categorisation, and fx logic lives here and must be testable without a running app
  (`.claude/rules/rust.md` Testing).
- 20-30% integration: open a real SQLCipher DB on a temp file (`tempfile`), run migrations, exercise
  the full transaction path, and serde round-trip every IPC DTO (parse what the command returns) to
  catch contract drift the static guard cannot.
- 5-10% e2e: smoke flows via `tauri-driver` + WebdriverIO against a WebView2 desktop build. Target,
  not yet wired (tracked with the CI pipeline, issue #5).
- A bug fix ships a regression test at the lowest layer that expresses it (matches the `bug-hunter`
  method).

## Property & snapshot testing (Rust core)
- `proptest` for the DB invariants in `.claude/rules/database.md`: split amounts sum exactly to the
  parent; `base_amount_minor == round(amount_minor * fx_rate)`; recurrence materialisation is
  idempotent; dedup never deletes. Generate valid inputs and assert the invariant holds; proptest
  shrinks a failure to the minimal case.
- `insta` snapshots for stable serialized output (export csv/json/xlsx cell model, MUR-formatted
  strings, categorisation reason strings). Review with `cargo insta review`; commit the `.snap` files.
- `cargo-mutants` over `domain/` and `rules/` as a periodic, non-blocking check that the tests
  actually catch injected bugs.
- All three are `[dev-dependencies]` or external tools, so they add ZERO binary size; the size budget
  in `.claude/rules/rust.md` does not block them.

## Frontend testing
- Use the existing Karma + Jasmine harness (`npm test`, what CI runs). Do not swap test runners as a
  side effect; a Vitest migration, if ever wanted, is its own scoped change.
- Test the five required states, the money pipe, and that components talk to `core/bridge` (mock it),
  never `@tauri-apps/api` directly.

## Doctests
- Public Rust domain functions carry `///` examples in fenced code blocks that `cargo test` compiles
  and runs, so the docs cannot drift from the API. Keep example money values correct.

## Dependency hygiene
- `Cargo.lock` is committed (the guards scan it); build and test with `--locked` in CI so a stale lock
  fails fast.
- Audit with the `dependency-audit` skill before adding or bumping a dependency.
- Add no casual heavy dependencies; every crate costs binary size (`.claude/rules/rust.md` Build
  profile, `cargo-bloat`). `npm audit` needs network, so treat it as advisory and run it out of band;
  the hard offline guarantee is the no-network guard plus the strict CSP, not `npm audit`.

## Architecture Decision Records (ADRs)
- Record load-bearing decisions (driver/library choices, OCR engine, "no fx API, user-entered rates",
  notable crate pins) in `docs/adr/NNNN-title.md` using the short Nygard / MADR format (Context,
  Decision, Consequences, Alternatives). ADRs are forward-only: supersede, never rewrite a shipped one
  (mirrors the migration discipline). See `docs/adr/README.md`.

## Maintainability & module boundaries
- Respect the module layout in `.claude/rules/rust.md` and the frontend structure in
  `.claude/rules/frontend.md`. Keep commands thin; keep one concern per PR; keep money and rule logic
  in small pure functions so they stay property-testable.

## The local gate (reference)
- The pre-PR gate is in `CLAUDE.md` / the `run-app` skill. The additions above are recommended, not
  all blocking: `proptest` and `insta` run inside `cargo test`; `cargo-mutants` and the dependency
  audit are periodic.
