import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideScanLine, LucideTriangleAlert } from '@lucide/angular';
import { extractReceipt, pickReceiptImage, getSettings, isTauri } from '../../core/bridge';
import { LockService } from '../../core/lock/lock.service';
import { CurrencyService } from '../../core/money/currency.service';
import { maxFractionDigits } from '../../core/money/amount-validators';
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
 * The receipt extractor returns `totalMinor` in a fixed 2-decimal scale (printedValue * 100).
 * Re-express it in the base currency's minor-unit scale so the hand-off prefill (which declares
 * the base currency) and the money-chip preview are correct for 0- and 3-decimal currencies too.
 * The user always confirms the value on the next step, and Rust re-parses authoritatively on Save.
 */
export function receiptTotalToBaseMinor(extractorMinor: number, baseDigits: number): number {
  return Math.round((extractorMinor * Math.pow(10, baseDigits)) / 100);
}

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
  private readonly currency = inject(CurrencyService);

  protected readonly phase = signal<Phase>('idle');
  protected readonly error = signal<string | null>(null);
  protected readonly baseCurrency = signal('MUR');
  /** Total in BASE-currency minor units (rescaled from the extractor's fixed 2-dp output). */
  private readonly totalMinor = signal<number | null>(null);
  /**
   * Snapshot, taken right after extraction, of which fields the extractor returned nothing for.
   * Per-field "not detected" flags (below) derive from this plus the live control value, so a flag
   * clears reactively once the user types something into that field - it never re-flags a field the
   * extractor actually found just because the user later clears it (ux-blueprint.md §5).
   */
  private readonly extractedBlank = signal({ merchant: false, date: false, total: false });

  /** Editable suggested fields. The user can correct OCR before handing off; Rust re-parses on save. */
  protected readonly form = this.fb.nonNullable.group({
    merchant: this.fb.nonNullable.control(''),
    date: this.fb.nonNullable.control(''),
    total: this.fb.nonNullable.control('', [
      Validators.pattern(DECIMAL),
      maxFractionDigits(() => this.fractionDigits(this.baseCurrency())),
    ]),
  });

  // Reactive mirrors of the control values (form.reset(...) emits valueChanges, so the initial
  // extracted values flow through) - used only to drive the per-field flags below.
  private readonly merchantValue = toSignal(this.form.controls.merchant.valueChanges, {
    initialValue: '',
  });
  private readonly dateValue = toSignal(this.form.controls.date.valueChanges, { initialValue: '' });
  private readonly totalValue = toSignal(this.form.controls.total.valueChanges, {
    initialValue: '',
  });

  /** Per-field "not detected" attention flags (ux-blueprint.md §5) - advisory, clears on typing. */
  protected readonly merchantNotDetected = computed(
    () => this.phase() === 'review' && this.extractedBlank().merchant && !this.merchantValue().trim(),
  );
  protected readonly dateNotDetected = computed(
    () => this.phase() === 'review' && this.extractedBlank().date && !this.dateValue().trim(),
  );
  protected readonly totalNotDetected = computed(
    () => this.phase() === 'review' && this.extractedBlank().total && !this.totalValue().trim(),
  );

  /** True when extraction ran but found nothing usable at all - the severe all-empty banner. */
  protected readonly lowConfidence = computed(
    () =>
      this.phase() === 'review' &&
      this.extractedBlank().merchant &&
      this.extractedBlank().date &&
      this.extractedBlank().total,
  );

  /** Money preview for the read-only "extracted total" chip (display only - no TS money math). */
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
    if (!path) return; // cancelled - stay on the current phase

    this.phase.set('processing');
    try {
      const [result, settings] = await Promise.all([extractReceipt(path), getSettings()]);
      this.baseCurrency.set(settings.baseCurrency);
      if (!result.engineAvailable) {
        this.phase.set('unavailable');
        return;
      }
      const f = result.fields;
      const digits = this.fractionDigits(settings.baseCurrency);
      const baseMinor = f.totalMinor != null ? receiptTotalToBaseMinor(f.totalMinor, digits) : null;
      this.totalMinor.set(baseMinor);
      this.extractedBlank.set({
        merchant: !f.merchant,
        date: !f.date,
        total: baseMinor === null,
      });
      this.form.reset({
        merchant: f.merchant ?? '',
        date: f.date ?? '',
        // Show the total as an editable major-unit string; Rust re-parses + signs it on save.
        total: baseMinor != null ? this.majorAmount(baseMinor) : '',
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
    // Straight to the entry form (kind defaults to expense, category not yet chosen: `0`); the form
    // applies the prefill and suggests a category from the payee. The two-step picker is skipped
    // here because OCR already carries the figures the user is confirming.
    void this.router.navigate(['/expenses/new', 'expense', 0], {
      state: { transactionPrefill: prefill },
    });
  }

  /** Discard the scan and start over. */
  protected reset(): void {
    this.phase.set('idle');
    this.error.set(null);
    this.totalMinor.set(null);
    this.extractedBlank.set({ merchant: false, date: false, total: false });
    this.form.reset({ merchant: '', date: '', total: '' });
  }

  /** Skip OCR entirely and enter a transaction by hand, starting at the kind chooser (step 1a). */
  protected manualEntry(): void {
    void this.router.navigate(['/expenses/new']);
  }

  /** Minor-unit digits for a currency (Rust's authoritative table, same one the money pipe uses). */
  private fractionDigits(currency: string): number {
    return this.currency.fractionDigits(currency);
  }

  /**
   * Inline message for the total field (base currency; touched + invalid only). The total is NOT
   * required (OCR may not detect one), so there is no "required" branch - but a malformed non-blank
   * value must still be explained, or the disabled "Use these details" button becomes a dead end.
   */
  protected totalError(): string | null {
    const c = this.form.controls.total;
    if (!c.invalid || !c.touched) return null;
    if (c.hasError('maxFractionDigits')) {
      const cur = this.baseCurrency();
      const max = this.fractionDigits(cur);
      if (max === 0) return `Amounts in ${cur} don't use decimal places.`;
      return `Amounts in ${cur} use at most ${max} decimal place${max === 1 ? '' : 's'}.`;
    }
    if (c.hasError('pattern')) return 'Enter the total as a number, for example 12.50.';
    return null;
  }

  /** Exact major-unit string for a base-currency minor-unit total (display/edit only - no money math). */
  private majorAmount(minor: number): string {
    const digits = this.fractionDigits(this.baseCurrency());
    return (Math.abs(minor) / Math.pow(10, digits)).toFixed(digits);
  }

  /** Parse the edited major-unit total back to base-currency minor units; null if invalid/blank. */
  private toMinor(s: string): number | null {
    const t = s.trim();
    if (!DECIMAL.test(t)) return null;
    const digits = this.fractionDigits(this.baseCurrency());
    const [intPart, fracRaw = ''] = t.split('.');
    if (fracRaw.length > digits) return null;
    const frac = (fracRaw + '0'.repeat(digits)).slice(0, digits);
    return Number(intPart) * Math.pow(10, digits) + Number(frac || '0');
  }
}
