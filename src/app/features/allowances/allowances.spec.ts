import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Allowances } from './allowances';
import type { Allowance, AllowanceSummary } from '../../core/models';

/**
 * `core/bridge` wrappers are named ES-module exports - Jasmine's `spyOn` cannot redefine those
 * (same limitation documented in budgets.spec.ts / transaction-form.spec.ts). Instead these tests
 * stub the actual Tauri IPC seam the bridge calls through - `window.__TAURI_INTERNALS__.invoke` -
 * which both makes `isTauri()` true and lets us script `list_allowances`'s response. This exercises
 * the REAL `core/bridge` code path (`listAllowances()` -> `invoke('list_allowances')`), not a
 * re-implementation of it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('Allowances', () => {
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

  function summary(overrides: Partial<AllowanceSummary> = {}): AllowanceSummary {
    return {
      allowances: [allowance()],
      totalMinor: 1_000_000,
      reservedMinor: 150_000,
      availableMinor: 850_000,
      baseCurrency: 'MUR',
      excludedAllowances: 0,
      ...overrides,
    };
  }

  function stubInvoke(handler: (cmd: string, args: unknown) => Promise<unknown>): void {
    (globalThis as any).__TAURI_INTERNALS__ = { invoke: handler };
  }

  async function createComponent(handler: (cmd: string, args: unknown) => Promise<unknown>) {
    stubInvoke(handler);
    await TestBed.configureTestingModule({
      imports: [Allowances],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(Allowances);
    fixture.detectChanges(); // runs ngOnInit -> calls list_allowances through the real bridge
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('calls list_allowances through the bridge and renders the populated state', async () => {
    let calledCmd = '';
    const fixture = await createComponent(async (cmd) => {
      calledCmd = cmd;
      return summary();
    });
    expect(calledCmd).toBe('list_allowances');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('app-allowance-card').length).toBe(1);
    expect(el.querySelector('app-allowance-summary-strip')).toBeTruthy();
  });

  it('shows the loading skeleton before the first fetch resolves', async () => {
    stubInvoke(() => new Promise(() => {})); // never resolves - freezes in the loading state
    await TestBed.configureTestingModule({
      imports: [Allowances],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(Allowances);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('app-skeleton').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('app-allowance-card').length).toBe(0);
  });

  it('shows the empty state with a CTA when there are no allowances yet', async () => {
    const fixture = await createComponent(async () => summary({ allowances: [] }));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Add your first allowance');
  });

  it('shows the error state (banner + retry) when the fetch is rejected', async () => {
    const fixture = await createComponent(async () => {
      throw { kind: 'internal', message: 'boom' };
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-banner')).toBeTruthy();
    expect(el.textContent).toContain('Retry');
  });

  it('shows a non-blocking "busy" indicator on a reload without hiding the existing list', async () => {
    const fixture = await createComponent(async () => summary());
    let resolveSecond!: (v: AllowanceSummary) => void;
    stubInvoke(() => new Promise((res) => (resolveSecond = res)));

    const component = fixture.componentInstance as any;
    const reloadPromise = component['reload']();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.updating')).toBeTruthy();
    expect(el.querySelectorAll('app-allowance-card').length).toBe(1, 'the prior list stays visible');

    resolveSecond(summary());
    await reloadPromise;
  });

  it('shows the plain-language excluded-currency note when excludedAllowances > 0', async () => {
    const fixture = await createComponent(async () => summary({ excludedAllowances: 2 }));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('2 allowances in another currency');
  });

  it('navigates to the allowance edit page when a card is opened', async () => {
    const fixture = await createComponent(async () => summary({ allowances: [allowance({ id: 42 })] }));
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate');
    const a = allowance({ id: 42 });
    (fixture.componentInstance as any).openAllowance(a);
    expect(navSpy).toHaveBeenCalledWith(['/allowances', 42, 'edit'], { state: { allowance: a } });
  });

  it('navigates to the add-allowance page from the FAB', async () => {
    const fixture = await createComponent(async () => summary({ allowances: [] }));
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate');
    (fixture.componentInstance as any).addAllowance();
    expect(navSpy).toHaveBeenCalledWith(['/allowances/new']);
  });
});
