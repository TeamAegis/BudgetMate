import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideScanLine, LucideTriangleAlert } from '@lucide/angular';
import { extractReceipt, pickReceiptImage, getSettings, isTauri } from '../../core/bridge';
import { LockService } from '../../core/lock/lock.service';
import type { TransactionPrefill } from '../../core/models';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Button } from '../../shared/ui/button/button';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { FormField } from '../../shared/ui/form-field/form-field';
import { Spinner } from '../../shared/ui/spinner/spinner';

const DECIMAL = /^\d+(\.\d+)?$/;

/** UI phase of the scan flow. Each maps to one of the five required screen states (design.md). */
type Phase = 'idle' | 'processing' | 'review' | 'unavailable' | 'error';

/**
 * Scan Receipt (FR-2.1 / screens.md §4.4). Smart component: pick a local image → on-device OCR
 * (native ML Kit on Android) → DETERMINISTIC Rust extraction of merchant/date/total → show the
 * suggestions in an editable form → "Use these details" hands them to the manual-entry transaction
 * form, where the user must still confirm and Save. NOTHING is saved here and nothing is
 * auto-committed (design.md "Flows that must never auto-commit"). All money/extraction logic is in
 * Rust; TS only picks the file, formats, and edits the suggested text fields.
 *
 * Heavy work runs off the UI thread (the `extract_receipt` command is async; the Android engine
 * runs on Dispatchers.IO), so the screen stays responsive while `processing`.
 */
@Component({
  selector: 'app-import',
  imports: [
    ReactiveFormsModule,
    MoneyPipe,
    LucideScanLine,
    LucideTriangleAlert,
    Button,
    Banner,
    EmptyState,
    FormField,
    Spinner,
  ],
  templateUrl: './import.html',
  styleUrl: './import.scss',
})
export class Import {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly lockService = inject(LockService);

  protected readonly phase = signal<Phase>('idle');
  protected readonly error = signal<string | null>(null);
  protected readonly baseCurrency = signal('MUR');
  /** Total (minor units) from the extractor, kept aside so the hand-off uses exact integer money. */
  private readonly totalMinor = signal<number | null>(null);
  /** True when extraction ran but found nothing usable — surfaced as a low-confidence hint. */
  protected readonly lowConfidence = computed(
    () =>
      this.phase() === 'review' &&
      !this.form.controls.merchant.value &&
      !this.form.controls.date.value &&
      this.totalMinor() === null,
  );

  /** Editable suggested fields. The user can correct OCR before handing off; Rust re-parses on save. */
  protected readonly form = this.fb.nonNullable.group({
    merchant: this.fb.nonNullable.control(''),
    date: this.fb.nonNullable.control(''),
    total: this.fb.nonNullable.control('', Validators.pattern(DECIMAL)),
  });

  /** Money preview for the read-only "extracted total" chip (display only — no TS money math). */
  protected readonly totalPreview = computed(() => {
    const minor = this.totalMinor();
    return minor === null ? null : { amountMinor: minor, currency: this.baseCurrency() };
  });

  /** Pick a local image and run on-device OCR + deterministic extraction. */
  protected async scan(): Promise<void> {
    if (!isTauri()) {
      this.phase.set('error');
      this.error.set('Run the app (npm run tauri dev) to scan a receipt.');
      return;
    }
    this.error.set(null);
    let path: string | null;
    // The native picker backgrounds the WebView; flag it as a trusted excursion so the
    // visibility listener doesn't lock the vault mid-pick (and kill the scan flow).
    this.lockService.beginTrustedExcursion();
    try {
      path = await pickReceiptImage();
    } catch (e) {
      this.phase.set('error');
      this.error.set(String(e));
      return;
    } finally {
      this.lockService.endTrustedExcursion();
    }
    if (!path) return; // cancelled — stay on the current phase

    this.phase.set('processing');
    try {
      const [result, settings] = await Promise.all([extractReceipt(path), getSettings()]);
      this.baseCurrency.set(settings.baseCurrency);
      if (!result.engineAvailable) {
        this.phase.set('unavailable');
        return;
      }
      const f = result.fields;
      this.totalMinor.set(f.totalMinor);
      this.form.reset({
        merchant: f.merchant ?? '',
        date: f.date ?? '',
        // Show the total as an editable major-unit string; Rust re-parses + signs it on save.
        total: f.totalMinor != null ? this.majorAmount(f.totalMinor) : '',
      });
      this.phase.set('review');
    } catch (e) {
      this.phase.set('error');
      this.error.set(String(e));
    }
  }

  /** Hand the (possibly edited) suggestions to the manual-entry form. The user confirms + Saves there. */
  protected use(): void {
    const v = this.form.getRawValue();
    // Prefer the user-edited total when it parses; fall back to the extractor's exact minor units.
    const editedMinor = this.toMinor(v.total);
    const prefill: TransactionPrefill = {
      payee: v.merchant.trim() || null,
      postedDate: v.date.trim() || null,
      totalMinor: editedMinor ?? this.totalMinor(),
      currency: this.baseCurrency(),
    };
    void this.router.navigate(['/expenses'], { state: { transactionPrefill: prefill } });
  }

  /** Discard the scan and start over. */
  protected reset(): void {
    this.phase.set('idle');
    this.error.set(null);
    this.totalMinor.set(null);
    this.form.reset({ merchant: '', date: '', total: '' });
  }

  /** Skip OCR entirely and enter a transaction by hand (empty prefill = a plain Add modal). */
  protected manualEntry(): void {
    void this.router.navigate(['/expenses']);
  }

  /** Exact major-unit string for the 2-dp extractor total (display/edit only — no money math). */
  private majorAmount(minor: number): string {
    return (Math.abs(minor) / 100).toFixed(2);
  }

  /** Parse the edited major-unit total back to minor units (2-dp); null if invalid/blank. */
  private toMinor(s: string): number | null {
    const t = s.trim();
    if (!DECIMAL.test(t)) return null;
    const [intPart, fracRaw = ''] = t.split('.');
    if (fracRaw.length > 2) return null;
    const frac = (fracRaw + '00').slice(0, 2);
    return Number(intPart) * 100 + Number(frac);
  }
}
