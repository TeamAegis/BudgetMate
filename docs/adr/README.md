# Architecture Decision Records (ADRs)

Load-bearing decisions for BudgetMate (Vault) are recorded here, one file per decision, named
`NNNN-title.md` (zero-padded, incrementing). Use the short Nygard / MADR format: Context, Decision,
Consequences, and Alternatives considered.

## Rules
- One decision per file. Keep it short (about a page).
- ADRs are forward-only. To change a decision, add a new ADR that supersedes the old one and mark the
  old one "Superseded by NNNN". Never rewrite a shipped ADR (mirrors the migration discipline in
  `.claude/rules/database.md`).
- Record a decision here when it is load-bearing and not obvious from the code: driver / library
  choices, security or money-model choices, platform scope, notable dependency pins.

## Index
- [0001](0001-ipc-type-safety.md): IPC type safety. Manual mirror + AppError + contract guard;
  tauri-specta deferred.
- [0002](0002-page-based-forms-no-modals.md): Page-based forms. Add/edit forms are full-screen routes
  with Save in the header (keyboard-safe); ConfirmDialog is the only remaining overlay.
