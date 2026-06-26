import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LucidePlus, LucidePencil, LucidePlay, LucidePause } from '@lucide/angular';
import {
  listRecurringRules,
  setRecurringActive,
  listAccounts,
  listCategories,
  toUserMessage,
  isTauri,
} from '../../core/bridge';
import type { RecurringRule, Account, Category } from '../../core/models';
import { Button } from '../../shared/ui/button/button';
import { IconButton } from '../../shared/ui/icon-button/icon-button';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';

/**
 * Recurring rules list (FR-1.3). Smart component: reads rules/accounts/categories through the bridge
 * and renders with shared/ui. Add/Edit are full-screen pages (`settings/recurring/new`,
 * `settings/recurring/:id/edit`) - the Add button/empty CTA and the row's edit button navigate
 * there; this component never owns a form or a modal. Pause/resume stays here (no delete).
 * Occurrences materialise lazily on app open by the Rust core (no scheduler here).
 */
@Component({
  selector: 'app-recurring',
  imports: [
    LucidePlus,
    LucidePencil,
    LucidePlay,
    LucidePause,
    Button,
    IconButton,
    Banner,
    EmptyState,
    ListRow,
    Skeleton,
  ],
  templateUrl: './recurring.html',
  styleUrl: './recurring.scss',
})
export class Recurring implements OnInit {
  private readonly router = inject(Router);
  /** Placeholder row count shown while the list loads. */
  protected readonly skeletonRows = [0, 1, 2, 3];

  protected readonly rules = signal<RecurringRule[]>([]);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to manage recurring rules.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const [rules, accts, cats] = await Promise.all([
        listRecurringRules(),
        listAccounts(false),
        listCategories(false),
      ]);
      this.rules.set(rules);
      this.accounts.set(accts);
      this.categories.set(cats);
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected categoryName(id: number): string {
    return this.categories().find((c) => c.id === id)?.name ?? '-';
  }
  protected accountCurrency(r: RecurringRule): string {
    return this.accounts().find((a) => a.id === r.template.accountId)?.currency ?? '';
  }

  /** Expenses materialise as negative amounts, income/transfers as positive (matches the ledger). */
  protected isExpense(r: RecurringRule): boolean {
    return this.categories().find((c) => c.id === r.template.categoryId)?.kind === 'expense';
  }
  /** Signed display amount, e.g. "-250 MUR" / "+30000 MUR". */
  protected amountLabel(r: RecurringRule): string {
    return `${this.isExpense(r) ? '-' : '+'}${r.template.amount} ${this.accountCurrency(r)}`;
  }

  protected ruleTitle(r: RecurringRule): string {
    return r.template.payee || this.categoryName(r.template.categoryId);
  }
  protected ruleMeta(r: RecurringRule): string {
    const status = r.active ? `Next: ${r.nextRunDate}` : 'Paused';
    return `${r.schedule} · ${status}`;
  }

  protected addRecurring(): void {
    void this.router.navigate(['/settings/recurring/new']);
  }

  /** Open the edit page, handing the row over via router state (fast path; refresh refetches). */
  protected editRecurring(r: RecurringRule): void {
    void this.router.navigate(['/settings/recurring', r.id, 'edit'], {
      state: { recurringRule: r },
    });
  }

  protected async toggleActive(r: RecurringRule): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await setRecurringActive(r.id, !r.active);
      await this.reload();
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
