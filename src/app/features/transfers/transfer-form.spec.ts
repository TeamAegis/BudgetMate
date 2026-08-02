import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TransferForm } from './transfer-form';
import type { Account } from '../../core/models';

/** The component's protected surface, for assertions (mirrors the other feature specs). */
interface Internals {
  fromId: { set(v: number): void; (): number };
  toId: { set(v: number): void; (): number };
  accounts: { set(v: Account[]): void };
  loading: { set(v: boolean): void };
  toOptions(): { value: number | string; label: string }[];
  fromOptions(): { value: number | string; label: string }[];
  noDestinationHint(): string | null;
  currency(): string;
  canSave(): boolean;
  onFromChange(v: number | string): void;
  onToChange(v: number | string): void;
  form: { controls: { amount: { setValue(v: string): void }; postedDate: { setValue(v: string): void } } };
}

function account(over: Partial<Account> = {}): Account {
  return {
    id: 1,
    name: 'Cash',
    accountType: 'cash',
    currency: 'MUR',
    openingBalanceMinor: 0,
    archived: false,
    balanceMinor: 100_000,
    ...over,
  };
}

describe('TransferForm', () => {
  function create(accounts: Account[]): Internals {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(TransferForm);
    const c = fixture.componentInstance as unknown as Internals;
    // ngOnInit's bridge call is skipped outside Tauri; seed the accounts directly.
    c.accounts.set(accounts);
    c.loading.set(false);
    return c;
  }

  it('offers only same-currency accounts as the destination', () => {
    const c = create([
      account({ id: 1, name: 'Cash', currency: 'MUR' }),
      account({ id: 2, name: 'Savings', currency: 'MUR' }),
      account({ id: 3, name: 'US card', currency: 'USD' }),
    ]);
    c.onFromChange(1);

    // Every account can be the SOURCE...
    expect(c.fromOptions().length).toBe(3);
    // ...but the destination excludes the source itself and the foreign-currency account, because
    // v1 transfers are same-currency only (Rust rejects a mismatch regardless).
    expect(c.toOptions().map((o) => o.value)).toEqual([2]);
    expect(c.currency()).toBe('MUR');
  });

  it('explains in plain language when no account shares the currency', () => {
    const c = create([
      account({ id: 1, name: 'Cash', currency: 'MUR' }),
      account({ id: 3, name: 'US card', currency: 'USD' }),
    ]);
    c.onFromChange(1);

    expect(c.toOptions().length).toBe(0);
    const hint = c.noDestinationHint();
    expect(hint).toContain('MUR');
    expect(hint).toContain('not supported yet');
    expect(c.canSave()).withContext('nothing to transfer into').toBeFalse();
  });

  it('tells a one-account user to add a second account', () => {
    const c = create([account({ id: 1 })]);
    c.onFromChange(1);

    expect(c.noDestinationHint()).toContain('need a second account');
  });

  it('clears a destination that the new source makes invalid', () => {
    const c = create([
      account({ id: 1, currency: 'MUR' }),
      account({ id: 2, currency: 'MUR' }),
      account({ id: 3, currency: 'USD' }),
    ]);
    c.onFromChange(1);
    c.onToChange(2);
    expect(c.toId()).toBe(2);

    // Switching the source to the USD account leaves account 2 ineligible - it must not linger.
    c.onFromChange(3);
    expect(c.toId()).withContext('a stale destination is dropped, not submitted').toBe(0);
  });

  it('excludes archived accounts from both sides', () => {
    const c = create([
      account({ id: 1, currency: 'MUR' }),
      account({ id: 2, currency: 'MUR', archived: true }),
    ]);
    c.onFromChange(1);

    expect(c.fromOptions().map((o) => o.value)).toEqual([1]);
    expect(c.toOptions().length).toBe(0);
  });

  it('blocks saving until a valid pair and amount are present', () => {
    const c = create([account({ id: 1, currency: 'MUR' }), account({ id: 2, currency: 'MUR' })]);
    c.onFromChange(1);
    c.onToChange(2);

    expect(c.canSave()).withContext('no amount yet').toBeFalse();
    c.form.controls.amount.setValue('5000.00');
    expect(c.canSave()).toBeTrue();
  });

  it('rejects an amount that is not a plain number', () => {
    const c = create([account({ id: 1, currency: 'MUR' }), account({ id: 2, currency: 'MUR' })]);
    c.onFromChange(1);
    c.onToChange(2);

    c.form.controls.amount.setValue('-5000');
    expect(c.canSave()).withContext('a transfer amount is a positive magnitude').toBeFalse();

    c.form.controls.amount.setValue('5,000');
    expect(c.canSave()).toBeFalse();
  });
});
