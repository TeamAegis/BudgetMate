import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Home } from './home';
import type { DashboardData, Goal, Transaction } from '../../core/models';

/**
 * `getDashboard`/`listTransactions` are named exports of `core/bridge`, and Jasmine's `spyOn`
 * cannot redefine a property on an ES module namespace object here (same constraint documented in
 * `features/reports/reports.spec.ts`). Karma never runs inside the Tauri runtime, so `isTauri()` is
 * reliably `false` here - `reload()` takes its real (guarded) no-op path and never calls the
 * bridge. That exercises the genuine "not running in the app shell" error state for free; the other
 * states are driven by seeding the component's own signals directly, exactly as `reload()` would
 * have set them. The component only ever imports from `core/bridge` (never `@tauri-apps/api`
 * directly), enforced project-wide by the `no-restricted-imports` ESLint rule.
 */
describe('Home', () => {
  function createFixture() {
    TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideRouter([])],
    });
    return TestBed.createComponent(Home);
  }

  const sampleGoal: Goal = {
    id: 1,
    name: 'Vacation',
    targetMinor: 100_000,
    currentMinor: 40_000,
    currency: 'MUR',
    targetDate: null,
    completed: false,
  };

  const sampleDashboard: DashboardData = {
    baseCurrency: 'MUR',
    totalBalanceMinor: 465_050,
    usableBalanceMinor: 425_025,
    goalsReservedMinor: 40_000,
    thisMonthSpendMinor: 50_075,
    balanceTrend: [
      { label: 'Feb', amountMinor: 100_000 },
      { label: 'Mar', amountMinor: 200_000 },
      { label: 'Apr', amountMinor: 300_000 },
      { label: 'May', amountMinor: 400_000 },
      { label: 'Jun', amountMinor: 440_000 },
      { label: 'Jul', amountMinor: 465_050 },
    ],
    goals: [sampleGoal],
    excludedAccounts: 0,
    excludedGoals: 0,
    isEmpty: false,
  };

  const emptyDashboard: DashboardData = {
    baseCurrency: 'MUR',
    totalBalanceMinor: 0,
    usableBalanceMinor: 0,
    goalsReservedMinor: 0,
    thisMonthSpendMinor: 0,
    balanceTrend: [],
    goals: [],
    excludedAccounts: 0,
    excludedGoals: 0,
    isEmpty: true,
  };

  const sampleTransaction: Transaction = {
    id: 1,
    accountId: 1,
    postedDate: '2026-07-05',
    amountMinor: -5_000,
    currency: 'MUR',
    fxRate: '1',
    baseAmountMinor: -5_000,
    payee: 'Supermarket',
    note: null,
    source: 'manual',
    sourceRef: null,
    pendingReview: false,
    createdAt: '2026-07-05T00:00:00Z',
    splits: [{ id: 1, categoryId: 1, categoryName: 'Groceries', amountMinor: -5_000 }],
  };

  type HomeInternals = {
    loading: { set(v: boolean): void };
    error: { set(v: string | null): void };
    dashboard: { (): DashboardData | null; set(v: DashboardData | null): void };
    transactions: { set(v: Transaction[]): void };
    refreshing: { set(v: boolean): void };
    reload(): Promise<void>;
  };

  it('error state: outside the Tauri runtime, ngOnInit reports the plain-language message (no data)', () => {
    const fixture = createFixture();
    fixture.detectChanges(); // runs ngOnInit -> !isTauri() -> guarded no-op with an error message
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('Run the app');
    expect(host.querySelector('app-empty-state')).toBeNull();
    expect(host.querySelector('app-balance-card')).toBeNull();
  });

  it('loading state: skeleton placeholders render while no data/error is present yet', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as HomeInternals;
    component.loading.set(true);
    component.error.set(null);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('app-skeleton').length).toBeGreaterThan(0);
  });

  it('teaching-empty state: dashboard.isEmpty shows the illustration + Add an expense CTA, not a fabricated Rs 0 hero', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as HomeInternals;
    component.loading.set(false);
    component.error.set(null);
    component.dashboard.set(emptyDashboard);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-empty-state')).not.toBeNull();
    expect(host.textContent).toContain('Add an expense');
    expect(host.querySelector('app-balance-card')).toBeNull();
  });

  it('populated state: renders the hero balance, ready-to-spend line, spend figure, recent activity, and goals', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as HomeInternals;
    component.loading.set(false);
    component.error.set(null);
    component.dashboard.set(sampleDashboard);
    component.transactions.set([sampleTransaction]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-empty-state')).toBeNull();
    expect(host.querySelector('app-balance-card')).not.toBeNull();
    // Total balance 465_050 minor -> Rs 4,650.50 via the shared money pipe.
    expect(host.textContent).toContain('4,650.50');
    // Ready-to-spend: usable 425_025 minor -> Rs 4,250.25.
    expect(host.textContent).toContain('4,250.25');
    expect(host.textContent).toContain('ready to spend');
    expect(host.textContent).toContain('set aside for goals');
    // Spend figure: 50_075 minor -> Rs 500.75.
    expect(host.textContent).toContain('Spent this month');
    expect(host.textContent).toContain('500.75');
    expect(host.textContent).toContain('so far');
    expect(host.querySelector('app-goal-progress-row')).not.toBeNull();
    expect(host.textContent).toContain('Supermarket');
    // The chart lives behind @defer (on viewport) - not rendered synchronously in this test.
    expect(host.querySelector('app-balance-trend-chart')).toBeNull();
  });

  it('over-committed usable balance is phrased gently as information, never an alarm', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as HomeInternals;
    component.loading.set(false);
    component.error.set(null);
    component.dashboard.set({ ...sampleDashboard, usableBalanceMinor: -10_000 });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('is more than your free balance right now');
  });

  it('no ready-to-spend line when nothing has been set aside for goals', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as HomeInternals;
    component.loading.set(false);
    component.error.set(null);
    component.dashboard.set({ ...sampleDashboard, goalsReservedMinor: 0 });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).not.toContain('ready to spend');
  });

  it('foreign-currency caveat note appears only when accounts/goals are excluded', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as HomeInternals;
    component.loading.set(false);
    component.error.set(null);
    component.dashboard.set(sampleDashboard); // excludedAccounts/excludedGoals both 0
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('included in this total yet');

    component.dashboard.set({ ...sampleDashboard, excludedAccounts: 1, excludedGoals: 2 });
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('1 account');
    expect(host.textContent).toContain('2 goals');
    expect(host.textContent).toContain("aren't included in this total yet");
  });

  it('busy state: a background refresh keeps the dashboard mounted and shows a spinner', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as HomeInternals;
    component.loading.set(false);
    component.error.set(null);
    component.dashboard.set(sampleDashboard);
    component.refreshing.set(true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    // The dashboard stays mounted (UI stays responsive) - never replaced by a blocking spinner.
    expect(host.querySelector('app-balance-card')).not.toBeNull();
    expect(host.querySelector('app-spinner')).not.toBeNull();
  });

  it('a non-fatal error during a refresh is shown alongside the still-mounted dashboard, not instead of it', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as HomeInternals;
    component.loading.set(false);
    component.dashboard.set(sampleDashboard);
    component.error.set('Could not refresh - please try again.');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-banner')).not.toBeNull();
    expect(host.querySelector('app-balance-card')).not.toBeNull();
  });

  it("request race: an earlier, slower reload must not overwrite a later, faster reload's result", async () => {
    // Drive the REAL private `reload()` (the request-id guard under test) through its actual
    // bridge call, not a re-implementation of the guard. Neither bridge function can be
    // `spyOn`-ed (named ES exports), but `isTauri()` and `invoke()` both key off the plain global
    // `window.__TAURI_INTERNALS__`, so setting that directly (no `@tauri-apps/api` import - stays
    // clear of the bridge-only ESLint rule) makes `reload()` take its real bridge-calling path with
    // a fully controllable, out-of-order resolving `get_dashboard` response.
    const globalWithInternals = globalThis as { __TAURI_INTERNALS__?: unknown };
    const priorInternals = globalWithInternals.__TAURI_INTERNALS__;

    const firstDashboard: DashboardData = { ...sampleDashboard, totalBalanceMinor: 1_111 };
    const secondDashboard: DashboardData = { ...sampleDashboard, totalBalanceMinor: 2_222 };
    const payloads = [firstDashboard, secondDashboard];
    const resolvers: Array<() => void> = [];
    let callCount = 0;

    globalWithInternals.__TAURI_INTERNALS__ = {
      invoke: (cmd: string): Promise<unknown> => {
        if (cmd === 'get_dashboard') {
          const index = callCount++;
          return new Promise<void>((resolve) => {
            resolvers[index] = resolve;
          }).then(() => payloads[index]);
        }
        if (cmd === 'list_transactions') {
          return Promise.resolve([]);
        }
        return Promise.resolve(null);
      },
    };

    try {
      const fixture = createFixture();
      // Deliberately skip fixture.detectChanges() (ngOnInit's own reload) so the two calls below
      // are the only overlapping requests in flight.
      const component = fixture.componentInstance as unknown as HomeInternals;

      const first = component.reload(); // request #1 - the SLOW one
      const second = component.reload(); // request #2 - the FAST one, requested later

      resolvers[1](); // #2 (the later request) resolves FIRST
      await second;
      resolvers[0](); // #1 (the earlier request) resolves AFTER - must be ignored as stale
      await first;

      expect(component.dashboard()?.totalBalanceMinor).toBe(
        2_222,
        "the later request's data must win even though the earlier request resolved after it",
      );
    } finally {
      globalWithInternals.__TAURI_INTERNALS__ = priorInternals;
    }
  });
});
