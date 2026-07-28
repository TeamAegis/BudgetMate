import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter, convertToParamMap } from '@angular/router';
import { TransactionForm } from './transaction-form';
import { CurrencyService } from '../../core/money/currency.service';
import type {
  Account,
  AllowanceSummary,
  Category,
  Transaction,
  TransactionPrefill,
  VaultSettings,
} from '../../core/models';

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
 * `CurrencyService` normally caches its minor-unit-digit table from Rust at app bootstrap
 * (app.config.ts); that initializer never runs here, so the JPY case seeds the service's cache
 * directly (same reflection approach as `currency.service.spec.ts`) rather than mocking the bridge.
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
    // Seed the 0-decimal JPY exception the real Rust-backed table carries; the app-bootstrap
    // initializer that would normally populate this doesn't run in the test harness.
    (TestBed.inject(CurrencyService) as any).digitsByCode.set('JPY', 0);
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

/**
 * Regression coverage for issue #86 (client-side amount precision cap). Rust's `parse_minor` already
 * rejects an over-precise amount on Save (`MoneyParseError::TooPrecise`) - this only checks the
 * `maxFractionDigits` validator is actually wired to the `amount` control for the selected currency,
 * catching the mistake before the round trip. Same construction pattern as the suite above (no
 * `ngOnInit`, so no bridge call happens).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('TransactionForm - amount precision cap', () => {
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
    (TestBed.inject(CurrencyService) as any).digitsByCode.set('JPY', 0);
    return TestBed.createComponent(TransactionForm).componentInstance;
  }

  it('flags an amount with more decimal places than MUR (2dp) allows', () => {
    const component = createComponent();
    component.form.controls.currency.setValue('MUR');
    component.form.controls.amount.setValue('1.005');

    expect(component.form.controls.amount.hasError('maxFractionDigits')).toBeTrue();
  });

  it('flags any decimal at all for a 0-decimal currency (JPY)', () => {
    const component = createComponent();
    component.form.controls.currency.setValue('JPY');
    component.form.controls.amount.setValue('1.5');

    expect(component.form.controls.amount.hasError('maxFractionDigits')).toBeTrue();
  });

  it('accepts an amount within the currency cap', () => {
    const component = createComponent();
    component.form.controls.currency.setValue('MUR');
    component.form.controls.amount.setValue('1.99');

    expect(component.form.controls.amount.hasError('maxFractionDigits')).toBeFalse();
  });
});

/**
 * Regression coverage for issue #124's fix-up (allowance-tagging wiring, FR-3.4): the picker side
 * (`allowance-picker.spec.ts`) is already covered - this covers the form side, which had no tests.
 * `patchFromTransaction`/`patchFromResume` are exercised directly (same construction pattern as the
 * `patchForCreate` suite above - constructing never runs `ngOnInit`, so no bridge call happens).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('TransactionForm - allowanceId patch/resume (FR-3.4)', () => {
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
    (TestBed.inject(CurrencyService) as any).digitsByCode.set('JPY', 0);
    return TestBed.createComponent(TransactionForm).componentInstance;
  }

  function tx(overrides: Partial<Transaction> = {}): Transaction {
    return {
      id: 7,
      accountId: 1,
      postedDate: '2026-07-01',
      amountMinor: -1_00000,
      currency: 'MUR',
      fxRate: '1',
      baseAmountMinor: -1_00000,
      payee: 'Winners',
      note: null,
      source: 'manual',
      sourceRef: null,
      pendingReview: false,
      createdAt: '2026-07-01T00:00:00Z',
      allowanceId: null,
      splits: [{ id: 1, categoryId: 10, categoryName: 'Groceries', amountMinor: -1_00000 }],
      ...overrides,
    };
  }

  it('patchFromTransaction sets allowanceId() to the loaded transaction tag', () => {
    const component = createComponent();
    component.patchFromTransaction(tx({ allowanceId: 3 }));
    expect(component.allowanceId()).toBe(3);
  });

  it('patchFromTransaction sets allowanceId() to null for an untagged transaction', () => {
    const component = createComponent();
    component.patchFromTransaction(tx({ allowanceId: null }));
    expect(component.allowanceId()).toBeNull();
  });

  it('patchFromResume defaults allowanceId to null when the resumed snapshot omits it', () => {
    const component = createComponent();
    // Deliberately omits `allowanceId` (cast past the type) to exercise the runtime `?? null`
    // default in `patchFromResume`, not just the compile-time contract.
    const snapshot = {
      accountId: 1,
      postedDate: '2026-07-01',
      amount: '10.00',
      currency: 'MUR',
      fxRate: '1',
      payee: '',
      note: '',
      splits: [{ categoryId: 10, amount: '10.00' }],
    } as any;
    component.patchFromResume(snapshot);
    expect(component.allowanceId()).toBeNull();
  });

  it('patchFromResume carries an explicit allowanceId through unchanged', () => {
    const component = createComponent();
    const snapshot = {
      accountId: 1,
      postedDate: '2026-07-01',
      amount: '10.00',
      currency: 'MUR',
      fxRate: '1',
      payee: '',
      note: '',
      splits: [{ categoryId: 10, amount: '10.00' }],
      allowanceId: 5,
    };
    component.patchFromResume(snapshot);
    expect(component.allowanceId()).toBe(5);
  });
});

/**
 * Regression coverage for issue #124's fix-up: `save()` must send `allowanceId` as an EXPLICIT key
 * (null when untagged/cleared, never omitted) for both create and update. Same
 * `__TAURI_INTERNALS__.invoke` stubbing approach as `allowance-form.spec.ts` (the bridge wrappers are
 * named ES-module exports Jasmine's `spyOn` cannot redefine), so `ngOnInit` exercises the real bridge
 * code path end to end.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('TransactionForm - save() allowanceId wiring (FR-3.4)', () => {
  afterEach(() => {
    delete (globalThis as any).__TAURI_INTERNALS__;
  });

  const accounts: Account[] = [
    { id: 1, name: 'Wallet', accountType: 'cash', currency: 'MUR', openingBalanceMinor: 0, archived: false },
  ];
  const categories: Category[] = [
    { id: 10, name: 'Groceries', parentId: null, kind: 'expense', archived: false },
  ];
  const settings: VaultSettings = {
    idleTimeoutSecs: 300,
    biometricEnabled: false,
    baseCurrency: 'MUR',
    dedupWindowDays: 3,
  };

  function allowanceSummary(overrides: Partial<AllowanceSummary> = {}): AllowanceSummary {
    return {
      allowances: [],
      totalMinor: 0,
      reservedMinor: 0,
      availableMinor: 0,
      baseCurrency: 'MUR',
      excludedAllowances: 0,
      ...overrides,
    };
  }

  function tx(overrides: Partial<Transaction> = {}): Transaction {
    return {
      id: 7,
      accountId: 1,
      postedDate: '2026-07-01',
      amountMinor: -1_00000,
      currency: 'MUR',
      fxRate: '1',
      baseAmountMinor: -1_00000,
      payee: 'Winners',
      note: null,
      source: 'manual',
      sourceRef: null,
      pendingReview: false,
      createdAt: '2026-07-01T00:00:00Z',
      allowanceId: null,
      splits: [{ id: 1, categoryId: 10, categoryName: 'Groceries', amountMinor: -1_00000 }],
      ...overrides,
    };
  }

  function stubInvoke(handlers: Record<string, (args: unknown) => unknown>): void {
    (globalThis as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: unknown) => {
        const h = handlers[cmd];
        if (!h) throw new Error(`unexpected invoke in test: ${cmd}`);
        return h(args);
      },
    };
  }

  async function createForm(
    routeParams: Record<string, string>,
    handlers: Record<string, (args: unknown) => unknown>,
  ) {
    stubInvoke({
      list_accounts: () => accounts,
      list_categories: () => categories,
      list_allowances: () => allowanceSummary(),
      get_settings: () => settings,
      ...handlers,
    });
    await TestBed.configureTestingModule({
      imports: [TransactionForm],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap(routeParams) } },
        },
      ],
    }).compileComponents();
    (TestBed.inject(CurrencyService) as any).digitsByCode.set('JPY', 0);
    const fixture = TestBed.createComponent(TransactionForm);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('create: sends allowanceId: null (present, not omitted) for an untagged transaction', async () => {
    let created: any;
    const fixture = await createForm(
      { kind: 'expense', categoryId: '10' },
      { create_transaction: (args) => ((created = args), tx()) },
    );
    const component = fixture.componentInstance as any;
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate');
    component.form.controls.amount.setValue('10.00');

    await component.save();

    expect(created).toBeTruthy();
    expect('allowanceId' in created.tx).toBeTrue();
    expect(created.tx.allowanceId).toBeNull();
    expect(navSpy).toHaveBeenCalledWith(['/expenses']);
  });

  it('create: sends the tagged allowanceId when one was picked', async () => {
    let created: any;
    const fixture = await createForm(
      { kind: 'expense', categoryId: '10' },
      { create_transaction: (args) => ((created = args), tx({ allowanceId: 3 })) },
    );
    const component = fixture.componentInstance as any;
    spyOn(TestBed.inject(Router), 'navigate');
    component.form.controls.amount.setValue('10.00');
    component.allowanceId.set(3);

    await component.save();

    expect(created.tx.allowanceId).toBe(3);
  });

  it('update: sends allowanceId: null (present, not omitted) after clearing a previously tagged allowance', async () => {
    let updated: any;
    const loaded = tx({ id: 7, allowanceId: 3 });
    const fixture = await createForm(
      { id: '7' },
      {
        list_transactions: () => [loaded],
        update_transaction: (args) => ((updated = args), loaded),
      },
    );
    const component = fixture.componentInstance as any;
    spyOn(TestBed.inject(Router), 'navigate');
    expect(component.allowanceId()).toBe(3); // loaded from the fetched transaction

    component.allowanceId.set(null); // user clears the tag via AllowancePicker's "None" row

    await component.save();

    expect(updated).toBeTruthy();
    expect('allowanceId' in updated.tx).toBeTrue();
    expect(updated.tx.allowanceId).toBeNull();
  });

  it('update: keeps sending the tagged allowanceId when it was not changed', async () => {
    let updated: any;
    const loaded = tx({ id: 7, allowanceId: 3 });
    const fixture = await createForm(
      { id: '7' },
      {
        list_transactions: () => [loaded],
        update_transaction: (args) => ((updated = args), loaded),
      },
    );
    const component = fixture.componentInstance as any;
    spyOn(TestBed.inject(Router), 'navigate');

    await component.save();

    expect(updated.tx.allowanceId).toBe(3);
  });
});
