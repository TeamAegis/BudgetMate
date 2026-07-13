import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Reports } from './reports';
import type { ReportData } from '../../core/models';

/**
 * `getReport`/`listCategories` are named exports of `core/bridge`, and Jasmine's `spyOn` cannot
 * redefine a property on an ES module namespace object here (same constraint as
 * `transaction-form.spec.ts`/`currency.service.spec.ts`). Karma also never runs inside the Tauri
 * runtime, so `isTauri()` is reliably `false` here - `reload()` takes its real (guarded) no-op path
 * and never calls the bridge. That exercises the genuine "not running in the app shell" error state
 * for free; the other four states are driven by seeding the component's own signals directly (the
 * same reflection technique those specs use), exactly as `reload()`/`ngOnInit` would have set them.
 */
describe('Reports', () => {
  function createFixture() {
    TestBed.configureTestingModule({
      imports: [Reports],
      providers: [provideRouter([])],
    });
    return TestBed.createComponent(Reports);
  }

  const sampleReport: ReportData = {
    baseCurrency: 'MUR',
    period: 'thisMonth',
    totalSpendMinor: 6_050,
    byCategory: [
      { categoryId: 1, categoryName: 'Groceries', amountMinor: 3_500 },
      { categoryId: 2, categoryName: 'Dining', amountMinor: 2_550 },
    ],
    overTime: [
      { label: '05 Jul', startDate: '2026-07-05', amountMinor: 3_500 },
      { label: '13 Jul', startDate: '2026-07-13', amountMinor: 2_550 },
    ],
    granularity: 'day',
  };

  it('error state: outside the Tauri runtime, ngOnInit reports the plain-language message (no data)', () => {
    const fixture = createFixture();
    fixture.detectChanges(); // runs ngOnInit -> !isTauri() -> guarded no-op with an error message
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('Run the app');
    expect(host.querySelector('app-empty-state')).toBeNull();
    expect(host.querySelector('app-pie-chart')).toBeNull();
  });

  it('loading state: skeleton placeholders render while no data/error is present yet', () => {
    const fixture = createFixture();
    fixture.detectChanges(); // settle ngOnInit's guarded no-op first
    const component = fixture.componentInstance as unknown as {
      loading: { set(v: boolean): void };
      error: { set(v: string | null): void };
    };
    component.loading.set(true);
    component.error.set(null);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('app-skeleton').length).toBeGreaterThan(0);
  });

  const emptyReport = (period: ReportData['period'] = 'allTime'): ReportData => ({
    baseCurrency: 'MUR',
    period,
    totalSpendMinor: 0,
    byCategory: [],
    overTime: [],
    granularity: 'day',
  });

  it('true first-run empty state: all categories + all time + no spend shows the teaching illustration + Add an expense CTA', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      loading: { set(v: boolean): void };
      error: { set(v: string | null): void };
      data: { set(v: ReportData | null): void };
      period: { set(v: string): void };
    };
    component.loading.set(false);
    component.error.set(null);
    component.period.set('allTime');
    component.data.set(emptyReport('allTime'));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-empty-state')).not.toBeNull();
    expect(host.textContent).toContain('Add an expense');
    expect(host.querySelector('app-pie-chart')).toBeNull();
    // Filters stay visible even in the empty state - the user can still switch them.
    expect(host.querySelector('app-segmented-toggle')).not.toBeNull();
  });

  it('category-filtered empty state: an active category filter with no spend offers "Clear filter", not the generic CTA', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      loading: { set(v: boolean): void };
      error: { set(v: string | null): void };
      data: { set(v: ReportData | null): void };
      onCategoryChange(v: number | string): void;
    };
    component.loading.set(false);
    component.error.set(null);
    component.onCategoryChange(3);
    component.data.set(emptyReport('thisMonth'));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('No spending in this category for the selected period.');
    expect(host.textContent).toContain('Clear filter');
    expect(host.textContent).not.toContain('Add an expense');
    expect(host.querySelector('app-pie-chart')).toBeNull();
  });

  it('clearCategoryFilter resets the category filter to "all"', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      categoryFilter: { (): unknown };
      onCategoryChange(v: number | string): void;
      clearCategoryFilter(): void;
    };
    component.onCategoryChange(3);
    expect(component.categoryFilter()).toBe(3);
    component.clearCategoryFilter();
    expect(component.categoryFilter()).toBe('all');
  });

  it('period-filtered empty state: all categories but a non-allTime period with no spend offers "View all time"', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      loading: { set(v: boolean): void };
      error: { set(v: string | null): void };
      data: { set(v: ReportData | null): void };
    };
    component.loading.set(false);
    component.error.set(null);
    // Default period is 'thisMonth' (not allTime), default category filter is 'all'.
    component.data.set(emptyReport('thisMonth'));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('No spending recorded for this period.');
    expect(host.textContent).toContain('View all time');
    expect(host.textContent).not.toContain('Add an expense');
    expect(host.querySelector('app-pie-chart')).toBeNull();
  });

  it('viewAllTime sets the period to "allTime"', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      period: { (): string };
      viewAllTime(): void;
    };
    expect(component.period()).toBe('thisMonth');
    component.viewAllTime();
    expect(component.period()).toBe('allTime');
  });

  it('populated state: a report with spend renders the total, pie chart, and line chart', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      loading: { set(v: boolean): void };
      error: { set(v: string | null): void };
      data: { set(v: ReportData | null): void };
    };
    component.loading.set(false);
    component.error.set(null);
    component.data.set(sampleReport);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-empty-state')).toBeNull();
    expect(host.querySelector('app-pie-chart')).not.toBeNull();
    expect(host.querySelector('app-line-chart')).not.toBeNull();
    // Total spend (6050 minor -> Rs 60.50) is rendered via the shared money pipe.
    expect(host.textContent).toContain('60.50');
  });

  it('busy state: a background refresh keeps the existing charts mounted and shows a spinner', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      loading: { set(v: boolean): void };
      error: { set(v: string | null): void };
      data: { set(v: ReportData | null): void };
      refreshing: { set(v: boolean): void };
    };
    component.loading.set(false);
    component.error.set(null);
    component.data.set(sampleReport);
    component.refreshing.set(true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    // The chart area stays mounted (UI stays responsive) - never replaced by a blocking spinner.
    expect(host.querySelector('app-pie-chart')).not.toBeNull();
    expect(host.querySelector('app-spinner')).not.toBeNull();
  });

  it('a non-fatal error during a refresh is shown alongside the still-mounted charts, not instead of them', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      loading: { set(v: boolean): void };
      error: { set(v: string | null): void };
      data: { set(v: ReportData | null): void };
    };
    component.loading.set(false);
    component.data.set(sampleReport);
    component.error.set('Could not refresh - please try again.');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-banner')).not.toBeNull();
    expect(host.querySelector('app-pie-chart')).not.toBeNull();
  });

  it('onPeriodChange updates the period signal (guarded reload is a no-op outside Tauri)', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      period: { (): string };
      onPeriodChange(v: string): void;
    };
    component.onPeriodChange('thisYear');
    expect(component.period()).toBe('thisYear');
  });

  it('onCategoryChange stores a numeric category id, and "all" clears it', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      categoryFilter: { (): unknown };
      onCategoryChange(v: number | string): void;
    };
    component.onCategoryChange(3);
    expect(component.categoryFilter()).toBe(3);
    component.onCategoryChange('all');
    expect(component.categoryFilter()).toBe('all');
  });

  it('pieSlices/linePoints map the report into chart-ready shapes', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      data: { set(v: ReportData | null): void };
      pieSlices: { (): { label: string; amountMinor: number }[] };
      linePoints: { (): { label: string; amountMinor: number }[] };
      emptyKind: { (): string | null };
    };
    component.data.set(sampleReport);

    expect(component.pieSlices()).toEqual([
      { label: 'Groceries', amountMinor: 3_500 },
      { label: 'Dining', amountMinor: 2_550 },
    ]);
    expect(component.linePoints()).toEqual([
      { label: '05 Jul', amountMinor: 3_500 },
      { label: '13 Jul', amountMinor: 2_550 },
    ]);
    expect(component.emptyKind()).toBeNull();
  });

  it("request race: an earlier, slower reload must not overwrite a later, faster reload's result", async () => {
    // Drive the REAL private `reload()` (the request-id guard under test) through its actual
    // bridge call, not a re-implementation of the guard. `getReport`/`isTauri()` cannot be
    // `spyOn`-ed (named ES exports - see the file doc comment above), but `isTauri()` and the
    // underlying `invoke()` both key off the plain global `window.__TAURI_INTERNALS__`, so setting
    // that directly (no `@tauri-apps/api` import - stays clear of the bridge-only ESLint rule)
    // makes `reload()` take its real bridge-calling path with a fully controllable, out-of-order
    // resolving `get_report` response.
    const globalWithInternals = globalThis as { __TAURI_INTERNALS__?: unknown };
    const priorInternals = globalWithInternals.__TAURI_INTERNALS__;

    const firstReportData: ReportData = { ...sampleReport, totalSpendMinor: 1_111 };
    const secondReportData: ReportData = { ...sampleReport, totalSpendMinor: 2_222 };
    const payloads = [firstReportData, secondReportData];
    const resolvers: Array<() => void> = [];
    let callCount = 0;

    globalWithInternals.__TAURI_INTERNALS__ = {
      invoke: (cmd: string): Promise<unknown> => {
        if (cmd === 'get_report') {
          const index = callCount++;
          return new Promise<void>((resolve) => {
            resolvers[index] = resolve;
          }).then(() => payloads[index]);
        }
        return Promise.resolve(null);
      },
    };

    try {
      const fixture = createFixture();
      // Deliberately skip fixture.detectChanges() (ngOnInit's own reload) so the two calls below
      // are the only overlapping requests in flight.
      const component = fixture.componentInstance as unknown as {
        data: { (): ReportData | null };
        reload(): Promise<void>;
      };

      const first = component.reload(); // request #1 - the SLOW one
      const second = component.reload(); // request #2 - the FAST one, requested later

      resolvers[1](); // #2 (the later request) resolves FIRST
      await second;
      resolvers[0](); // #1 (the earlier request) resolves AFTER - must be ignored as stale
      await first;

      expect(component.data()?.totalSpendMinor).toBe(
        2_222,
        "the later request's data must win even though the earlier request resolved after it",
      );
    } finally {
      globalWithInternals.__TAURI_INTERNALS__ = priorInternals;
    }
  });
});
