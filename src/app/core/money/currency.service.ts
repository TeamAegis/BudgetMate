import { Injectable } from '@angular/core';
import { currencyMinorUnits, isTauri } from '../bridge';

/**
 * Currency minor-unit-digit lookup (e.g. 2 for MUR/USD, 0 for JPY, 3 for IQD/BHD). Rust is the
 * single source of truth (`domain::money::CurrencyMinorUnits`) - this service caches the table
 * fetched once over the bridge and never hardcodes per-currency digit knowledge itself (CLAUDE.md:
 * all money math/scale lives in Rust; TS only formats and presents).
 */
@Injectable({ providedIn: 'root' })
export class CurrencyService {
  private defaultDigits = 2;
  private readonly digitsByCode = new Map<string, number>();
  private loaded = false;

  /** Fetch + cache the canonical table once. Best-effort: keeps the safe 2-digit default on failure. */
  async load(): Promise<void> {
    if (this.loaded || !isTauri()) return;
    try {
      const table = await currencyMinorUnits();
      this.defaultDigits = table.defaultDigits;
      this.digitsByCode.clear();
      for (const e of table.exceptions) this.digitsByCode.set(e.currency, e.digits);
      this.loaded = true;
    } catch {
      // Best-effort: keep the safe 2-digit default if the core can't answer (e.g. locked).
    }
  }

  /** Minor-unit digit count for `currency` (falls back to the default when unknown/not yet loaded). */
  fractionDigits(currency: string): number {
    return this.digitsByCode.get(currency.toUpperCase()) ?? this.defaultDigits;
  }
}
