import { Pipe, PipeTransform, inject } from '@angular/core';
import type { Money } from '../../core/models';
import { CurrencyService } from '../../core/money/currency.service';

/**
 * Formats integer minor units + currency for display. PRESENTATION ONLY - performs no money
 * arithmetic (all money math stays in Rust, per CLAUDE.md). Uses Intl for locale-aware grouping;
 * the minor-unit scale per currency comes from `CurrencyService` (Rust is the single source of
 * truth - Intl's own per-currency default digits are NOT authoritative and diverge for some
 * currencies, e.g. IQD).
 */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  private readonly currency = inject(CurrencyService);

  transform(value: Money | null | undefined, signed = false, locale?: string): string {
    if (!value) {
      return '';
    }
    // Default currency is MUR ("Rs") per the design system (docs/design/design-system.md §8).
    const { amountMinor, currency = 'MUR' } = value;
    const digits = this.currency.fractionDigits(currency);
    const fmt = new Intl.NumberFormat(locale ?? undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      // `signed` rows (transactions) show +/- as the non-colour direction cue (issue I3/I4), so the
      // redundant arrow could be dropped; 'exceptZero' keeps a neutral zero unsigned. Presentation
      // only (sign placement is locale-aware), never money math.
      signDisplay: signed ? 'exceptZero' : 'auto',
    });
    const major = amountMinor / Math.pow(10, digits);
    return fmt.format(major);
  }
}
