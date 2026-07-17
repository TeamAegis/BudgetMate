import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucidePlus, LucideTarget, LucideScanLine } from '@lucide/angular';
import { getDashboard, listTransactions, toUserMessage, isTauri } from '../../core/bridge';
import type { DashboardData, Goal, Transaction } from '../../core/models';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { ActionTile } from '../../shared/ui/action-tile/action-tile';
import { Banner } from '../../shared/ui/banner/banner';
import { BalanceCard } from '../../shared/ui/balance-card/balance-card';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
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
    Banner,
    BalanceCard,
    BalanceTrendChart,
    Button,
    Card,
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
  protected readonly loading = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Monotonically increasing request id - guards a slow, superseded `reload()` from overwriting
   *  newer data (same pattern as `features/reports/reports.ts`). */
  private latestRequestId = 0;

  /** Newest few transactions (list is newest-first from Rust). */
  protected readonly recent = computed(() => this.transactions().slice(0, 5));

  protected readonly baseCurrency = computed(() => this.dashboard()?.baseCurrency ?? 'MUR');

  /** Quick-add in the thumb zone (same labelled menu as Expenses). "Add expense"/"Add income"
   *  ARE the ADR 0004 kind decision, so they deep-link straight to the category picker. */
  protected readonly fabItems: FabMenuItem[] = [
    { id: 'add', label: 'Add expense', icon: 'plus' },
    { id: 'income', label: 'Add income', icon: 'plus' },
    { id: 'scan', label: 'Scan receipt', icon: 'scan' },
  ];

  /** The plain-language line under the "Ready to spend" hero. Uses only Rust-computed figures
   *  (goalsReservedMinor); gently phrased as information when the free balance is over-committed
   *  (never alarm-red - financial-knowledge section 9). */
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

  /** Route a FAB-menu choice: the labelled items carry the kind, so they skip the chooser. */
  protected onFabSelect(id: string): void {
    if (id === 'scan') void this.router.navigate(['/import']);
    else if (id === 'income') void this.router.navigate(['/expenses/new/income']);
    else void this.router.navigate(['/expenses/new/expense']);
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
