import { Pipe, PipeTransform, inject } from '@angular/core';
import type { Money } from '../../core/models';
import { CurrencyService } from '../../core/money/currency.service';

/**
 * Formats integer minor units + currency for display. PRESENTATION ONLY - performs no money
 * arithmetic (all money math stays in Rust, per CLAUDE.md). Uses Intl for locale-aware grouping;
 * the minor-unit scale per currency comes from `CurrencyService` (Rust is the single source of
 * truth - Intl's own per-currency default digits are NOT authoritative and diverge for some
 * currencies, e.g. IQD).
 *
 * Three display corrections per docs/design/design-system.md §8 / docs/financial-knowledge.md §8:
 * - MUR renders deterministically as "Rs" (Intl's `narrowSymbol` delegates to the WebView's ICU
 *   data, which falls back to the ISO code "MUR" on stripped/older Android System WebViews). We
 *   format with the deterministic `currencyDisplay: 'code'` for mapped currencies, then swap the
 *   ISO code token for the display glyph - a text substitution on the formatted string, not a
 *   money calculation.
 * - Whole amounts drop the decimals ("Rs 30,000" not "Rs 30,000.00"); fractional amounts keep the
 *   currency's full digit count.
 * - Grouping/decimal separators are pinned to a fixed `'en-US'` anchor whenever no explicit
 *   `locale` is passed, so formatting is comma-thousands / period-decimal deterministically
 *   regardless of the device/WebView locale (a French-locale device would otherwise render
 *   "30 000,50" instead of the §8-mandated "30,000.50"). Pass `locale` explicitly to override.
 */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  private readonly currency = inject(CurrencyService);

  // Display glyph overrides for currencies whose ICU narrow symbol is unreliable on Android
  // System WebView. Presentation only - not a currency scale/rate table.
  private static readonly SYMBOLS: Record<string, string> = { MUR: 'Rs' };

  transform(value: Money | null | undefined, signed = false, locale?: string): string {
    if (!value) {
      return '';
    }
    // Default currency is MUR ("Rs") per the design system (docs/design/design-system.md §8).
    const { amountMinor, currency = 'MUR' } = value;
    const code = currency.toUpperCase();
    const symbol = MoneyPipe.SYMBOLS[code];
    const digits = this.currency.fractionDigits(currency);
    const scale = Math.pow(10, digits);
    const whole = amountMinor % scale === 0;
    // Pin the locale to a fixed anchor when the caller doesn't pass one explicitly, so grouping
    // and decimal separators stay deterministic regardless of device/WebView locale (see JSDoc).
    const fmt = new Intl.NumberFormat(locale ?? 'en-US', {
      style: 'currency',
      currency,
      currencyDisplay: symbol ? 'code' : 'narrowSymbol',
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: digits,
      // `signed` rows (transactions) show +/- as the non-colour direction cue (issue I3/I4), so the
      // redundant arrow could be dropped; 'exceptZero' keeps a neutral zero unsigned. Presentation
      // only (sign placement is locale-aware), never money math.
      signDisplay: signed ? 'exceptZero' : 'auto',
    });
    const major = amountMinor / scale;
    const formatted = fmt.format(major);
    return symbol ? formatted.replace(code, symbol) : formatted;
  }
}
