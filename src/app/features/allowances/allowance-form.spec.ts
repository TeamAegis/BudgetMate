import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter, convertToParamMap } from '@angular/router';
import { AllowanceForm } from './allowance-form';
import type { Allowance, AllowanceSummary } from '../../core/models';

/**
 * `core/bridge` wrappers are named ES-module exports that Jasmine's `spyOn` cannot redefine (same
 * limitation documented in budget-form.spec.ts / transaction-form.spec.ts). These tests stub the
 * actual Tauri IPC seam (`window.__TAURI_INTERNALS__.invoke`) so `ngOnInit` exercises the REAL
 * bridge code path. The router-state "fast path" (an `Allowance` handed over via navigation
 * `state`) isn't exercised here - constructing a component directly never goes through
 * `router.navigate`, so `getCurrentNavigation()` is always null; that fast path is a perf/UX
 * nicety, the network fallback below is the path these tests cover.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('AllowanceForm', () => {
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
    routeId: number | null,
    handlers: Record<string, (args: unknown) => unknown>,
  ) {
    stubInvoke(handlers);
    await TestBed.configureTestingModule({
      imports: [AllowanceForm],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(routeId === null ? {} : { id: String(routeId) }),
            },
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AllowanceForm);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('creates a recurring weekly allowance with the picked name/target/period/week-start', async () => {
    let created: unknown;
    const fixture = await createForm(null, {
      list_allowances: () => summary({ allowances: [] }),
      create_allowance: (args) => {
        created = args;
        return allowance();
      },
    });
    const component = fixture.componentInstance as any;
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate');
    component.form.controls.name.setValue('Personal');
    component.form.controls.target.setValue('1500.00');
    // Defaults: kind = recurring, period = weekly, weekStart = 1 (Monday).
    await component.save();
    expect(created).toEqual({
      allowance: {
        name: 'Personal',
        target: '1500.00',
        currency: 'MUR',
        kind: 'recurring',
        period: 'weekly',
        weekStart: 1,
      },
    });
    expect(navSpy).toHaveBeenCalledWith(['/allowances']);
  });

  it('creates a one-time allowance with no period/week-start', async () => {
    let created: unknown;
    const fixture = await createForm(null, {
      list_allowances: () => summary({ allowances: [] }),
      create_allowance: (args) => {
        created = args;
        return allowance({ kind: 'one_time', period: null, weekStart: null });
      },
    });
    const component = fixture.componentInstance as any;
    component.form.controls.name.setValue('Trip');
    component.form.controls.target.setValue('5000.00');
    component.setKind('one_time');
    await component.save();
    expect(created).toEqual({
      allowance: {
        name: 'Trip',
        target: '5000.00',
        currency: 'MUR',
        kind: 'one_time',
        period: null,
        weekStart: null,
      },
    });
  });

  it('loads the name/target/type for the edit page and shows it read-only (network fallback path)', async () => {
    const fixture = await createForm(7, {
      list_allowances: () => summary({ allowances: [allowance({ id: 7 })] }),
    });
    const component = fixture.componentInstance as any;
    expect(component.form.controls.name.value).toBe('Personal');
    expect(component.form.controls.target.value).toBe('1500.00');
    expect(component.kindSummary()).toContain('Weekly');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Weekly');
  });

  it('flags an over-precise target for the base currency (2dp MUR)', async () => {
    const fixture = await createForm(null, {
      list_allowances: () => summary({ allowances: [] }),
    });
    const component = fixture.componentInstance as any;
    component.form.controls.target.setValue('1.005');
    expect(component.form.controls.target.hasError('maxFractionDigits')).toBeTrue();
  });

  it('updates name/target/active on save (edit)', async () => {
    let updated: unknown;
    const fixture = await createForm(7, {
      list_allowances: () => summary({ allowances: [allowance({ id: 7 })] }),
      update_allowance: (args) => {
        updated = args;
        return allowance({ id: 7 });
      },
    });
    const component = fixture.componentInstance as any;
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate');
    component.form.controls.target.setValue('2000.00');
    component.setActiveState('paused');
    await component.save();
    expect(updated).toEqual({
      allowance: { id: 7, name: 'Personal', target: '2000.00', active: false },
    });
    expect(navSpy).toHaveBeenCalledWith(['/allowances']);
  });

  it('deletes the allowance and navigates back to the list on confirm', async () => {
    let deletedId: unknown;
    const fixture = await createForm(7, {
      list_allowances: () => summary({ allowances: [allowance({ id: 7 })] }),
      delete_allowance: (args) => {
        deletedId = (args as { id: number }).id;
        return null;
      },
    });
    const component = fixture.componentInstance as any;
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate');
    await component.deleteConfirmed();
    expect(deletedId).toBe(7);
    expect(navSpy).toHaveBeenCalledWith(['/allowances']);
  });

  it('shows a gentle warning banner (not the hard error banner) when the savings gate rejects', async () => {
    const fixture = await createForm(null, {
      list_allowances: () => summary({ allowances: [] }),
      create_allowance: () => {
        throw { kind: 'validation', message: 'not enough available savings to allocate this allowance' };
      },
    });
    const component = fixture.componentInstance as any;
    component.form.controls.name.setValue('Personal');
    component.form.controls.target.setValue('50000.00');
    await component.save();
    fixture.detectChanges();
    expect(component.gateWarning()).toContain("isn't enough free savings");
    expect(component.error()).toBeNull();
    const el = fixture.nativeElement as HTMLElement;
    const warningBanner = el.querySelector('.warning');
    expect(warningBanner).toBeTruthy();
  });

  it('shows the default (non-warning) error banner for an unrelated failure', async () => {
    const fixture = await createForm(null, {
      list_allowances: () => summary({ allowances: [] }),
      create_allowance: () => {
        throw { kind: 'internal', message: 'boom' };
      },
    });
    const component = fixture.componentInstance as any;
    component.form.controls.name.setValue('Personal');
    component.form.controls.target.setValue('500.00');
    await component.save();
    expect(component.gateWarning()).toBeNull();
    expect(component.error()).toBeTruthy();
  });
});
