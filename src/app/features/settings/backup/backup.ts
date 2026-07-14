import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import {
  LucideDatabaseBackup,
  LucideEye,
  LucideEyeOff,
  LucideRotateCcw,
  LucideUpload,
} from '@lucide/angular';
import {
  createBackup,
  getAppInfo,
  isTauri,
  pickBackupDestination,
  pickBackupFile,
  restoreBackup,
  toUserMessage,
} from '../../../core/bridge';
import { asAppError } from '../../../core/models';
import type { BackupSummary, RestoreSummary } from '../../../core/models';
import { Banner } from '../../../shared/ui/banner/banner';
import { Button } from '../../../shared/ui/button/button';
import { Card } from '../../../shared/ui/card/card';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { FormField } from '../../../shared/ui/form-field/form-field';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';

/**
 * Encrypted local backup (FR-4.1) + restore (FR-4.3, REPLACE mode only - see
 * `docs/adr/0008-restore-replace-desktop-first-merge-deferred.md`) - desktop-first slice (see the
 * backup ADR, mirroring the export ADR 0006). Rust copies the already-encrypted SQLCipher database
 * bytes, bundles them with the non-secret salt/KDF params needed to re-derive the key on restore,
 * and writes the `.vaultbak` envelope to a path the user picks via the native save dialog; this
 * component only marshals the two calls and presents the result. On Android the save/restore paths
 * are deferred (SAF picker not yet wired), so this screen shows an info banner instead of controls
 * that would fail.
 *
 * Restore is REPLACE mode only - it permanently overwrites every account/transaction/category/goal
 * currently in the app with the backup's contents, gated behind `<app-confirm-dialog>` (the only
 * sanctioned overlay in the app). Merge mode is a deferred follow-up (ADR 0008).
 */
@Component({
  selector: 'app-backup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideDatabaseBackup,
    LucideEye,
    LucideEyeOff,
    LucideRotateCcw,
    LucideUpload,
    Banner,
    Button,
    Card,
    ConfirmDialog,
    FormField,
    Skeleton,
  ],
  templateUrl: './backup.html',
  styleUrl: './backup.scss',
})
export class Backup implements OnInit {
  protected readonly loading = signal(true);
  /** Set ONLY by a failed initial load (`ngOnInit`'s `getAppInfo`). Drives the blocking full-page
   *  "Try again" branch, which is appropriate there because nothing loaded. */
  protected readonly loadError = signal<string | null>(null);
  /** Set ONLY by a failed backup action (`backup()`). Shown as an inline banner INSIDE the
   *  populated state so a failed backup never hides the controls or the encryption note. */
  protected readonly actionError = signal<string | null>(null);
  protected readonly isAndroid = signal(false);

  protected readonly busy = signal(false);
  /** Guards against a double-tap opening two save dialogs / firing two backups: set synchronously
   *  at the start of `backup()`, before awaiting the picker, and cleared in `finally`. */
  private readonly inFlight = signal(false);
  protected readonly savedSummary = signal<BackupSummary | null>(null);

  /** The controls (Create backup) render once we know the platform isn't Android and the initial
   *  load succeeded. Does NOT depend on `actionError` - a backup-action failure must not tear down
   *  the controls or the encryption note. */
  protected readonly showControls = computed(
    () => !this.loading() && !this.isAndroid() && this.loadError() === null,
  );

  /** Just the filename, for the saved-success message (presentation only - the full path is kept
   *  in `savedSummary` for anything that needs it later). */
  protected readonly savedFileName = computed(() => {
    const path = this.savedSummary()?.path;
    if (!path) return '';
    return path.split(/[/\\]/).pop() ?? path;
  });

  // ── Restore (FR-4.3, REPLACE mode only) ─────────────────────────────────────────

  protected readonly restorePath = signal<string | null>(null);
  protected readonly restorePassphrase = signal('');
  /** Show/hide toggle for the passphrase input, mirroring `features/lock/lock.ts`'s `reveal`. The
   *  passphrase lives only transiently in this signal on a desktop app - same trust boundary as
   *  the Lock screen's unlock field. */
  protected readonly restoreReveal = signal(false);
  protected readonly restoreBusy = signal(false);
  /** Guards a double-tap on "Choose backup file" while the open picker is still awaiting - set
   *  synchronously before awaiting `pickBackupFile()`, cleared in `finally`. Exposed (not private)
   *  so the template can disable the button while the picker is open. */
  protected readonly restorePickBusy = signal(false);
  /** Guards a double-tap re-firing `restoreConfirmed()` while a restore is already in flight. */
  private readonly restoreInFlight = signal(false);
  protected readonly restoreError = signal<string | null>(null);
  protected readonly restoreSummary = signal<RestoreSummary | null>(null);
  protected readonly confirmingRestore = signal(false);

  /** Just the filename of the chosen backup file (presentation only). */
  protected readonly restoreFileName = computed(() => {
    const path = this.restorePath();
    if (!path) return '';
    return path.split(/[/\\]/).pop() ?? path;
  });

  /** Plain-language disclosure of the ADOPTED base currency for the success banner - "Rs (MUR)"
   *  matches the money pipe's display override (`shared/pipes/money.pipe.ts`), any other code is
   *  shown as-is. Presentation only, not a currency scale/rate table. */
  protected readonly restoreBaseCurrencyLabel = computed(() => {
    const code = this.restoreSummary()?.baseCurrency?.toUpperCase();
    if (!code) return '';
    return code === 'MUR' ? 'Rs (MUR)' : code;
  });

  /** Restore is only offered once a file AND a non-empty passphrase are present, and never while
   *  a restore is already in flight. */
  protected readonly canRestore = computed(
    () =>
      !!this.restorePath() &&
      this.restorePassphrase().trim().length > 0 &&
      !this.restoreInFlight() &&
      !this.restorePickBusy(),
  );

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.loadError.set('Run the app (npm run tauri dev) to create a backup.');
      return;
    }
    try {
      const info = await getAppInfo();
      if (info.platform === 'android') {
        this.isAndroid.set(true);
      }
    } catch (e) {
      this.loadError.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected async backup(): Promise<void> {
    if (this.inFlight()) return;
    this.inFlight.set(true);
    this.actionError.set(null);
    this.savedSummary.set(null);
    try {
      const destPath = await pickBackupDestination();
      if (!destPath) return; // Cancelled: stay on the populated state, no error.
      this.busy.set(true);
      const summary = await createBackup(destPath);
      this.savedSummary.set(summary);
    } catch (e) {
      this.actionError.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
      this.inFlight.set(false);
    }
  }

  protected retry(): void {
    this.loadError.set(null);
    this.loading.set(true);
    void this.ngOnInit();
  }

  protected async pickRestoreFile(): Promise<void> {
    if (this.restorePickBusy()) return;
    this.restorePickBusy.set(true);
    try {
      const path = await pickBackupFile();
      if (!path) return; // Cancelled: keep whatever was chosen before, no error.
      this.restorePath.set(path);
      this.restoreError.set(null);
      this.restoreSummary.set(null);
    } finally {
      this.restorePickBusy.set(false);
    }
  }

  protected onRestorePassphraseInput(event: Event): void {
    this.restorePassphrase.set((event.target as HTMLInputElement).value);
  }

  /** Opens the confirm dialog - the actual restore only runs from `restoreConfirmed()`. */
  protected confirmRestore(): void {
    if (!this.canRestore()) return;
    this.restoreError.set(null);
    this.confirmingRestore.set(true);
  }

  protected cancelRestore(): void {
    this.confirmingRestore.set(false);
  }

  protected async restoreConfirmed(): Promise<void> {
    if (this.restoreInFlight()) return;
    this.restoreInFlight.set(true);
    this.restoreBusy.set(true);
    this.restoreError.set(null);
    try {
      const path = this.restorePath();
      if (!path) return; // Defensive: the button is disabled without a path.
      const summary = await restoreBackup(path, this.restorePassphrase(), 'replace');
      // Never keep the backup passphrase in memory longer than the attempt that used it - clear it
      // on SUCCESS only. On an error (below) it deliberately stays so the user can fix a typo
      // without retyping the whole secret; it lives only transiently in this signal on a desktop
      // app, same trust boundary as the Lock screen's unlock field.
      this.restorePassphrase.set('');
      this.restoreSummary.set(summary);
      // Deliberately NOT `this.reload()` here: a destructive action's confirmation must be visible
      // (and announced to a screen reader via the success `app-banner`'s `role="status"`) before
      // the webview reloads. `reload()` now fires only when the user taps "Reopen app" below, which
      // also gives them a moment to read the adopted-base-currency disclosure.
    } catch (e) {
      this.restoreError.set(this.restoreErrorMessage(e));
    } finally {
      this.restoreBusy.set(false);
      this.restoreInFlight.set(false);
      this.confirmingRestore.set(false);
    }
  }

  /** Toggle the show/hide state of the restore passphrase field. */
  protected toggleRestoreReveal(): void {
    this.restoreReveal.set(!this.restoreReveal());
  }

  /** `KeyVerificationFailed` is deliberately generic in Rust (no wrong-key-vs-corrupt oracle) -
   *  restated here for the restore context specifically, since `toUserMessage`'s generic phrasing
   *  ("Incorrect passphrase...") is written for the live-vault unlock flow, not a backup file. */
  private restoreErrorMessage(e: unknown): string {
    const err = asAppError(e);
    if (err.kind === 'keyVerificationFailed') {
      return 'Wrong passphrase, or this backup is corrupt.';
    }
    return toUserMessage(e);
  }

  /** Reloads the whole webview. Kept as its own method (rather than inlining
   *  `window.location.reload()`) so a test can spy on it without triggering a real navigation. */
  protected reload(): void {
    window.location.reload();
  }
}
