import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, convertToParamMap } from '@angular/router';
import { TransactionForm } from './transaction-form';
import type { Account, TransactionPrefill } from '../../core/models';

/**
 * Regression coverage for the multi-currency OCR prefill boundary (`patchForCreate`). The bridge
 * calls in `ngOnInit` (listAccounts/listCategories/getSettings, gated by `isTauri()`) cannot be
 * mocked here: they are named exports of `core/bridge`, and Jasmine's `spyOn` cannot redefine a
 * property on an ES module namespace object ("is not declared writable or has no setter"). So each
 * test constructs the component (which never runs `ngOnInit` unless `detectChanges()` is called),
 * seeds the `accounts`/`baseCurrency` signals directly, and invokes the private `patchForCreate`
 * exactly as `ngOnInit` would on the create route with an OCR hand-off - this exercises the real
 * method the reviewers flagged, without touching production code to make it testable.
 *
 * `createComponent` deliberately returns `any` so the tests can reach the protected/private
 * `form`/`accounts`/`baseCurrency`/`patchForCreate` members from outside the class.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('TransactionForm - patchForCreate multi-currency prefill', () => {
  function createComponent(): any {
    TestBed.configureTestingModule({
      imports: [TransactionForm],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ kind: 'expense', categoryId: '0' }) },
          },
        },
      ],
    });
    // Constructing does not run ngOnInit (only `detectChanges()` does), so no bridge call happens.
    // Typed `any`: the test reaches into protected/private members (`form`, `accounts`,
    // `baseCurrency`, `patchForCreate`) deliberately - see the file doc above.
    return TestBed.createComponent(TransactionForm).componentInstance;
  }

  it('same-currency prefill: renders the amount and currency as printed (MUR account, MUR prefill)', () => {
    const accounts: Account[] = [
      { id: 1, name: 'Wallet', accountType: 'cash', currency: 'MUR', openingBalanceMinor: 0, archived: false },
    ];
    const prefill: TransactionPrefill = {
      totalMinor: 138_00,
      currency: 'MUR',
      payee: 'Winners',
      postedDate: '2026-06-05',
    };
    const component = createComponent();
    component.accounts.set(accounts);
    component.baseCurrency.set('MUR');

    component.patchForCreate(prefill);

    expect(component.form.controls.amount.value).toBe('138.00');
    expect(component.form.controls.currency.value).toBe('MUR');
    expect(component.form.controls.accountId.value).toBe(1);
  });

  it('base != first-account currency: honors prefill.currency instead of reinterpreting against the default account (JPY prefill, USD-only accounts)', () => {
    const accounts: Account[] = [
      { id: 2, name: 'US card', accountType: 'bank', currency: 'USD', openingBalanceMinor: 0, archived: false },
    ];
    const prefill: TransactionPrefill = {
      totalMinor: 2000,
      currency: 'JPY',
      payee: 'Tokyo Store',
      postedDate: '2026-06-06',
    };
    const component = createComponent();
    component.accounts.set(accounts);
    component.baseCurrency.set('MUR');

    component.patchForCreate(prefill);

    // 0-decimal JPY: 2000 minor units is "2000", not the 100x-too-large "20.00" you get by
    // reinterpreting 2000 against the 2-decimal USD account (today's regression).
    expect(component.form.controls.amount.value).toBe('2000');
    expect(component.form.controls.currency.value).toBe('JPY');
    // No account holds JPY, so the account falls back to the first one (unchanged behaviour) -
    // only the currency/amount decoding must honor the prefill.
    expect(component.form.controls.accountId.value).toBe(2);
  });
});
