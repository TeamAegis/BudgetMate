import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucidePlus, LucideTarget, LucideScanLine } from '@lucide/angular';
import { getDashboard, listTransactions, getAllowanceSummary, toUserMessage, isTauri } from '../../core/bridge';
import type { AllowanceSummary, DashboardData, Goal, Transaction } from '../../core/models';
import { withOrigin } from '../../core/navigation/origin';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { ActionTile } from '../../shared/ui/action-tile/action-tile';
import { AllowanceSummaryCard } from '../../shared/ui/allowance-summary-card/allowance-summary-card';
import { Banner } from '../../shared/ui/banner/banner';
import { BalanceCard } from '../../shared/ui/balance-card/balance-card';
import { Button } from '../../shared/ui/button/button';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { FabMenu, type FabMenuItem } from '../../shared/ui/fab-menu/fab-menu';
import { GoalProgressRow } from '../../shared/ui/goal-progress-row/goal-progress-row';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { Spinner } from '../../shared/ui/spinner/spinner';
import type { LinePoint } from '../../shared/ui/line-chart/line-chart';
// `BalanceTrendChart` (and therefore `LineChart`/Chart.js) is imported here ONLY so the Angular
// compiler can see it for the `@defer` block in home.html - it is referenced NOWHERE in the
// template outside that block, which is what lets the compiler code-split it (+ LineChart +
// Chart.js) into its own lazy chunk instead of Home's own eager, first-paint chunk (cold-start
// budget - see balance-trend-chart.ts's doc comment). Do not use it outside the @defer block.
import { BalanceTrendChart } from './balance-trend-chart/balance-trend-chart';

/**
 * Home / Dashboard (FR issue #50): a live hero balance, a "ready to spend" secondary figure (total
 * minus what's set aside for ongoing goals), this-month spend, a lazily-loaded balance-trend chart,
 * a Recent activity list, and a goals preview - all sourced from Rust's `get_dashboard()` aggregate
 * (`core/bridge`). All money math (fx-aware summing, goal netting, month bucketing) happens in
 * Rust; this component only formats (via the shared money pipe) and presents.
 */
@Component({
  selector: 'app-home',
  imports: [
    RouterLink,
    LucidePlus,
    LucideTarget,
    LucideScanLine,
    MoneyPipe,
    ActionTile,
    AllowanceSummaryCard,
    Banner,
    BalanceCard,
    BalanceTrendChart,
    Button,
    EmptyState,
    FabMenu,
    GoalProgressRow,
    ListRow,
    Skeleton,
    Spinner,
  ],
  providers: [MoneyPipe],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnInit {
  private readonly router = inject(Router);
  private readonly money = inject(MoneyPipe);

  protected readonly dashboard = signal<DashboardData | null>(null);
  protected readonly transactions = signal<Transaction[]>([]);
  /** Best-effort (FR-3.4): a small free-vs-set-aside line, shown only once the user has at least
   *  one allowance. A failed fetch just omits the line - it never blocks the rest of Home. */
  protected readonly allowanceSummary = signal<AllowanceSummary | null>(null);
  protected readonly loading = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Monotonically increasing request id - guards a slow, superseded `reload()` from overwriting
   *  newer data (same pattern as `features/reports/reports.ts`). */
  private latestRequestId = 0;

  /** Newest few transactions (list is newest-first from Rust). */
  protected readonly recent = computed(() => this.transactions().slice(0, 4));

  /**
   * Quick-add menu on the landing tab. Labelled items only (never an icon alone) - the label IS the
   * choice, which is what lets Add expense / Add income skip the kind chooser (ADR 0004).
   */
  protected readonly fabItems: FabMenuItem[] = [
    { id: 'add', label: 'Add expense', icon: 'plus' },
    { id: 'income', label: 'Add income', icon: 'plus' },
    { id: 'scan', label: 'Scan receipt', icon: 'scan' },
    { id: 'allowance', label: 'Add allowance', icon: 'allowance' },
    { id: 'budget', label: 'Add budget', icon: 'budget' },
  ];

  protected readonly baseCurrency = computed(() => this.dashboard()?.baseCurrency ?? 'MUR');

  /** The plain-language line under the "Safe to spend" hero, explaining what the figure already
   *  accounts for. The hero itself now carries the usable figure, so this no longer repeats the
   *  amount. Uses only Rust-computed figures (goalsReservedMinor); gently phrased as information
   *  when the free balance is over-committed (never alarm-red - financial-knowledge section 9). */
  protected readonly heroSubline = computed<string | null>(() => {
    const d = this.dashboard();
    if (!d) return null;
    if (d.goalsReservedMinor <= 0) {
      return "That's your whole balance - nothing set aside for goals yet.";
    }
    const reserved = this.money.transform({ amountMinor: d.goalsReservedMinor, currency: d.baseCurrency });
    if (d.usableBalanceMinor < 0) {
      return `${reserved} set aside for goals is more than your free balance right now.`;
    }
    return `after ${reserved} set aside for goals`;
  });

  /** Plain-language note when a foreign-currency account/goal isn't included in the totals yet
   *  (their openings/reservations can't be honestly converted - see `domain::dashboard`). */
  protected readonly caveatNote = computed<string | null>(() => {
    const d = this.dashboard();
    if (!d) return null;
    const parts: string[] = [];
    if (d.excludedAccounts > 0) {
      parts.push(`${d.excludedAccounts} account${d.excludedAccounts === 1 ? '' : 's'}`);
    }
    if (d.excludedGoals > 0) {
      parts.push(`${d.excludedGoals} goal${d.excludedGoals === 1 ? '' : 's'}`);
    }
    if (parts.length === 0) return null;
    const verb = d.excludedAccounts + d.excludedGoals === 1 ? "isn't" : "aren't";
    return `${parts.join(' and ')} in another currency ${verb} included in this total yet.`;
  });

  protected readonly linePoints = computed<LinePoint[]>(
    () => this.dashboard()?.balanceTrend.map((p) => ({ label: p.label, amountMinor: p.amountMinor })) ?? [],
  );

  /** Skip the chart entirely for an all-zero first run (a flat line at zero teaches nothing). */
  protected readonly showTrend = computed<boolean>(() => {
    const points = this.linePoints();
    return points.length >= 2 && points.some((p) => p.amountMinor !== 0);
  });

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to see your activity.');
      return;
    }
    const requestId = ++this.latestRequestId;
    const firstLoad = this.dashboard() === null;
    if (firstLoad) {
      this.loading.set(true);
    } else {
      this.refreshing.set(true);
    }
    this.error.set(null);
    try {
      const [dash, txs] = await Promise.all([getDashboard(), listTransactions()]);
      // A newer reload may have started and already resolved while this one was in flight - only
      // the LATEST request's outcome may apply (mirrors reports.ts's request-race fix).
      if (requestId !== this.latestRequestId) return;
      this.dashboard.set(dash);
      this.transactions.set(txs);
      // Best-effort, non-blocking (FR-3.4): a failed fetch just omits `allowanceLine` above rather
      // than failing the whole Home load.
      try {
        const allowances = await getAllowanceSummary();
        if (requestId === this.latestRequestId) this.allowanceSummary.set(allowances);
      } catch {
        // ignore - see above
      }
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

  protected retry(): void {
    void this.reload();
  }

  protected addExpense(): void {
    void this.router.navigate(['/expenses/new']);
  }

  /** Hand off from the allowances card to the full list. */
  protected openAllowances(): void {
    void this.router.navigate(['/allowances']);
  }

  /**
   * Route a quick-add choice. Add expense / Add income deep-link PAST the ADR 0004 kind chooser -
   * picking the labelled item already is that decision, so re-asking would be a dead step. The
   * allowance and budget entries surface two features that were otherwise reachable only by digging
   * through Settings.
   */
  protected onFabSelect(id: string): void {
    switch (id) {
      case 'scan':
        void this.router.navigate(['/import']);
        break;
      case 'income':
        void this.router.navigate(['/expenses/new/income']);
        break;
      // Stamp the origin so saving returns here, not to a feature list the user never opened.
      case 'allowance':
        void this.router.navigate(['/allowances/new'], { state: withOrigin(this.router) });
        break;
      case 'budget':
        void this.router.navigate(['/budgets/new'], { state: withOrigin(this.router) });
        break;
      default:
        void this.router.navigate(['/expenses/new/expense']);
    }
  }

  /** First letter of the row's display name, for the avatar monogram. */
  protected monogram(name: string): string {
    return (name.trim()[0] ?? '?').toUpperCase();
  }

  protected categoryLabel(t: Transaction): string {
    if (t.splits.length <= 1) return t.splits[0]?.categoryName ?? '-';
    return `${t.splits.length} splits`;
  }

  protected rowName(t: Transaction): string {
    return t.payee || this.categoryLabel(t);
  }

  protected rowMeta(t: Transaction): string {
    return `${this.categoryLabel(t)} · ${t.postedDate}`;
  }

  /** Open a goal's detail page from the preview (mirrors the Goals list hand-off). */
  protected openGoal(g: Goal): void {
    void this.router.navigate(['/goals', g.id], { state: { goal: g } });
  }
}
