import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, convertToParamMap } from '@angular/router';
import { GoalForm } from './goal-form';
import { CurrencyService } from '../../core/money/currency.service';

/**
 * Amount-precision cap on the goal target/current amounts (issue #86). Rust's `parse_minor` already
 * rejects an over-precise amount on Save (`MoneyParseError::TooPrecise`) - this only checks the
 * `maxFractionDigits` validator is wired to both controls, keyed on the goal's own currency field,
 * catching the mistake before the round trip. Same construction pattern as transaction-form.spec.ts:
 * constructing the component does not run `ngOnInit` (only `detectChanges()` would), so no bridge
 * call happens. `CurrencyService`'s Rust-backed table isn't populated in the harness, so the JPY
 * (0dp) case seeds it directly (same approach as currency.service.spec.ts).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('GoalForm - amount precision cap', () => {
  function createComponent(): any {
    TestBed.configureTestingModule({
      imports: [GoalForm],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({}) } },
        },
      ],
    });
    (TestBed.inject(CurrencyService) as any).digitsByCode.set('JPY', 0);
    return TestBed.createComponent(GoalForm).componentInstance;
  }

  it('flags an over-precise target/current for MUR (2dp)', () => {
    const component = createComponent();
    component.form.controls.currency.setValue('MUR');
    component.form.controls.target.setValue('1.005');
    component.form.controls.current.setValue('1.005');

    expect(component.form.controls.target.hasError('maxFractionDigits')).toBeTrue();
    expect(component.form.controls.current.hasError('maxFractionDigits')).toBeTrue();
  });

  it('flags any decimal at all for a 0-decimal currency (JPY)', () => {
    const component = createComponent();
    component.form.controls.currency.setValue('JPY');
    component.form.controls.target.setValue('1.5');

    expect(component.form.controls.target.hasError('maxFractionDigits')).toBeTrue();
  });

  it('accepts a trailing-zero value within the cap (value-based, like Rust parse_minor)', () => {
    const component = createComponent();
    component.form.controls.currency.setValue('MUR');
    component.form.controls.target.setValue('1.500');

    expect(component.form.controls.target.hasError('maxFractionDigits')).toBeFalse();
  });
});
