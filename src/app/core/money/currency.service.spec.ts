import { TestBed } from '@angular/core/testing';
import { CurrencyService } from './currency.service';

/**
 * `currencyMinorUnits`/`isTauri` are named exports of `core/bridge`, and Jasmine's `spyOn` cannot
 * redefine a property on an ES module namespace object here ("is not declared writable or has no
 * setter") - see `transaction-form.spec.ts` for the same constraint. So the "table loaded" case
 * below drives the service's own private state directly (bracket access), exercising the exact
 * `fractionDigits` lookup `load()` would populate, without touching production code to make it
 * artificially mockable.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('CurrencyService', () => {
  let service: CurrencyService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CurrencyService);
  });

  it('defaults to 2 digits before load()', () => {
    expect(service.fractionDigits('USD')).toBe(2);
    expect(service.fractionDigits('IQD')).toBe(2);
  });

  it('load() is inert outside the Tauri runtime (no __TAURI_INTERNALS__ in Karma)', async () => {
    await service.load();
    expect(service.fractionDigits('USD')).toBe(2);
    expect(service.fractionDigits('IQD')).toBe(2);
  });

  it('fractionDigits() consults the cached table once populated (as load() would from Rust)', () => {
    const s = service as any;
    s.defaultDigits = 2;
    s.digitsByCode.set('IQD', 3);
    s.digitsByCode.set('JPY', 0);

    expect(service.fractionDigits('IQD')).toBe(3);
    expect(service.fractionDigits('JPY')).toBe(0);
    expect(service.fractionDigits('USD')).toBe(2);
    // Lookup is case-insensitive (matches how currencies are stored/entered).
    expect(service.fractionDigits('iqd')).toBe(3);
  });
});
