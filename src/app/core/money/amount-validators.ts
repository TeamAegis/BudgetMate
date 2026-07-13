import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Flags an amount string that carries more fractional precision than its currency allows (e.g.
 * "15.999" for MUR's 2dp, or "1.5" for a 0dp currency such as JPY). Presentation-only, UX-timing
 * validation: Rust's `parse_minor` (`src-tauri/src/domain/money.rs`) is the authoritative check and
 * re-validates on Save regardless - this only catches the mistake earlier, before the round trip.
 *
 * Mirrors `parse_minor`'s VALUE-based semantics: precision is measured on SIGNIFICANT fractional
 * digits (trailing zeros stripped), so a harmless trailing zero that Rust accepts ("1.100" for MUR,
 * "100.00" for JPY) is not rejected here either. Malformed / empty input stays
 * `Validators.pattern(DECIMAL)`'s job - this defers to that so it never misreports a bad number as
 * an over-precision error.
 *
 * `getMax` is a callback (not a fixed number) so the cap can track the currently-selected currency;
 * callers re-run validation (`updateValueAndValidity`) when that currency changes.
 */
export function maxFractionDigits(getMax: () => number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (typeof value !== 'string') return null;
    const s = value.trim();
    // Malformed / empty input is `Validators.pattern(DECIMAL)`'s job, not ours - skip it so we never
    // misreport a bad number as an over-precision error.
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const dot = s.indexOf('.');
    if (dot === -1) return null;
    // Count SIGNIFICANT fractional digits only: Rust's `parse_minor` is value-based and accepts
    // trailing zeros (e.g. "1.100" for MUR, "100.00" for JPY), so mirror that - don't reject a
    // harmless trailing zero.
    const frac = s.slice(dot + 1).replace(/0+$/, '');
    const max = getMax();
    return frac.length > max ? { maxFractionDigits: { max } } : null;
  };
}
