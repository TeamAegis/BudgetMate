import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LucidePencil } from '@lucide/angular';
import { listTransactions, listAccounts, getSettings, toUserMessage, isTauri } from '../../core/bridge';
import type { Transaction, Account } from '../../core/models';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { FabMenu, type FabMenuItem } from '../../shared/ui/fab-menu/fab-menu';
import { IconButton } from '../../shared/ui/icon-button/icon-button';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';

/** A transaction plus its position in the flattened (cross-group) list - drives the capped stagger. */
interface GroupItem {
  tx: Transaction;
  /** Cumulative index across all date groups, so the entrance stagger reads correctly. */
  flatIndex: number;
}

/** A run of transactions sharing one posted date, for the grouped list. */
interface DateGroup {
  date: string;
  items: GroupItem[];
}

/**
 * Transaction list (FR-1.1). Smart component: reads transactions/accounts through the bridge and
 * renders with shared/ui. Add/Edit are full-screen pages (`expenses/new`, `expenses/:id/edit`) - the
 * row's edit button and the FAB navigate there; this component never owns a form or a modal. All
 * money formatting goes through the `money` pipe (logic stays in Rust).
 */
@Component({
  selector: 'app-transactions',
  imports: [MoneyPipe, LucidePencil, FabMenu, IconButton, Banner, EmptyState, ListRow, Skeleton],
  templateUrl: './transactions.html',
  styleUrl: './transactions.scss',
})
export class Transactions implements OnInit {
  private readonly router = inject(Router);
  /** Placeholder row count shown while the list loads. */
  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  /** Tap-to-open FAB actions (replaces the old long-press): add by hand or scan a receipt. */
  protected readonly fabItems: FabMenuItem[] = [
    { id: 'add', label: 'Add expense', icon: 'plus' },
    { id: 'scan', label: 'Scan receipt', icon: 'scan' },
  ];

  protected readonly transactions = signal<Transaction[]>([]);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly baseCurrency = signal('MUR');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /**
   * Transactions grouped into consecutive runs by posted date (list is newest-first from Rust).
   * Each item carries a `flatIndex` (its position across all groups) so the capped entrance stagger
   * reads correctly instead of restarting per group.
   */
  protected readonly grouped = computed<DateGroup[]>(() => {
    const groups: DateGroup[] = [];
    let flatIndex = 0;
    for (const t of this.transactions()) {
      const item: GroupItem = { tx: t, flatIndex: flatIndex++ };
      const last = groups.at(-1);
      if (last && last.date === t.postedDate) last.items.push(item);
      else groups.push({ date: t.postedDate, items: [item] });
    }
    return groups;
  });

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to manage transactions.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const [txs, accts, settings] = await Promise.all([
        listTransactions(),
        listAccounts(false),
        getSettings(),
      ]);
      this.transactions.set(txs);
      this.accounts.set(accts);
      this.baseCurrency.set(settings.baseCurrency);
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected accountName(id: number): string {
    return this.accounts().find((a) => a.id === id)?.name ?? '-';
  }

  /** Category label for a list row: the single category, or each split's category for >=2. */
  protected categoryLabel(t: Transaction): string {
    if (t.splits.length <= 1) return t.splits[0]?.categoryName ?? '-';
    return t.splits.map((s) => s.categoryName).join(', ');
  }

  protected metaLine(t: Transaction): string {
    const cats = t.splits.length > 1 ? `${t.splits.length} splits` : this.categoryLabel(t);
    return `${cats} · ${this.accountName(t.accountId)}`;
  }

  protected addTransaction(): void {
    void this.router.navigate(['/expenses/new']);
  }

  /** Route a FAB-menu choice: add by hand, or open the on-device receipt scan flow. */
  protected onFabSelect(id: string): void {
    if (id === 'scan') void this.router.navigate(['/import']);
    else this.addTransaction();
  }

  /** Open the edit page, handing the row over via router state (fast path; refresh refetches). */
  protected editTransaction(t: Transaction): void {
    void this.router.navigate(['/expenses', t.id, 'edit'], { state: { transaction: t } });
  }
}
