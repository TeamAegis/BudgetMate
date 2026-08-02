import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LucideChevronRight } from '@lucide/angular';
import { listTransactions, listAccounts, getSettings, toUserMessage, isTauri } from '../../core/bridge';
import type { Transaction, Account } from '../../core/models';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { FriendlyDatePipe } from '../../shared/pipes/friendly-date.pipe';
import { FabMenu, type FabMenuItem } from '../../shared/ui/fab-menu/fab-menu';
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
 * renders with shared/ui. Tapping a row opens the read-only detail page (`expenses/:id`), where Edit
 * and Delete live (issue I5); the FAB adds a new entry. This component never owns a form or a modal.
 * All money formatting goes through the `money` pipe (logic stays in Rust).
 */
@Component({
  selector: 'app-transactions',
  imports: [MoneyPipe, FriendlyDatePipe, LucideChevronRight, FabMenu, Banner, EmptyState, ListRow, Skeleton],
  templateUrl: './transactions.html',
  styleUrl: './transactions.scss',
})
export class Transactions implements OnInit {
  private readonly router = inject(Router);
  /** Placeholder row count shown while the list loads. */
  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  /** Tap-to-open FAB actions. The labelled items carry the ADR 0004 kind decision, so "Add
   *  expense"/"Add income" deep-link straight to that kind's category picker (label honesty -
   *  the old lone "Add expense" opened a chooser that then asked expense-or-income). */
  protected readonly fabItems: FabMenuItem[] = [
    { id: 'add', label: 'Add expense', icon: 'plus' },
    { id: 'income', label: 'Add income', icon: 'plus' },
    { id: 'scan', label: 'Scan receipt', icon: 'scan' },
  ];

  /** Transient saved/deleted acknowledgement handed over via router state by the form
   *  (the peak-end moment of the core loop, ux-blueprint §5). */
  protected readonly savedNotice = signal<string | null>(null);

  constructor() {
    const saved = this.router.getCurrentNavigation()?.extras.state?.['saved'];
    if (typeof saved === 'string') {
      this.savedNotice.set(saved);
      setTimeout(() => this.savedNotice.set(null), 4000);
    }
  }

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

  /** Both legs of an account-to-account transfer carry the linking group id. */
  protected isTransfer(t: Transaction): boolean {
    return t.transferGroupId !== null;
  }

  protected metaLine(t: Transaction): string {
    const cats = t.splits.length > 1 ? `${t.splits.length} splits` : this.categoryLabel(t);
    // Label the row as a transfer in TEXT: it is neither spending nor income, and its amount is
    // rendered without the income/expense tint, so the word is what carries the meaning.
    const prefix = this.isTransfer(t) ? 'Transfer · ' : '';
    return `${prefix}${cats} · ${this.accountName(t.accountId)}`;
  }

  /** Row display name: payee if present, else the category label. */
  protected rowName(t: Transaction): string {
    return t.payee || this.categoryLabel(t);
  }

  /** First letter of the row name, for the leading avatar monogram. */
  protected monogram(name: string): string {
    return (name.trim()[0] ?? '?').toUpperCase();
  }

  protected addTransaction(): void {
    void this.router.navigate(['/expenses/new']);
  }

  /** Route a FAB-menu choice: the labelled items carry the kind, so they skip the chooser. */
  protected onFabSelect(id: string): void {
    if (id === 'scan') void this.router.navigate(['/import']);
    else if (id === 'income') void this.router.navigate(['/expenses/new/income']);
    else void this.router.navigate(['/expenses/new/expense']);
  }

  /** Open the read-only detail page, handing the row over via router state (fast path; refetches). */
  protected openTransaction(t: Transaction): void {
    void this.router.navigate(['/expenses', t.id], { state: { transaction: t } });
  }
}
