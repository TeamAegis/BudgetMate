import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter, convertToParamMap } from '@angular/router';
import { TransactionForm } from './transaction-form';
import { CurrencyService } from '../../core/money/currency.service';
import type { Account, Category, Allowance, Transaction, TransactionPrefill } from '../../core/models';

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
      { id: 1, name: 'Wallet', accountType: 'cash', currency: 'MUR', openingBalanceMinor: 0, archived: false, balanceMinor: 0 },
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
      { id: 2, name: 'US card', accountType: 'bank', currency: 'USD', openingBalanceMinor: 0, archived: false, balanceMinor: 0 },
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
 * Coverage for the FR-3.4 optional allowance tag on a transaction: the `allowanceId` control, the
 * `allowanceOptions` computed (leading "not tagged" sentinel + every fetched allowance), and the
 * `save()` payload mapping (sentinel `0` -> `null`, edit-load `t.allowanceId ?? 0`). `listAllowances`
 * and the other bridge calls this form makes in `ngOnInit` are named ES-module exports Jasmine's
 * `spyOn` cannot redefine (same limitation the file doc above and allowance-form.spec.ts note), so
 * these tests stub the actual Tauri IPC seam (`window.__TAURI_INTERNALS__.invoke`) and let
 * `ngOnInit`/`save()` run for real.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('TransactionForm - allowance tagging (FR-3.4)', () => {
  afterEach(() => {
    delete (globalThis as any).__TAURI_INTERNALS__;
  });

  function account(): Account {
    return { id: 1, name: 'Wallet', accountType: 'cash', currency: 'MUR', openingBalanceMinor: 0, archived: false, balanceMinor: 0 };
  }
  function category(): Category {
    return { id: 1, name: 'Groceries', parentId: null, kind: 'expense', archived: false };
  }
  function allowance(overrides: Partial<Allowance> = {}): Allowance {
    return {
      id: 2,
      name: 'Personal',
      currency: 'MUR',
      targetMinor: 150_000,
      balanceMinor: 30_000,
      kind: 'recurring',
      period: 'weekly',
      weekStart: 1,
      nextRefreshDate: '2026-08-03',
      active: true,
      createdAt: '2026-07-01T00:00:00Z',
      reservedMinor: 30_000,
      overspent: false,
      underfunded: true,
      ...overrides,
    };
  }
  function transaction(overrides: Partial<Transaction> = {}): Transaction {
    return {
      id: 9,
      accountId: 1,
      postedDate: '2026-07-10',
      amountMinor: -1000,
      currency: 'MUR',
      fxRate: '1',
      baseAmountMinor: -1000,
      payee: 'Winners',
      note: null,
      source: 'manual',
      sourceRef: null,
      pendingReview: false,
      createdAt: '2026-07-10T00:00:00Z',
      allowanceId: null,
      transferGroupId: null,
      splits: [{ id: 1, categoryId: 1, categoryName: 'Groceries', amountMinor: -1000 }],
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

  function baseHandlers(
    overrides: Record<string, (args: unknown) => unknown> = {},
  ): Record<string, (args: unknown) => unknown> {
    return {
      list_accounts: () => [account()],
      list_categories: () => [category()],
      get_settings: () => ({
        idleTimeoutSecs: 120,
        biometricEnabled: false,
        baseCurrency: 'MUR',
        dedupWindowDays: 3,
      }),
      list_allowances: () => ({
        allowances: [allowance({ id: 2, name: 'Personal' }), allowance({ id: 3, name: 'Groceries fund' })],
        totalMinor: 0,
        reservedMinor: 0,
        availableMinor: 0,
        baseCurrency: 'MUR',
        excludedAllowances: 0,
      }),
      ...overrides,
    };
  }

  async function createForm(
    routeParams: Record<string, string>,
    handlers: Record<string, (args: unknown) => unknown>,
  ) {
    stubInvoke(handlers);
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
    const fixture = TestBed.createComponent(TransactionForm);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('offers a leading "not tagged" sentinel plus every fetched allowance as tag options', async () => {
    const fixture = await createForm({ kind: 'expense', categoryId: '1' }, baseHandlers());
    const component = fixture.componentInstance as any;

    expect(component.allowanceOptions()).toEqual([
      { value: 0, label: 'Not counted against an allowance' },
      { value: 2, label: 'Personal' },
      { value: 3, label: 'Groceries fund' },
    ]);
  });

  it('save() carries the chosen allowanceId in the create payload', async () => {
    let created: unknown;
    const fixture = await createForm(
      { kind: 'expense', categoryId: '1' },
      baseHandlers({
        create_transaction: (args) => {
          created = args;
          return transaction({ allowanceId: 2 });
        },
      }),
    );
    const component = fixture.componentInstance as any;
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');
    component.form.controls.accountId.setValue(1);
    component.form.controls.amount.setValue('10.00');
    component.setAllowanceTag(2);

    await component.save();

    expect((created as any).tx.allowanceId).toBe(2);
  });

  it('save() maps the "not tagged" sentinel (0) to null, never sending 0 as an id', async () => {
    let created: unknown;
    const fixture = await createForm(
      { kind: 'expense', categoryId: '1' },
      baseHandlers({
        create_transaction: (args) => {
          created = args;
          return transaction();
        },
      }),
    );
    const component = fixture.componentInstance as any;
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');
    component.form.controls.accountId.setValue(1);
    component.form.controls.amount.setValue('10.00');
    // allowanceId control defaults to the `0` sentinel - never explicitly tagged.

    await component.save();

    expect((created as any).tx.allowanceId).toBeNull();
  });

  it('edit-load maps an existing transaction.allowanceId back into the control', async () => {
    const fixture = await createForm(
      { id: '9' },
      baseHandlers({ list_transactions: () => [transaction({ allowanceId: 3 })] }),
    );
    const component = fixture.componentInstance as any;

    expect(component.form.controls.allowanceId.value).toBe(3);
  });

  it('edit-load maps a null (untagged) allowanceId back to the "not tagged" sentinel (0)', async () => {
    const fixture = await createForm(
      { id: '9' },
      baseHandlers({ list_transactions: () => [transaction({ allowanceId: null })] }),
    );
    const component = fixture.componentInstance as any;

    expect(component.form.controls.allowanceId.value).toBe(0);
  });

  it('save() carries the retagged allowanceId in the update payload on edit', async () => {
    let updated: unknown;
    const fixture = await createForm(
      { id: '9' },
      baseHandlers({
        list_transactions: () => [transaction({ allowanceId: 2 })],
        update_transaction: (args) => {
          updated = args;
          return transaction({ allowanceId: 3 });
        },
      }),
    );
    const component = fixture.componentInstance as any;
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');
    component.setAllowanceTag(3);

    await component.save();

    expect((updated as any).tx.allowanceId).toBe(3);
  });
});
