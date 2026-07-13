import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Import, receiptTotalToBaseMinor } from './import';
import { CurrencyService } from '../../core/money/currency.service';

describe('receiptTotalToBaseMinor', () => {
  it('is the identity for a 2-decimal base currency (MUR/USD)', () => {
    expect(receiptTotalToBaseMinor(13800, 2)).toBe(13800);
  });

  it('scales down for a 0-decimal base currency (JPY) instead of the 100x regression', () => {
    // A printed total of "2000.00" extracts as 200000 (fixed 2-dp scale); the base-currency
    // (JPY, 0 decimals) minor-unit total must be 2000, not 200000.
    expect(receiptTotalToBaseMinor(200000, 0)).toBe(2000);
  });

  it('scales up for a 3-decimal base currency (BHD)', () => {
    expect(receiptTotalToBaseMinor(2000, 3)).toBe(20000);
  });
});

/**
 * Per-field "not detected" flags (issue #55). Constructing the component (without
 * `detectChanges()`) never runs any bridge call - `scan()` only runs on user action - so the test
 * reaches into the private `phase`/`extractedBlank` signals directly to simulate "extraction just
 * completed with a partial result", exactly as `scan()` would set them, and drives the form
 * controls the way the user would. Typed `any` for the same reason as transaction-form.spec.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('Import - per-field low-confidence flags', () => {
  function createComponent(): any {
    TestBed.configureTestingModule({
      imports: [Import],
      providers: [provideRouter([])],
    });
    return TestBed.createComponent(Import).componentInstance;
  }

  it('flags only the fields the extractor left blank (partial extraction), not the all-empty banner', () => {
    const component = createComponent();
    component.phase.set('review');
    component.extractedBlank.set({ merchant: true, date: true, total: false });
    component.form.reset({ merchant: '', date: '', total: '138.00' });

    expect(component.merchantNotDetected()).toBe(true);
    expect(component.dateNotDetected()).toBe(true);
    expect(component.totalNotDetected()).toBe(false);
    // Not all three are blank (total was found), so the severe banner must not fire.
    expect(component.lowConfidence()).toBe(false);
  });

  it('clears a field flag reactively once the user types a value into that field', () => {
    const component = createComponent();
    component.phase.set('review');
    component.extractedBlank.set({ merchant: true, date: false, total: false });
    component.form.reset({ merchant: '', date: '2026-07-11', total: '138.00' });

    expect(component.merchantNotDetected()).toBe(true);

    component.form.controls.merchant.setValue('Winners');

    expect(component.merchantNotDetected()).toBe(false);
  });

  it('still raises the severe all-empty banner when every field is blank', () => {
    const component = createComponent();
    component.phase.set('review');
    component.extractedBlank.set({ merchant: true, date: true, total: true });
    component.form.reset({ merchant: '', date: '', total: '' });

    expect(component.lowConfidence()).toBe(true);
    expect(component.merchantNotDetected()).toBe(true);
    expect(component.dateNotDetected()).toBe(true);
    expect(component.totalNotDetected()).toBe(true);
  });
});

/**
 * Amount-precision cap on the review total (issue #86). The total is always in the BASE currency;
 * constructing the component never runs a bridge call (that only happens on `scan()`), so the tests
 * drive `baseCurrency`/the form control directly and read back the validation + `totalError()`
 * message, the way the review UI does. `CurrencyService`'s Rust-backed table isn't populated in the
 * harness, so the JPY (0dp) case seeds it directly (same approach as currency.service.spec.ts).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('Import - total precision + malformed message', () => {
  function createComponent(): any {
    TestBed.configureTestingModule({
      imports: [Import],
      providers: [provideRouter([])],
    });
    (TestBed.inject(CurrencyService) as any).digitsByCode.set('JPY', 0);
    return TestBed.createComponent(Import).componentInstance;
  }

  it('flags an over-precise total for the base currency (MUR 2dp)', () => {
    const component = createComponent();
    component.baseCurrency.set('MUR');
    const c = component.form.controls.total;
    c.setValue('1.005');
    c.markAsTouched();

    expect(c.hasError('maxFractionDigits')).toBeTrue();
    expect(component.totalError()).toBe('Amounts in MUR use at most 2 decimal places.');
  });

  it('flags any decimal at all for a 0-decimal base currency (JPY)', () => {
    const component = createComponent();
    component.baseCurrency.set('JPY');
    const c = component.form.controls.total;
    c.setValue('1.5');
    c.markAsTouched();

    expect(c.hasError('maxFractionDigits')).toBeTrue();
    expect(component.totalError()).toBe("Amounts in JPY don't use decimal places.");
  });

  it('accepts a trailing-zero total (value-based, like Rust parse_minor)', () => {
    const component = createComponent();
    component.baseCurrency.set('MUR');
    const c = component.form.controls.total;
    c.setValue('12.500');

    expect(c.hasError('maxFractionDigits')).toBeFalse();
  });

  it('explains a malformed total instead of leaving the disabled button a dead end', () => {
    const component = createComponent();
    component.baseCurrency.set('MUR');
    const c = component.form.controls.total;
    c.setValue('1.2.3');
    c.markAsTouched();

    expect(c.hasError('pattern')).toBeTrue();
    expect(c.hasError('maxFractionDigits')).toBeFalse();
    expect(component.totalError()).toBe('Enter the total as a number, for example 12.50.');
  });
});
