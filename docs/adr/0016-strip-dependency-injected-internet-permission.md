# 16. Strip the dependency-injected INTERNET permission and ML Kit telemetry

Date: 2026-08-03

Status: Accepted.

## Context

The first release APK ever inspected (v0.1.0 candidate, built while wiring release signing in
ADR 0015) declared:

```
uses-permission: android.permission.ACCESS_NETWORK_STATE
uses-permission: android.permission.INTERNET
```

The committed `AndroidManifest.xml` has never declared either. The manifest-merger report named
the source:

```
uses-permission#android.permission.INTERNET
ADDED from [com.google.android.datatransport:transport-backend-cct:2.3.3]
```

The dependency chain is `com.google.mlkit:text-recognition` ->
`play-services-mlkit-text-recognition` -> `play-services-mlkit-text-recognition-common` ->
`com.google.android.datatransport:transport-backend-cct`, which is Google's Firelog telemetry
uploader. Along with the two permissions it contributes a `TransportBackendDiscovery` service, a
`JobInfoSchedulerService`, and an `AlarmManagerSchedulerBroadcastReceiver` - machinery whose only
purpose is to batch and upload usage events.

Two hard product rules were therefore broken in the shipped artifact, not in the source: the
omitted-INTERNET guarantee (NFR-P4) and the no-telemetry rule. Every APK built since OCR landed
carried this.

The guard did not catch it and could not have: `scripts/guards.mjs` scanned **source**
`AndroidManifest.xml` files only. The merged manifest is a build output it never saw, so
`[ok] All guards passed` was accurate about the source and misleading about the product. A guard
that checks an input while the promise is about an output is not a guard.

## Decision

**Remove the injected declarations at merge time.** The committed manifest gains
`xmlns:tools` and:

- `<uses-permission android:name="android.permission.INTERNET" tools:node="remove" />`
- the same for `ACCESS_NETWORK_STATE`
- `tools:node="remove"` on the three `com.google.android.datatransport` components.

Removing INTERNET is the load-bearing half: without it the OS refuses every socket, so the
transport cannot phone home even though its code is still linked into the APK. Removing the
components is the other half - nothing schedules the uploader in the first place.

**Check the artifact, not the source.** Two changes, because neither alone is sufficient:

1. `scripts/guards.mjs` now parses `<uses-permission>` elements rather than grepping the file. A
   source manifest may name INTERNET only inside a `tools:node="remove"` directive; a manifest
   under `build/` is a merge output where `tools:` directives have already been applied, so any
   mention there fails.
2. `scripts/wsl-build-apk.sh` runs `aapt2 dump badging` on every artifact it produces and **fails
   the build** if INTERNET appears. This is the only check that sees what actually ships. It lives
   in the build script because CI does not build Android (issue #22 / #5).

**ML Kit stays.** The OCR text model is bundled and runs entirely on-device; the telemetry
transport is incidental baggage from the play-services dependency graph, not something OCR needs.

## Consequences

- The source manifest now contains the string `android.permission.INTERNET`, which reads alarming
  at a glance. The `tools:node="remove"` attribute and a comment block explain it, and the guard
  distinguishes the two cases so the distinction is enforced rather than trusted.
- A future dependency that injects INTERNET will fail the Android build rather than ship. It will
  NOT fail CI, since CI builds no Android artifact - closing that gap is part of issue #22.
- The telemetry classes remain in the APK (a few hundred KB) but are unreachable in practice.
  Excluding `com.google.android.datatransport` at the Gradle level was considered and deferred
  (see below).
- Release-artifact inspection is now part of the release procedure, not an afterthought. The size
  and permission facts of a build are recorded when it is published.

## Alternatives considered

- **Gradle `exclude group: "com.google.android.datatransport"`.** Strictly stronger: the code is
  not packaged at all, and the APK shrinks. Deferred because ML Kit references those classes
  directly, so a missing class surfaces as a `NoClassDefFoundError` the first time OCR runs - a
  runtime failure in the one flow this app cannot afford to break silently. Worth revisiting with
  on-device OCR testing behind it.
- **Dropping ML Kit for the pure-Rust `ocrs`/RTen fallback.** Removes the whole play-services graph
  and roughly 10 MB of native library. A much larger change with a real accuracy cost; out of scope
  for a permission fix, but it is the option that would also settle the 25 MB budget question.
- **Accepting the permission and relying on the strict CSP.** Rejected outright. The CSP constrains
  the WebView; it says nothing about native code holding an open socket, and "no INTERNET
  permission" is the claim the product actually makes.
