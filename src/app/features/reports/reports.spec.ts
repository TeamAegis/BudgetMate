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

  it('empty state: a report with no categories shows the polished empty state, not the charts', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      loading: { set(v: boolean): void };
      error: { set(v: string | null): void };
      data: { set(v: ReportData | null): void };
    };
    component.loading.set(false);
    component.error.set(null);
    component.data.set({
      baseCurrency: 'MUR',
      period: 'thisMonth',
      totalSpendMinor: 0,
      byCategory: [],
      overTime: [],
      granularity: 'day',
    });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-empty-state')).not.toBeNull();
    expect(host.querySelector('app-pie-chart')).toBeNull();
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
      isEmpty: { (): boolean };
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
    expect(component.isEmpty()).toBe(false);
  });
});
