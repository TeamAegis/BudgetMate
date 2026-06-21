---
name: dependency-audit
description: Audit the dependency tree for vulnerabilities, banned or duplicate crates, license issues, and binary-size bloat, consistent with the strictly-offline product promise. Use before adding or bumping a dependency, or as a periodic supply-chain check.
---

# Dependency audit (offline-consistent supply-chain check)

Check `src-tauri/Cargo.toml` / `Cargo.lock` (and `package.json`) for known vulnerabilities, banned or
duplicated crates, disallowed licenses, and binary-size cost. Everything here is build-time / dev-time
and offline; nothing ships in the app.

## Procedure
1. **cargo-audit** against `src-tauri/Cargo.lock` (`cargo audit`). The advisory DB works offline once
   cached in `~/.cargo/advisory-db`; the only networked step is `cargo audit fetch`, done out of band,
   never inside the app or the offline CI guards.
2. **cargo-deny** with a committed `src-tauri/deny.toml`:
   - `advisories`: RUSTSEC; deny known issues.
   - `bans`: forbid networking crates as DIRECT deps and `tauri-plugin-http` (mirror the
     `NETWORK_CRATES` / `FORBIDDEN_TELEMETRY` lists in `scripts/guards.mjs`); deny
     `multiple-versions` to curb bloat.
   - `licenses`: allowlist MIT, Apache-2.0, BSD-2/3-Clause, ISC, Unicode, Zlib; deny copyleft and
     unknown. (Set the crate's own `license` field, which is currently empty.)
   - `sources`: allow crates.io plus the in-repo `plugins/ocr` path dependency only.
3. **Lockfile discipline**: `Cargo.lock` is committed; CI builds and tests with `--locked`; never
   hand-edit the lock.
4. **cargo-bloat**: `cargo bloat --release --crates` to see per-crate binary cost (cross-ref
   `.claude/rules/rust.md` Build profile and `scripts/bundle-size.mjs`). Justify or drop any new heavy
   crate against the size budget.
5. **npm caveat**: `npm audit` needs network, so it is advisory and runs out of band. The hard offline
   guarantee is the no-network guard plus the strict CSP, not `npm audit`.

## Offline note
`cargo-audit`, `cargo-deny`, `cargo-bloat`, and `cargo-mutants` are developer tools, not committed
dependencies; they add no binary size and make no runtime network calls. The only fetch is refreshing
the advisory DB, which is out of band.

## Output
Findings with an action for each: pin, replace, drop, or allowlist-with-justification. Lead with
security advisories and banned crates.

## Anti-patterns
- Don't add a dependency to "fetch" anything at runtime; that breaks the no-network promise.
- Don't bypass a `cargo-deny` ban to land a quick change; raise it instead.
- Don't bump past the brittle `rusqlite 0.37` pin without re-validating the Android build (see the
  `Cargo.toml` comment and `.claude/rules/database.md`).

## References
`.claude/rules/{rust,database}.md`, `scripts/guards.mjs`, `scripts/bundle-size.mjs`. Wiring
`cargo deny` / `cargo audit` into the Rust CI job is a follow-up tied to the CI pipeline (issue #5).
