import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Home } from './home';
import type { AllowanceSummary, DashboardData, Goal, Transaction } from '../../core/models';

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
    allowanceId: null,
    transferGroupId: null,
    splits: [{ id: 1, categoryId: 1, categoryName: 'Groceries', amountMinor: -5_000 }],
  };

  type HomeInternals = {
    loading: { set(v: boolean): void };
    error: { set(v: string | null): void };
    dashboard: { (): DashboardData | null; set(v: DashboardData | null): void };
    transactions: { set(v: Transaction[]): void };
    allowanceSummary: { set(v: AllowanceSummary | null): void };
    refreshing: { set(v: boolean): void };
    reload(): Promise<void>;
  };

  const sampleAllowanceSummary: AllowanceSummary = {
    allowances: [
      {
        id: 1,
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
        reservedMinor: 30_050,
        overspent: false,
        underfunded: true,
      },
    ],
    totalMinor: 500_000,
    reservedMinor: 30_050,
    availableMinor: 469_950,
    // The allowance above is a 1500.00 weekly with 300.00 left, so 1200.00 of it has been used.
    targetTotalMinor: 150_000,
    usedMinor: 120_000,
    baseCurrency: 'MUR',
    excludedAllowances: 0,
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
    // One add affordance at a time: the quick-add menu yields to the empty state's CTA.
    expect(host.querySelector('app-fab-menu')).toBeNull();
  });

  it('quick-add menu: offers allowance and budget alongside the transaction actions', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as HomeInternals;
    component.loading.set(false);
    component.error.set(null);
    component.dashboard.set(sampleDashboard);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const fab = host.querySelector('app-fab-menu');
    expect(fab).not.toBeNull();

    // Open it and check the labels: allowances and budgets are otherwise buried in Settings.
    host.querySelector<HTMLButtonElement>('.fab')!.click();
    fixture.detectChanges();
    const labels = Array.from(host.querySelectorAll('.fab-item')).map((i) => i.textContent ?? '');
    expect(labels.length).toBe(5);
    expect(labels.some((l) => l.includes('Add expense'))).toBe(true);
    expect(labels.some((l) => l.includes('Add income'))).toBe(true);
    expect(labels.some((l) => l.includes('Scan receipt'))).toBe(true);
    expect(labels.some((l) => l.includes('Add allowance'))).toBe(true);
    expect(labels.some((l) => l.includes('Add budget'))).toBe(true);
  });

  it('populated state: hero is the safe-to-spend figure, with total balance as a secondary stat', () => {
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
    // The hero answers "what can I spend": usable 425_025 minor -> Rs 4,250.25.
    expect(host.textContent).toContain('Safe to spend');
    expect(host.textContent).toContain('4,250.25');
    expect(host.textContent).toContain('set aside for goals');
    // Total balance is demoted to a secondary stat in the hero card's footer: 465_050 -> Rs 4,650.50.
    expect(host.textContent).toContain('Total balance');
    expect(host.textContent).toContain('4,650.50');
    // Spend figure, also in the hero footer: 50_075 minor -> Rs 500.75.
    expect(host.textContent).toContain('Spent this month');
    expect(host.textContent).toContain('500.75');
    // Both secondary figures live INSIDE the hero card, under its hairline rule (ADR 0013 era
    // redesign) - not in separate stat cards competing with the headline figure.
    expect(host.querySelector('app-balance-card .hero-stats')).not.toBeNull();
    expect(host.querySelector('app-goal-progress-row')).not.toBeNull();
    expect(host.textContent).toContain('Supermarket');
    // The chart lives behind @defer (on viewport) - not rendered synchronously in this test.
    expect(host.querySelector('app-balance-trend-chart')).toBeNull();
  });

  it('orders sections so the actionable content precedes the trend chart', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as HomeInternals;
    component.loading.set(false);
    component.error.set(null);
    component.dashboard.set(sampleDashboard);
    component.transactions.set([sampleTransaction]);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // The trend is context, not the answer, so it comes last - see home.html.
    const order = [
      'Safe to spend',
      'Spent this month',
      'Quick actions',
      'Recent activity',
      'Goals',
      'Balance trend',
    ];
    const positions = order.map((s) => text.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true, `all sections must render: ${positions.join(',')}`);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(
        positions[i - 1],
        `"${order[i]}" must come after "${order[i - 1]}"`,
      );
    }
  });

  it('recent-activity row shows the base-currency equivalent only for a foreign-currency transaction', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as HomeInternals;
    component.loading.set(false);
    component.error.set(null);
    component.dashboard.set(sampleDashboard); // baseCurrency: MUR
    const foreignTransaction: Transaction = {
      ...sampleTransaction,
      id: 2,
      currency: 'USD',
      amountMinor: -1_000,
      baseAmountMinor: -45_050,
    };
    component.transactions.set([sampleTransaction, foreignTransaction]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const baseLines = host.querySelectorAll('.amount-cell .base');
    // Only the foreign-currency row (USD, base MUR) gets a base-equivalent line.
    expect(baseLines.length).toBe(1);
    // baseAmountMinor -45_050 minor MUR -> Rs 450.50.
    expect(baseLines[0].textContent).toContain('450.50');
  });

  it('goals preview: an empty goals list shows a teaching line, not a vanished section', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as HomeInternals;
    component.loading.set(false);
    component.error.set(null);
    component.dashboard.set({ ...sampleDashboard, goals: [] });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-goal-progress-row')).toBeNull();
    expect(host.textContent).toContain('Goals');
    expect(host.textContent).toContain('All goals');
    expect(host.textContent).toContain('No goals yet. Add one with the actions above.');
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

  it('shows the allowances CARD with its usage progress once the allowance summary loads', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as HomeInternals;
    component.loading.set(false);
    component.error.set(null);
    component.dashboard.set(sampleDashboard);
    component.allowanceSummary.set(sampleAllowanceSummary);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const card = host.querySelector('app-allowance-summary-card');
    expect(card).not.toBeNull();
    // usedMinor 120_000 of targetTotalMinor 150_000, both derived in Rust. A card, not the loose
    // sentence Home used to carry - and never conflated with the goals ready-to-spend figure.
    // Asserted on the numerals: the money pipe joins symbol and amount with a non-breaking space.
    const text = card!.textContent!;
    expect(text).toContain('1,200');
    expect(text).toContain('1,500');
    expect(host.textContent).not.toContain('set aside across your allowances');
  });

  it('omits the allowances line entirely when the user has none yet (no clutter)', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as HomeInternals;
    component.loading.set(false);
    component.error.set(null);
    component.dashboard.set(sampleDashboard);
    component.allowanceSummary.set({ ...sampleAllowanceSummary, allowances: [] });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).not.toContain('set aside across your allowances');
  });

  it('with nothing set aside for goals, the hero says so instead of implying a hidden reserve', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as HomeInternals;
    component.loading.set(false);
    component.error.set(null);
    component.dashboard.set({ ...sampleDashboard, goalsReservedMinor: 0 });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("That's your whole balance");
    // Not the "after Rs N set aside for goals" explainer - there is no reserve to explain.
    expect(host.textContent).not.toContain('after Rs');
    // No goals reserve means the hero already IS the total, so the duplicate stat is suppressed.
    expect(host.textContent).not.toContain('Total balance');
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
