# 15. Android release signing and GitHub-release distribution

Date: 2026-08-03

Status: Accepted.

## Context

Every Android artifact produced so far has been a **debug** build: `scripts/wsl-build-apk.sh`
hardcoded `--debug --target aarch64 --apk`, and `src-tauri/gen/android/app/build.gradle.kts` had no
`signingConfigs` block at all. That left three problems the moment anyone wanted an installable
build to hand out:

- `assembleRelease` produces an **unsigned** APK, which no device will install.
- The debug APK carries `applicationIdSuffix ".debug"`, so it installs as a different application
  (`com.aegis.budgetmate.debug`) and a later release build cannot upgrade it in place.
- The debug universal APK measured **221 MB** (dev-profile Rust, four ABIs, `keepDebugSymbols` on
  every `.so`), against the NFR-Perf1 install-size budget of 25 MB. It is not a plausible release
  artifact even ignoring signing.

The repo also had no tags and no releases, so there was no established way to hand someone a build.

## Decision

**Signing configuration lives in the build file; the key never does.**
`app/build.gradle.kts` reads four values - store path, store password, key alias, key password -
from `app/keystore.properties` first, falling back to the `ANDROID_KEYSTORE_PATH`,
`ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` environment variables (the
names `.claude/rules/android.md` already specified for CI). `keystore.properties` was already
gitignored by the generated project; the keystore itself lives outside the repo entirely.

**A missing keystore warns, it does not fail.** With nothing configured, the release build still
runs and emits an unsigned artifact plus a `[warn]` line. This keeps `assembleRelease` usable for
size measurement (NFR-Perf1, issue #22) on a machine that has no signing key, including CI.

**The build script gained modes** rather than a second script:
`wsl-build-apk.sh [debug|release] [apk|aab]`, defaulting to the previous `debug apk` behaviour.
Release builds run `apksigner verify` on the output, because "unsigned" is otherwise only
discovered at install time.

**Distribution is a GitHub release** with the signed APK attached, tagged from `main`. The repo is
private, so this is internal distribution, not a Play listing. Play submission is a separate,
later decision (it needs the AAB path, a Data Safety declaration, and an upload key committed to
for the lifetime of the listing).

**R8 keep rules for the OCR plugin are stated explicitly** in `app/proguard-rules.pro` even though
`tauri-android`'s consumer rules already cover `@TauriPlugin public class *`. The plugin is loaded
by name from Rust (`register_android_plugin("com.plugin.ocr", "OcrPlugin")`) with no static
reference for R8 to follow, so a consumer-rule regression would surface only as a startup
`ClassNotFoundException` in a release build - the one build type least often exercised.

## Consequences

- `app/build.gradle.kts` and `app/proguard-rules.pro` are Tauri-generated files that are now
  hand-edited. If `tauri android init` is ever re-run (the `.claude/rules/android.md` procedure for
  an identifier change), the signing block, the `signingConfig` line, and the OCR keep rules must
  be re-applied. Both edits carry a comment saying so.
- `keystore.properties` paths must be **WSL-resolvable** (`/mnt/c/...`), because Android builds run
  under WSL2 - vendored OpenSSL cannot be configured for an Android target by Windows Perl
  (`.claude/skills/run-app`).
- Losing the keystore is unrecoverable for a Play listing. Whoever holds it owns the backup.
- `package.json` version was `0.0.0` while `tauri.conf.json` said `0.1.0`; they are now aligned.
  `tauri.conf.json` remains the single source of truth (it derives `versionCode`), and
  `package.json` mirrors it.
- CI still does not build Android (issue #22 / #5). A tag-triggered release workflow would need the
  SDK/NDK on the runner plus the keystore as a base64 secret, and can now reuse the same env-var
  contract this ADR establishes.

## Alternatives considered

- **Keystore committed and encrypted (git-crypt / age).** Rejected: it puts the signing key in the
  history of a repo whose whole premise is that secrets stay off shared infrastructure, and it
  buys convenience only for a single-developer project that does not need it.
- **Fail the build when signing is unconfigured.** Rejected: it would block the install-size
  measurement that issue #22 needs, and CI has no key.
- **A separate `wsl-build-release.sh`.** Rejected: the two scripts would have shared roughly 60
  lines of NDK/toolchain setup, and that duplication is exactly where an environment fix rots.
- **Publishing the debug APK as the release.** Rejected: 221 MB, a different application id, and
  debuggable. It is a development artifact.
