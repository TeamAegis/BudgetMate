import { Pipe, PipeTransform } from '@angular/core';
import type { Money } from '../../core/models';

/**
 * Formats integer minor units + currency for display. PRESENTATION ONLY - performs no money
 * arithmetic (all money math stays in Rust, per CLAUDE.md). Uses Intl for locale-aware grouping
 * and the correct minor-unit scale per currency.
 */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: Money | null | undefined, locale?: string): string {
    if (!value) {
      return '';
    }
    // Default currency is MUR ("Rs") per the design system (docs/design/design-system.md §8).
    const { amountMinor, currency = 'MUR' } = value;
    const fmt = new Intl.NumberFormat(locale ?? undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    });
    // Derive minor-unit scale from the currency's fraction digits (e.g. 2 for USD, 0 for JPY).
    const fractionDigits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
    const major = amountMinor / Math.pow(10, fractionDigits);
    return fmt.format(major);
  }
}
