import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucidePlus, LucideTarget, LucideScanLine } from '@lucide/angular';
import { listTransactions, listGoals, toUserMessage, isTauri } from '../../core/bridge';
import type { Transaction, Goal } from '../../core/models';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { ActionTile } from '../../shared/ui/action-tile/action-tile';
import { BalanceCard } from '../../shared/ui/balance-card/balance-card';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { GoalProgressRow } from '../../shared/ui/goal-progress-row/goal-progress-row';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { Banner } from '../../shared/ui/banner/banner';

/**
 * Home / Dashboard (old-Juice layout): a hero summary, labelled quick-action tiles, then a live
 * Recent activity list and a goals preview - both from existing bridge data (display only; amounts
 * come from Rust as minor units, formatted by the money pipe - never TS money math). The hero's live
 * spend total needs the deferred `get_dashboard()` command, so for now it shows an honest
 * count-based caption (counting and date filtering are not money math).
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
    BalanceCard,
    ListRow,
    GoalProgressRow,
    Skeleton,
    Banner,
  ],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnInit {
  private readonly router = inject(Router);
  protected readonly skeletonRows = [0, 1, 2];

  protected readonly transactions = signal<Transaction[]>([]);
  protected readonly goals = signal<Goal[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /** Newest few transactions (list is newest-first from Rust). */
  protected readonly recent = computed(() => this.transactions().slice(0, 4));
  /** Up to two ongoing goals for the preview. */
  protected readonly topGoals = computed(() => this.goals().filter((g) => !g.completed).slice(0, 2));

  /** Count of this-month transactions (date filtering + length only - not money math). */
  private readonly monthCount = computed(() => {
    const ym = new Date().toISOString().slice(0, 7);
    return this.transactions().filter((t) => t.postedDate.startsWith(ym)).length;
  });
  /** Honest hero caption until the Rust dashboard total exists - a count, not a fabricated figure. */
  protected readonly heroCaption = computed(() => {
    const n = this.monthCount();
    if (n === 0) return 'No transactions yet this month - add your first below.';
    return `${n} transaction${n === 1 ? '' : 's'} this month`;
  });

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to see your activity.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const [txs, goals] = await Promise.all([listTransactions(), listGoals()]);
      this.transactions.set(txs);
      this.goals.set(goals);
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
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

  /** Open a goal's edit page from the preview (mirrors the Goals list hand-off). */
  protected editGoal(g: Goal): void {
    void this.router.navigate(['/goals', g.id, 'edit'], { state: { goal: g } });
  }
}
