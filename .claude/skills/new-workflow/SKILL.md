---
name: new-workflow
description: Author or edit a GitHub Actions workflow (.github/workflows/*.yml) for BudgetMate to the project's conventions. Use when CI/automation is needed or changed - e.g. building the CI pipeline (issue #5), adding a size-metric job, or a lint/test gate. Keeps workflows offline-consistent (no secrets/network), Android-scoped, and shippable via a PR.
---

# Authoring a GitHub Actions workflow

Workflows live in `.github/workflows/<name>.yml`. They run the same gate a human runs locally, so
green CI means the pre-PR gate passed. A workflow is a normal change - create it on a branch and PR
(see `feature-branch`).

## Conventions (match these)
- **Triggers:** `on: { pull_request: {}, push: { branches: [main] } }`.
- **Gate job** mirrors CLAUDE.md / `run-app` exactly:
  `npm ci` → `npm run lint` → `npm test` (Chrome headless) → `npm run guards` →
  `cargo test --manifest-path src-tauri/Cargo.toml` →
  `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`.
- **Toolchain on the runner:** Node LTS + `actions/setup-node` (cache npm); Rust stable (MSVC on
  windows runners) + cargo cache (`Swatinem/rust-cache`); **Perl + NASM must be available** for the
  `bundled-sqlcipher-vendored-openssl` build (windows-latest/ubuntu ship Perl; install NASM if
  missing). A headless Chrome for `npm test`.
- **Scope: Android + desktop only.** Do **not** add macOS/iOS runners (iOS is deferred). Android
  device/emulator builds need the SDK/NDK - gate them behind a separate, clearly-named job.
- **Privacy:** no telemetry actions, no secrets unless truly required, no network calls beyond the
  Actions marketplace. The product is offline - CI shouldn't smuggle in network behaviour.
- **Naming:** give jobs/checks stable names (e.g. `gate`) so they can become *required* checks if
  the repo ever goes public or paid (see `harden-main`).
- Pin actions to a major version (`actions/checkout@v4`, etc.).

## Steps
1. On a branch, add `.github/workflows/<name>.yml`.
2. Write minimal, cached jobs per the conventions above. Keep the YAML valid (2-space indent).
3. Sanity-check structure; after pushing, confirm with `gh workflow list` and watch the first run
   with `gh run watch` / `gh pr checks --watch`.
4. Ship via `feature-branch`; land with `merge-pr`.

## Notes
- The real CI pipeline is tracked by **issue #5** - when building it, also record the Android
  bundle size as a tracked metric (architecture §10.1) and keep the no-network/INTERNET-manifest
  guard (`scripts/guards.mjs`) in the gate.
- A failing workflow must block the merge - that's enforced by the `merge-pr` skill (and by
  required checks if/when server-side protection is enabled).
