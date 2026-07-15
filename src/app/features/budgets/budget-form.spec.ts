import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter, convertToParamMap } from '@angular/router';
import { BudgetForm } from './budget-form';
import type { Category, EnvelopeSummary, VaultSettings } from '../../core/models';

/**
 * `core/bridge` wrappers are named ES-module exports that Jasmine's `spyOn` cannot redefine (same
 * limitation documented in transaction-form.spec.ts / budgets.spec.ts). These tests stub the actual
 * Tauri IPC seam (`window.__TAURI_INTERNALS__.invoke`) so `ngOnInit` exercises the REAL bridge code
 * path. The router-state "fast path" (an `EnvelopeSummary` handed over via navigation `state`) isn't
 * exercised here - constructing a component directly never goes through `router.navigate`, so
 * `getCurrentNavigation()` is always null; that fast path is a perf/UX nicety, the network fallback
 * below is the path these tests cover.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('BudgetForm', () => {
  afterEach(() => {
    delete (globalThis as any).__TAURI_INTERNALS__;
  });

  function settings(): VaultSettings {
    return { idleTimeoutSecs: 120, biometricEnabled: false, baseCurrency: 'MUR' };
  }

  function category(id: number, name: string, kind: Category['kind'] = 'expense'): Category {
    return { id, name, parentId: null, kind, archived: false };
  }

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
      imports: [BudgetForm],
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
    const fixture = TestBed.createComponent(BudgetForm);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('excludes already-budgeted and non-expense categories from the add-page picker', async () => {
    const fixture = await createForm(null, {
      get_settings: () => settings(),
      list_categories: () => [
        category(1, 'Groceries', 'expense'),
        category(2, 'Dining', 'expense'),
        category(9, 'Salary', 'income'),
      ],
      list_envelopes: () => [envelope({ categoryId: 1 })],
    });
    const component = fixture.componentInstance as any;
    expect(component.categoryOptions().map((o: { value: unknown }) => o.value)).toEqual([2]);
    expect(component.noCategoriesAvailable()).toBeFalse();
  });

  it('shows a friendly message when every expense category already has a budget', async () => {
    const fixture = await createForm(null, {
      get_settings: () => settings(),
      list_categories: () => [category(1, 'Groceries', 'expense')],
      list_envelopes: () => [envelope({ categoryId: 1 })],
    });
    const component = fixture.componentInstance as any;
    expect(component.noCategoriesAvailable()).toBeTrue();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('already has a monthly limit');
  });

  it('loads the category name + cap for the edit page (network fallback path)', async () => {
    const fixture = await createForm(7, {
      get_settings: () => settings(),
      get_budget: () => ({ id: 7, categoryId: 1, period: 'monthly', capMinor: 15_000 }),
      list_categories: () => [category(1, 'Groceries', 'expense')],
    });
    const component = fixture.componentInstance as any;
    expect(component.categoryName()).toBe('Groceries');
    expect(component.form.controls.cap.value).toBe('150.00');
  });

  it('flags an over-precise cap for the base currency (2dp MUR)', async () => {
    const fixture = await createForm(null, {
      get_settings: () => settings(),
      list_categories: () => [category(1, 'Groceries', 'expense')],
      list_envelopes: () => [],
    });
    const component = fixture.componentInstance as any;
    component.form.controls.cap.setValue('1.005');
    expect(component.form.controls.cap.hasError('maxFractionDigits')).toBeTrue();
  });

  it('deletes the budget and navigates back to the list on confirm', async () => {
    let deletedId: unknown;
    const fixture = await createForm(7, {
      get_settings: () => settings(),
      get_budget: () => ({ id: 7, categoryId: 1, period: 'monthly', capMinor: 15_000 }),
      list_categories: () => [category(1, 'Groceries', 'expense')],
      delete_budget: (args) => {
        deletedId = (args as { id: number }).id;
        return null;
      },
    });
    const component = fixture.componentInstance as any;
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate');
    await component.deleteConfirmed();
    expect(deletedId).toBe(7);
    expect(navSpy).toHaveBeenCalledWith(['/budgets']);
  });

  it('creates a budget with the picked category and cap on save', async () => {
    let created: unknown;
    const fixture = await createForm(null, {
      get_settings: () => settings(),
      list_categories: () => [category(2, 'Dining', 'expense')],
      list_envelopes: () => [],
      create_budget: (args) => {
        created = args;
        return { id: 3, categoryId: 2, period: 'monthly', capMinor: 5_000 };
      },
    });
    const component = fixture.componentInstance as any;
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate');
    component.form.controls.cap.setValue('50.00');
    await component.save();
    expect(created).toEqual({ budget: { categoryId: 2, period: 'monthly', cap: '50.00' } });
    expect(navSpy).toHaveBeenCalledWith(['/budgets']);
  });
});
