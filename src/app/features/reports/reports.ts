import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { getReport, isTauri, listCategories, toUserMessage } from '../../core/bridge';
import type { Category, ReportData, ReportPeriod } from '../../core/models';
import { Banner } from '../../shared/ui/banner/banner';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { LineChart, type LinePoint } from '../../shared/ui/line-chart/line-chart';
import { PieChart, type PieSlice } from '../../shared/ui/pie-chart/pie-chart';
import { SegmentedToggle, type SegmentOption } from '../../shared/ui/segmented-toggle/segmented-toggle';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { Spinner } from '../../shared/ui/spinner/spinner';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { registerCharts } from '../../shared/charts/chart-setup';

/** Sentinel for "no category filter" in the SelectField (which only carries number|string). */
const ALL_CATEGORIES = 'all' as const;

/**
 * Analytics (FR-3.3). Smart component: reads the spend-by-category / spend-over-time aggregation
 * from Rust via `getReport` (period + optional category filter) and renders it as a pie chart +
 * line chart (bundled Chart.js). All money math, fx conversion, date bucketing, and
 * pending-review exclusion happen in Rust - this component only formats and presents. Until there
 * is any spend to chart, it shows the same polished empty state as before (illustration + "Add an
 * expense" CTA); the charts replace it once a report has data.
 */
@Component({
  selector: 'app-reports',
  imports: [
    Banner,
    Button,
    Card,
    EmptyState,
    LineChart,
    PieChart,
    SegmentedToggle,
    SelectField,
    Skeleton,
    Spinner,
    MoneyPipe,
  ],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class Reports implements OnInit {
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly data = signal<ReportData | null>(null);
  protected readonly categories = signal<Category[]>([]);

  protected readonly period = signal<ReportPeriod>('thisMonth');
  protected readonly categoryFilter = signal<number | typeof ALL_CATEGORIES>(ALL_CATEGORIES);

  /** Monotonically increasing request id - guards against a slow, superseded `reload()` resolving
   *  after a newer one and overwriting `data`/`error` with stale results (a fast filter change
   *  while an earlier request is still in flight). Only the LATEST request applies its outcome. */
  private latestRequestId = 0;

  // Short labels (design-system SegmentedToggle is a single pill row) - 4 segments must still fit
  // the ~360-412dp Android artboard without wrapping/overflowing.
  protected readonly periodOptions: SegmentOption[] = [
    { value: 'thisMonth', label: 'Month' },
    { value: 'last3Months', label: '3 months' },
    { value: 'thisYear', label: 'Year' },
    { value: 'allTime', label: 'All time' },
  ];

  protected readonly categoryOptions = computed<SelectOption[]>(() => [
    { value: ALL_CATEGORIES, label: 'All categories' },
    ...this.categories().map((c) => ({ value: c.id, label: c.name })),
  ]);

  /**
   * Distinguishes WHY the report has no categories to chart, so the empty state never tells a
   * user with real spend that they have none (High-usability fix):
   * - `'category'`: a category filter is active and it matches nothing for the period - offer to
   *   clear the filter, not the generic "add an expense" teaching copy.
   * - `'period'`: all categories, but the selected period has no spend - offer to view all time.
   * - `'none'`: all categories + all time + genuinely no spend anywhere - the true first-run case,
   *   which alone shows the teaching illustration + "Add an expense" CTA.
   * - `null`: there is spend to chart.
   */
  protected readonly emptyKind = computed<'category' | 'period' | 'none' | null>(() => {
    const report = this.data();
    if (!report || report.byCategory.length > 0) return null;
    if (this.categoryFilter() !== ALL_CATEGORIES) return 'category';
    if (this.period() !== 'allTime') return 'period';
    return 'none';
  });

  protected readonly pieSlices = computed<PieSlice[]>(
    () => this.data()?.byCategory.map((c) => ({ label: c.categoryName, amountMinor: c.amountMinor })) ?? [],
  );
  protected readonly linePoints = computed<LinePoint[]>(
    () => this.data()?.overTime.map((b) => ({ label: b.label, amountMinor: b.amountMinor })) ?? [],
  );

  constructor() {
    // Tree-shaken Chart.js controller registration (frontend rule) - safe to call repeatedly.
    registerCharts();
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadCategories(), this.reload()]);
  }

  private async loadCategories(): Promise<void> {
    if (!isTauri()) return;
    try {
      const cats = await listCategories();
      this.categories.set(cats.filter((c) => c.kind === 'expense'));
    } catch {
      // Non-fatal: the category filter just offers "All categories" only.
    }
  }

  /** Guarded like every other bridge-calling action in the app (e.g. goal-form/transaction-form
   *  `save()`) so a filter change outside the Tauri runtime is a no-op rather than a thrown/rejected
   *  `invoke()`. */
  private async reload(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to view analytics.');
      return;
    }
    const requestId = ++this.latestRequestId;
    const firstLoad = this.data() === null;
    if (firstLoad) {
      this.loading.set(true);
    } else {
      this.refreshing.set(true);
    }
    this.error.set(null);
    try {
      const categoryId = this.categoryFilter() === ALL_CATEGORIES ? undefined : (this.categoryFilter() as number);
      const result = await getReport(this.period(), categoryId);
      // A newer reload (later filter/period change) may have started and already resolved while
      // this one was in flight - only the LATEST request's outcome may apply (fix for the request
      // race: a slow earlier response must never overwrite a newer selection's data).
      if (requestId !== this.latestRequestId) return;
      this.data.set(result);
    } catch (e) {
      if (requestId !== this.latestRequestId) return;
      this.error.set(toUserMessage(e));
    } finally {
      if (requestId === this.latestRequestId) {
        this.loading.set(false);
        this.refreshing.set(false);
      }
    }
  }

  protected onPeriodChange(value: string): void {
    this.period.set(value as ReportPeriod);
    void this.reload();
  }

  protected onCategoryChange(value: number | string): void {
    this.categoryFilter.set(value === ALL_CATEGORIES ? ALL_CATEGORIES : (value as number));
    void this.reload();
  }

  protected retry(): void {
    void this.reload();
  }

  protected addExpense(): void {
    void this.router.navigate(['/expenses/new']);
  }

  /** "Clear filter" action on the category-filtered-empty branch. */
  protected clearCategoryFilter(): void {
    this.categoryFilter.set(ALL_CATEGORIES);
    void this.reload();
  }

  /** "View all time" action on the period-filtered-empty branch. */
  protected viewAllTime(): void {
    this.period.set('allTime');
    void this.reload();
  }
}
