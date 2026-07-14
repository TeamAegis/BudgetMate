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
- [0002](0002-page-based-forms-no-modals.md): Page-based forms. Add/edit forms are full-screen routes;
  ConfirmDialog is the only remaining overlay. (Action placement superseded by 0003.)
- [0003](0003-form-action-placement.md): Form action placement. Primary Save is a keyboard-safe
  bottom bar; the destructive Delete/Archive is a danger icon top-right in the header.
- [0004](0004-two-step-add-transaction.md): Two-step add. Adding a transaction picks kind then
  category (navigation lists) before the form, which shows the category instead of a dropdown.
  Presentation only; lossless category change; edit + scan unchanged.
- [0005](0005-allowance-envelope-imprest-model.md): Allowance (envelope) model. Savings-backed
  allowances use the imprest set-to-target top-up (carryover, no stacking), three balances
  (`Available = Total - Reserved`), an all-or-nothing savings gate on increases, and calendar-aligned
  lazy refresh. Distinct from goals (FR-3.2) and category caps (FR-3.1). Full spec: `docs/allowances.md`.
- [0006](0006-export-desktop-first-android-saf-deferred.md): Transaction export (FR-4.2). Pure,
  platform-agnostic CSV/XLSX writers; the save path is desktop-first (dialog `save()` + `std::fs`),
  Android's SAF-backed save (`tauri-plugin-android-fs`) is a separate device-verified change; amounts
  are always exported as strings (never a float) to keep the `no-float-money` guard honest.
- [0007](0007-encrypted-backup-desktop-first.md): Encrypted local backup (FR-4.1). `.vaultbak` is a
  JSON envelope bundling the already-encrypted SQLCipher DB bytes (base64) with the non-secret
  salt/`KdfParams`; the snapshot copies encrypted bytes under the `DbState` mutex (no key access,
  never `VACUUM INTO`/online-backup); desktop-first save mirrors ADR 0006; restore (FR-4.3) is
  out of scope (issue #21).
- [0008](0008-restore-replace-desktop-first-merge-deferred.md): Restore from backup (FR-4.3),
  REPLACE mode only. Key re-derived from the envelope's own salt/kdf; the envelope now also carries
  `baseCurrency` (adopted on restore - `base_amount_minor` is bound to it); crash-safe swap
  (copy-to-`.prev` + atomic rename + a `restore.pending` marker self-healed on next unlock/restore);
  biometric forced off; app left locked only if the swap itself fails; Merge mode and Android's
  SAF file-pick are deferred (issue #21 follow-up).
