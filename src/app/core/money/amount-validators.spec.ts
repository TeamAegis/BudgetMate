import { FormControl } from '@angular/forms';
import { maxFractionDigits } from './amount-validators';

describe('maxFractionDigits', () => {
  it('is valid when the value has no decimal point', () => {
    const validator = maxFractionDigits(() => 2);
    expect(validator(new FormControl('150'))).toBeNull();
  });

  it('is valid when within the cap', () => {
    const validator = maxFractionDigits(() => 2);
    expect(validator(new FormControl('1.05'))).toBeNull();
  });

  it('flags a value with more fractional digits than the cap', () => {
    const validator = maxFractionDigits(() => 2);
    expect(validator(new FormControl('1.005'))).toEqual({ maxFractionDigits: { max: 2 } });
  });

  it('flags any decimal at all for a 0-decimal currency (e.g. JPY)', () => {
    const validator = maxFractionDigits(() => 0);
    expect(validator(new FormControl('1.5'))).toEqual({ maxFractionDigits: { max: 0 } });
  });

  it('is valid for an empty string (Validators.required owns that case)', () => {
    const validator = maxFractionDigits(() => 2);
    expect(validator(new FormControl(''))).toBeNull();
  });

  it('reads the callback fresh on every call, so the cap can track the selected currency', () => {
    let max = 2;
    const validator = maxFractionDigits(() => max);
    expect(validator(new FormControl('1.005'))).toEqual({ maxFractionDigits: { max: 2 } });
    max = 3;
    expect(validator(new FormControl('1.005'))).toBeNull();
  });
});
