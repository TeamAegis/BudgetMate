import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { LucideDatabaseBackup } from '@lucide/angular';
import {
  createBackup,
  getAppInfo,
  isTauri,
  pickBackupDestination,
  toUserMessage,
} from '../../../core/bridge';
import type { BackupSummary } from '../../../core/models';
import { Banner } from '../../../shared/ui/banner/banner';
import { Button } from '../../../shared/ui/button/button';
import { Card } from '../../../shared/ui/card/card';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';

/**
 * Encrypted local backup (FR-4.1) - desktop-first slice (see the backup ADR, mirroring the export
 * ADR 0006). Rust copies the already-encrypted SQLCipher database bytes, bundles them with the
 * non-secret salt/KDF params needed to re-derive the key on restore, and writes the `.vaultbak`
 * envelope to a path the user picks via the native save dialog; this component only marshals the
 * two calls and presents the result. On Android the save path is deferred (SAF picker not yet
 * wired), so this screen shows an info banner instead of a button that would fail.
 *
 * Restore (FR-4.3) is out of scope for this slice (tracked separately as issue #21) - this panel
 * deliberately omits any restore affordance; a future change extends this screen once that lands.
 */
@Component({
  selector: 'app-backup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideDatabaseBackup, Banner, Button, Card, Skeleton],
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
}
