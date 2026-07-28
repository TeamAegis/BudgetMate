import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AllowancePicker } from './allowance-picker';
import type { Allowance, AllowanceSummary } from '../../core/models';

/**
 * `core/bridge` wrappers are named ES-module exports - Jasmine's `spyOn` cannot redefine those
 * (same limitation documented throughout the other feature specs). These tests stub the actual
 * Tauri IPC seam (`window.__TAURI_INTERNALS__.invoke`) so `ngOnInit` exercises the REAL bridge code
 * path. Constructing the component directly (not via `router.navigate`) means
 * `getCurrentNavigation()` is always null, so `returnTo` falls back to `/expenses` and `resume` is
 * `undefined` - the `stateFor` forwarding itself is covered directly below.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('AllowancePicker', () => {
  afterEach(() => {
    delete (globalThis as any).__TAURI_INTERNALS__;
  });

  function allowance(overrides: Partial<Allowance> = {}): Allowance {
    return {
      id: 1,
      name: 'Personal',
      currency: 'MUR',
      targetMinor: 150_000,
      balanceMinor: 150_000,
      kind: 'recurring',
      period: 'weekly',
      weekStart: 1,
      nextRefreshDate: '2026-08-03',
      active: true,
      createdAt: '2026-07-01T00:00:00Z',
      reservedMinor: 150_000,
      overspent: false,
      underfunded: false,
      ...overrides,
    };
  }

  function summary(allowances: Allowance[]): AllowanceSummary {
    return {
      allowances,
      totalMinor: 1_000_000,
      reservedMinor: 150_000,
      availableMinor: 850_000,
      baseCurrency: 'MUR',
      excludedAllowances: 0,
    };
  }

  function stubInvoke(handler: (cmd: string) => Promise<unknown>): void {
    (globalThis as any).__TAURI_INTERNALS__ = { invoke: handler };
  }

  async function createComponent(handler: (cmd: string) => Promise<unknown>) {
    stubInvoke(handler);
    await TestBed.configureTestingModule({
      imports: [AllowancePicker],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(AllowancePicker);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('calls list_allowances through the bridge and lists only ACTIVE allowances plus a None row', async () => {
    let calledCmd = '';
    const fixture = await createComponent(async (cmd) => {
      calledCmd = cmd;
      return summary([allowance({ id: 1, name: 'Personal', active: true }), allowance({ id: 2, name: 'Paused one', active: false })]);
    });
    expect(calledCmd).toBe('list_allowances');
    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll('a[app-settings-row]');
    // "None" + the one active allowance only.
    expect(rows.length).toBe(2);
    expect(el.textContent).toContain('None');
    expect(el.textContent).toContain('Personal');
    expect(el.textContent).not.toContain('Paused one');
  });

  it('shows the loading skeleton before the first fetch resolves', async () => {
    stubInvoke(() => new Promise(() => {}));
    await TestBed.configureTestingModule({
      imports: [AllowancePicker],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(AllowancePicker);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('app-skeleton').length).toBeGreaterThan(0);
  });

  it('shows the error state (banner) when the fetch is rejected', async () => {
    const fixture = await createComponent(async () => {
      throw { kind: 'internal', message: 'boom' };
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-banner')).toBeTruthy();
  });

  it('forwards the resumed form snapshot with only allowanceId overridden', async () => {
    const fixture = await createComponent(async () => summary([allowance({ id: 5, name: 'Transport' })]));
    const component = fixture.componentInstance as any;
    component['resume'] = { accountId: 1, amount: '10.00' };
    expect(component.stateFor(5)).toEqual({ resume: { accountId: 1, amount: '10.00', allowanceId: 5 } });
    expect(component.stateFor(null)).toEqual({ resume: { accountId: 1, amount: '10.00', allowanceId: null } });
  });
});
