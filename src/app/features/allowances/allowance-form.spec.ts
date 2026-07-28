import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter, convertToParamMap } from '@angular/router';
import { AllowanceForm } from './allowance-form';
import type { Allowance, VaultSettings } from '../../core/models';

/**
 * `core/bridge` wrappers are named ES-module exports that Jasmine's `spyOn` cannot redefine (same
 * limitation documented in transaction-form.spec.ts / budget-form.spec.ts). These tests stub the
 * actual Tauri IPC seam (`window.__TAURI_INTERNALS__.invoke`) so `ngOnInit` exercises the REAL
 * bridge code path.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('AllowanceForm', () => {
  afterEach(() => {
    delete (globalThis as any).__TAURI_INTERNALS__;
  });

  function settings(): VaultSettings {
    return { idleTimeoutSecs: 120, biometricEnabled: false, baseCurrency: 'MUR', dedupWindowDays: 3 };
  }

  function allowance(overrides: Partial<Allowance> = {}): Allowance {
    return {
      id: 7,
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

  it('creates a recurring weekly allowance with the picked kind/period/weekStart on save', async () => {
    let created: unknown;
    const fixture = await createForm(null, {
      get_settings: () => settings(),
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

  it('creates a one-time allowance with no period/weekStart', async () => {
    let created: unknown;
    const fixture = await createForm(null, {
      get_settings: () => settings(),
      create_allowance: (args) => {
        created = args;
        return allowance({ kind: 'one_time', period: null, weekStart: null });
      },
    });
    const component = fixture.componentInstance as any;
    component.form.controls.name.setValue('Trip');
    component.form.controls.target.setValue('500.00');
    component.setKind('one_time');
    await component.save();

    expect(created).toEqual({
      allowance: {
        name: 'Trip',
        target: '500.00',
        currency: 'MUR',
        kind: 'one_time',
        period: undefined,
        weekStart: undefined,
      },
    });
  });

  it('loads the read-only cadence context + editable name/target/status for the edit page', async () => {
    const fixture = await createForm(7, {
      get_settings: () => settings(),
      list_allowances: () => ({
        allowances: [allowance()],
        totalMinor: 0,
        reservedMinor: 0,
        availableMinor: 0,
        baseCurrency: 'MUR',
        excludedAllowances: 0,
      }),
    });
    const component = fixture.componentInstance as any;
    expect(component.form.controls.name.value).toBe('Personal');
    expect(component.form.controls.target.value).toBe('1500.00');
    expect(component.form.controls.activeChoice.value).toBe('active');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Weekly');
    expect(el.textContent).toContain('Monday');
  });

  it('updates name/target/active (pause) on save without touching kind/period', async () => {
    let updated: unknown;
    const fixture = await createForm(7, {
      get_settings: () => settings(),
      list_allowances: () => ({
        allowances: [allowance()],
        totalMinor: 0,
        reservedMinor: 0,
        availableMinor: 0,
        baseCurrency: 'MUR',
        excludedAllowances: 0,
      }),
      update_allowance: (args) => {
        updated = args;
        return allowance({ active: false });
      },
    });
    const component = fixture.componentInstance as any;
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate');
    component.form.controls.target.setValue('1200.00');
    component.setActiveChoice('paused');
    await component.save();

    expect(updated).toEqual({
      allowance: { id: 7, name: 'Personal', target: '1200.00', active: false },
    });
    expect(navSpy).toHaveBeenCalledWith(['/allowances']);
  });

  it('surfaces a savings-gate rejection as a plain-language WARNING banner, leaving the form untouched', async () => {
    const fixture = await createForm(7, {
      get_settings: () => settings(),
      list_allowances: () => ({
        allowances: [allowance()],
        totalMinor: 0,
        reservedMinor: 0,
        availableMinor: 0,
        baseCurrency: 'MUR',
        excludedAllowances: 0,
      }),
      update_allowance: () => {
        throw { kind: 'validation', message: 'not enough available savings to cover this change' };
      },
    });
    const component = fixture.componentInstance as any;
    component.form.controls.target.setValue('5000.00');
    await component.save();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const banner = el.querySelector('.banner')!;
    expect(banner.textContent).toContain("isn't enough free savings");
    expect(banner.className).toContain('warning');
  });

  it('flags an over-precise target for the base currency (2dp MUR)', async () => {
    const fixture = await createForm(null, { get_settings: () => settings() });
    const component = fixture.componentInstance as any;
    component.form.controls.target.setValue('1.005');
    expect(component.form.controls.target.hasError('maxFractionDigits')).toBeTrue();
  });

  it('deletes the allowance and navigates back to the list on confirm', async () => {
    let deletedId: unknown;
    const fixture = await createForm(7, {
      get_settings: () => settings(),
      list_allowances: () => ({
        allowances: [allowance()],
        totalMinor: 0,
        reservedMinor: 0,
        availableMinor: 0,
        baseCurrency: 'MUR',
        excludedAllowances: 0,
      }),
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
});
