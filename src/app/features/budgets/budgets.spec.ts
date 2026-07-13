import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Budgets } from './budgets';
import type { EnvelopeSummary } from '../../core/models';

/**
 * `core/bridge` wrappers are named ES-module exports - Jasmine's `spyOn` cannot redefine those
 * (same limitation documented in transaction-form.spec.ts). Instead these tests stub the actual
 * Tauri IPC seam the bridge calls through - `window.__TAURI_INTERNALS__.invoke` - which both makes
 * `isTauri()` true and lets us script `list_envelopes`'s response. This exercises the REAL
 * `core/bridge` code path (`listEnvelopes()` -> `invoke('list_envelopes')`), not a re-implementation
 * of it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('Budgets', () => {
  afterEach(() => {
    delete (globalThis as any).__TAURI_INTERNALS__;
  });

  function envelope(overrides: Partial<EnvelopeSummary> = {}): EnvelopeSummary {
    return {
      id: 1,
      categoryId: 1,
      categoryName: 'Groceries',
      period: 'monthly',
      capMinor: 10_000,
      spentMinor: 5_000,
      remainingMinor: 5_000,
      currency: 'MUR',
      status: 'under',
      ...overrides,
    };
  }

  function stubInvoke(handler: (cmd: string, args: unknown) => Promise<unknown>): void {
    (globalThis as any).__TAURI_INTERNALS__ = { invoke: handler };
  }

  async function createComponent(handler: (cmd: string, args: unknown) => Promise<unknown>) {
    stubInvoke(handler);
    await TestBed.configureTestingModule({
      imports: [Budgets],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(Budgets);
    fixture.detectChanges(); // runs ngOnInit -> calls list_envelopes through the real bridge
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('calls list_envelopes through the bridge and renders the populated state', async () => {
    let calledCmd = '';
    const fixture = await createComponent(async (cmd) => {
      calledCmd = cmd;
      return [envelope()];
    });
    expect(calledCmd).toBe('list_envelopes');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('app-envelope-card').length).toBe(1);
  });

  it('shows the loading skeleton before the first fetch resolves', async () => {
    stubInvoke(() => new Promise(() => {})); // never resolves - freezes in the loading state
    await TestBed.configureTestingModule({
      imports: [Budgets],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(Budgets);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('app-skeleton').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('app-envelope-card').length).toBe(0);
  });

  it('shows the empty state with a CTA when there are no budgets yet', async () => {
    const fixture = await createComponent(async () => []);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Add your first budget');
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
    const fixture = await createComponent(async () => [envelope()]);
    let resolveSecond!: (v: EnvelopeSummary[]) => void;
    stubInvoke(() => new Promise((res) => (resolveSecond = res)));

    const component = fixture.componentInstance as any;
    const reloadPromise = component['reload']();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.updating')).toBeTruthy();
    expect(el.querySelectorAll('app-envelope-card').length).toBe(1, 'the prior list stays visible');

    resolveSecond([envelope()]);
    await reloadPromise;
  });

  it('navigates to the budget edit page when an envelope card is opened', async () => {
    const fixture = await createComponent(async () => [envelope({ id: 42 })]);
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate');
    const e = envelope({ id: 42 });
    (fixture.componentInstance as any).openEnvelope(e);
    expect(navSpy).toHaveBeenCalledWith(['/budgets', 42, 'edit'], { state: { envelope: e } });
  });

  it('navigates to the add-budget page from the FAB', async () => {
    const fixture = await createComponent(async () => []);
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate');
    (fixture.componentInstance as any).addBudget();
    expect(navSpy).toHaveBeenCalledWith(['/budgets/new']);
  });
});
