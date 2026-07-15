import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { LucideDownload } from '@lucide/angular';
import {
  exportTransactions,
  getAppInfo,
  isTauri,
  listTransactions,
  pickExportDestination,
  toUserMessage,
} from '../../../core/bridge';
import type { ExportSummary } from '../../../core/models';
import { Banner } from '../../../shared/ui/banner/banner';
import { Button } from '../../../shared/ui/button/button';
import { Card } from '../../../shared/ui/card/card';
import { SegmentedToggle, type SegmentOption } from '../../../shared/ui/segmented-toggle/segmented-toggle';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';

/** The only two formats the UI offers (Rust also models `'json'`, rejected if ever called). */
type OfferedFormat = 'csv' | 'xlsx';

/**
 * Export transactions (FR-4.2) - desktop-first slice (see the export ADR). Rust reads the ledger,
 * builds the rows, renders CSV/XLSX bytes, and writes them to a path the user picks via the native
 * save dialog; this component only marshals the two calls and presents the result. On Android the
 * save path is deferred (SAF picker not yet wired), so this screen shows an info banner instead of
 * a button that would fail.
 */
@Component({
  selector: 'app-export',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideDownload, Banner, Button, Card, SegmentedToggle, Skeleton],
  templateUrl: './export.html',
  styleUrl: './export.scss',
})
export class Export implements OnInit {
  protected readonly loading = signal(true);
  /** Set ONLY by a failed initial load (`ngOnInit`'s `getAppInfo`/`listTransactions`). Drives the
   *  blocking full-page "Try again" branch, which is appropriate there because nothing loaded. */
  protected readonly loadError = signal<string | null>(null);
  /** Set ONLY by a failed export action (`export()`). Shown as an inline banner INSIDE the
   *  populated state so a failed export never hides the format controls or the plaintext-warning
   *  banner, and never discards the format the user already picked. */
  protected readonly actionError = signal<string | null>(null);
  protected readonly isAndroid = signal(false);
  /** `null` while unknown (still loading); otherwise the number of transactions available. */
  protected readonly transactionCount = signal<number | null>(null);

  protected readonly format = signal<OfferedFormat>('csv');
  protected readonly busy = signal(false);
  /** Guards against a double-tap opening two save dialogs / firing two exports: set synchronously
   *  at the start of `export()`, before awaiting the picker, and cleared in `finally`. */
  private readonly inFlight = signal(false);
  protected readonly savedSummary = signal<ExportSummary | null>(null);

  protected readonly isEmpty = computed(() => this.transactionCount() === 0);
  /** The controls (format + Export) render once we know the platform isn't Android and the initial
   *  load succeeded. Does NOT depend on `actionError` - an export-action failure must not tear down
   *  the controls or the plaintext warning. */
  protected readonly showControls = computed(
    () => !this.loading() && !this.isAndroid() && this.loadError() === null,
  );

  protected readonly formatOptions: SegmentOption[] = [
    { value: 'csv', label: 'CSV (spreadsheet file)' },
    { value: 'xlsx', label: 'Excel (.xlsx)' },
  ];

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
      this.loadError.set('Run the app (npm run tauri dev) to export transactions.');
      return;
    }
    try {
      const info = await getAppInfo();
      if (info.platform === 'android') {
        this.isAndroid.set(true);
        return;
      }
      const txs = await listTransactions();
      this.transactionCount.set(txs.length);
    } catch (e) {
      this.loadError.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected onFormatChange(value: string): void {
    this.format.set(value as OfferedFormat);
  }

  protected async export(): Promise<void> {
    if (this.inFlight() || this.isEmpty()) return;
    this.inFlight.set(true);
    this.actionError.set(null);
    this.savedSummary.set(null);
    try {
      const destPath = await pickExportDestination(this.format());
      if (!destPath) return; // Cancelled: stay on the populated state, no error.
      this.busy.set(true);
      const summary = await exportTransactions(this.format(), destPath);
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
