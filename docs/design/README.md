# BudgetMate — Design Documentation

This folder defines the UI/UX for **BudgetMate**, the strictly-offline, privacy-first mobile
budget app specified in `../functional-requirements.md` and architected in
`../architecture.md`. The design is derived from the Figma file *BudgetMate*
(`PhqmuOWsxpnKjqIW6yJXge`) and reconciled against the verified technical constraints of the
stack (Tauri 2.x + Angular static + Rust, native on-device OCR, SQLCipher, zero network).

## Read in this order
1. **`ux-blueprint.md`** — product principles, information architecture, navigation map,
   end-to-end user flows, screen states, offline-specific UX, accessibility, and a
   **coverage gap analysis** (which FR screens the current Figma covers vs. what still needs
   designing).
2. **`design-system.md`** — the visual language: design tokens (color, type, spacing, radius,
   elevation, motion) taken from the actual Figma values, plus the component library spec.
3. **`screens.md`** — a screen-by-screen specification: each screen mapped to its FR IDs, the
   components it uses, the data it shows, the Rust commands it calls, and its states.

Cross-cutting reference (consult as needed, not in sequence):
- **`ui-ux-principles.md`** — the UI/UX **principles knowledge base** (UX psychology and laws,
  WCAG 2.2, Material-3-leaning best practice, anti-patterns, a decision checklist). It is the *why*
  behind the three specs above; audit a screen, component, or blueprint against it with
  **`/design-check <target>`** (the read-only `design-validator` role). It is a reference, **not** a
  feature backlog — and where one of its dp/sp numbers conflicts with a token, the token wins.

## Companion machine-usable files
- **`../../src/styles/_tokens.scss`** — the design tokens as SCSS custom properties, ready to
  import into the Angular app.
- **`../../design-tokens.json`** — the same tokens in machine-readable JSON (for tooling /
  future sync).
- **`../../.claude/rules/design.md`** — design rules for Claude Code so generated UI stays on
  the system.

## How the design honours the app's hard constraints
These are not stylistic preferences — they fall out of the research and the FR/NFRs:

- **Offline & no-telemetry (NFR-P1, NFR-P4):** the Poppins font is **self-hosted/bundled**,
  never fetched from Google Fonts; no remote images, icons, or CSS. Illustrations
  (`undraw_*`) are bundled as local SVG/PNG assets.
- **Zero-AI logic / user control (Core Vision):** OCR and import screens always end in a
  **human-confirmation** step; nothing auto-commits. The UI surfaces *why* a category/dup was
  chosen (deterministic rules), never a black box.
- **Native feel & responsiveness (NFR-Rel2):** charts use the bundled Chart.js (canvas);
  heavy work (OCR, import, export) shows progress and runs off the UI thread.
- **Security at launch (FR-5.x):** a **Lock screen** (biometric/passphrase) precedes the app
  shell — this screen is **missing from the current Figma** and is specified here.
- **Money correctness (NFR-Rel1):** all amounts are formatted from integer minor units by a
  shared pipe; the UI never does money math. Currency is **MUR ("Rs")** by default given the
  target locale, with multi-currency display per FR-1.4.
