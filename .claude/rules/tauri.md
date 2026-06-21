# Rules - Tauri IPC boundary & ACL (`src-tauri/capabilities/`, `lib.rs`)

Tauri 2.x. The WebView is **untrusted by default** - every IPC surface is explicitly granted.
Read alongside `.claude/rules/rust.md` (command internals) and `.claude/rules/frontend.md`
(the `core/bridge` wrappers that call these commands).

## Capabilities / ACL
- **The three-file rule:** for any plugin or command to work, three things must agree -
  the crate in `Cargo.toml`, the registration in `lib.rs` (`.plugin(...)` / `generate_handler!`),
  and a capability JSON in `src-tauri/capabilities/`. Miss any one and you get a misleading
  `"not allowed by ACL"` (not an honest "not registered"). Classic bug: adding `tauri-plugin-fs`
  but forgetting `"permissions": ["fs:default"]`.
- Capabilities live in `src-tauri/capabilities/*.json`, mapping permission identifiers to
  windows/webviews by label. **Keep the ACL minimal** - grant only the commands a capability
  actually uses (matches the CLAUDE.md convention). Use the `platforms` array (`android`, `windows`,
  …) to scope mobile-only permissions.
- Prefer the official CLI to add plugins (`cargo add tauri-plugin-x` + the JS package) so default
  permissions are wired automatically.
- **ACL identifiers are ASCII lowercase `[a-z]` only** (max 116 chars) - a digit in a crate/plugin
  name breaks ACL parsing. Avoid digits in plugin identifiers.

## CSP (security - reinforces the no-network promise)
- **Set a restrictive CSP in `app.security.csp`** - CSP protection is OFF unless set. Tauri
  auto-injects nonces/hashes for bundled scripts/styles; you only configure what's app-specific.
- **Never load remote scripts, fonts, or styles** (CDN, Google Fonts) - bundle everything locally.
  This is also a hard product rule (NFR-P4 / no-network). Starting CSP for this stack:
  ```json
  "csp": {
    "default-src": "'self' customprotocol: asset:",
    "connect-src": "ipc: http://ipc.localhost",
    "img-src": "'self' asset: http://asset.localhost blob: data:",
    "style-src": "'unsafe-inline' 'self'",
    "script-src": "'self'"
  }
  ```
  Start strict and loosen only as needed. Avoid `'unsafe-inline'` for scripts.

## Commands vs Events vs Channels
- **Commands** (frontend→Rust): type-safe, return values, capability-controlled - use for almost
  all frontend-initiated calls. Frontend import path is `@tauri-apps/api/core`, but feature code
  never imports it directly - it goes through `core/bridge` (see `.claude/rules/frontend.md`).
- **Events**: small broadcasts (progress, notifications), JSON payloads, **not** type-safe, no
  capability control - not for high throughput. Payload must be `Clone + Serialize`.
- **Channels**: the mechanism for ordered, high-throughput streaming (sync-free progress, file
  streaming).
- **Listener cleanup is mandatory in the SPA:** `listen` returns an `unlisten` fn - call it on
  component teardown (`takeUntilDestroyed` / unsubscribe), or you leak listeners and get duplicate
  handlers. SPA navigation does **not** auto-unregister. Don't call `unlisten` before the `listen`
  promise resolves.
