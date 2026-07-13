import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Flags an amount string with more fractional digits than its currency allows (e.g. "15.999" for
 * MUR's 2dp, or "1.5" for a 0dp currency such as JPY). Presentation-only, UX-timing validation:
 * Rust's `parse_minor` is the authoritative check and re-validates on Save regardless (this only
 * catches the mistake earlier, before the round trip). Never re-checks malformed input - that stays
 * `Validators.pattern(DECIMAL)`'s job - this only measures precision once a decimal point is present.
 *
 * `getMax` is a callback (not a fixed number) so the cap can track the currently-selected currency;
 * callers re-run validation (`updateValueAndValidity`) when that currency changes.
 */
export function maxFractionDigits(getMax: () => number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (typeof value !== 'string' || !value.trim()) return null;
    const dot = value.indexOf('.');
    if (dot === -1) return null;
    const fractionDigits = value.length - dot - 1;
    const max = getMax();
    return fractionDigits > max ? { maxFractionDigits: { max } } : null;
  };
}
