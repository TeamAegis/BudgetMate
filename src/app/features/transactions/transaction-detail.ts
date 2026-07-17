import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  listTransactions,
  listAccounts,
  getSettings,
  deleteTransaction,
  toUserMessage,
  isTauri,
} from '../../core/bridge';
import type { Transaction, Account } from '../../core/models';
import { HeaderActionService } from '../../core/layout/header-action.service';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { FriendlyDatePipe } from '../../shared/pipes/friendly-date.pipe';
import { Banner } from '../../shared/ui/banner/banner';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { FormActions } from '../../shared/ui/form-actions/form-actions';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { DetailRow } from '../../shared/ui/detail-row/detail-row';

/**
 * Full-screen read-only Transaction detail (FR-1.1, issue I5). The list card taps through to here;
 * Edit is the primary bottom-bar action (-> expenses/:id/edit) and Delete is the danger icon-button
 * in the header (ADR 0003, same placement as the edit forms) opening ConfirmDialog. Presentation
 * only: every amount goes through
 * the money pipe and the type label comes from the sign of the Rust-signed amountMinor - no money
 * math in TS. The entity is handed over via router state on the list tap (fast path); a deep link or
 * refresh refetches the list and finds it by id, mirroring transaction-form.
 */
@Component({
  selector: 'app-transaction-detail',
  imports: [MoneyPipe, FriendlyDatePipe, Banner, Skeleton, EmptyState, FormActions, ConfirmDialog, DetailRow],
  templateUrl: './transaction-detail.html',
  styleUrl: './transaction-detail.scss',
})
export class TransactionDetail implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly headerAction = inject(HeaderActionService);
  private readonly destroyRef = inject(DestroyRef);

  /** Entity handed over via router state at construction (consumed once; else refetched by id). */
  private readonly nav = this.router.getCurrentNavigation();
  private readonly passedTx =
    (this.nav?.extras.state?.['transaction'] as Transaction | undefined) ?? null;
  private readonly id = Number(this.route.snapshot.paramMap.get('id'));

  protected readonly tx = signal<Transaction | null>(null);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly baseCurrency = signal('MUR');
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notFound = signal(false);
  protected readonly confirmingDelete = signal(false);

  /** Sign-derived type label (matches the list's income/expense colouring; no category load needed). */
  protected readonly typeLabel = computed(() => {
    const t = this.tx();
    if (!t) return '';
    return t.amountMinor >= 0 ? 'Income' : 'Expense';
  });

  constructor() {
    // Delete lives in the header, exactly like the edit form (ADR 0003). Available once we have the tx.
    effect(() => {
      this.headerAction.set(
        this.tx()
          ? {
              label: 'Delete transaction',
              icon: 'trash',
              run: () => this.confirmingDelete.set(true),
            }
          : null,
      );
    });
    this.destroyRef.onDestroy(() => this.headerAction.clear());
  }

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to view a transaction.');
      return;
    }
    try {
      const [accts, settings] = await Promise.all([listAccounts(false), getSettings()]);
      this.accounts.set(accts);
      this.baseCurrency.set(settings.baseCurrency);
      const found =
        this.passedTx ?? (await listTransactions()).find((t) => t.id === this.id) ?? null;
      if (found) this.tx.set(found);
      else this.notFound.set(true);
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected accountName(id: number): string {
    return this.accounts().find((a) => a.id === id)?.name ?? '-';
  }

  protected backToList(): void {
    void this.router.navigate(['/expenses']);
  }

  protected edit(): void {
    const t = this.tx();
    if (!t) return;
    void this.router.navigate(['/expenses', t.id, 'edit'], { state: { transaction: t } });
  }

  protected async deleteConfirmed(): Promise<void> {
    const t = this.tx();
    if (!t) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await deleteTransaction(t.id);
      await this.router.navigate(['/expenses'], { state: { saved: 'Deleted' } });
    } catch (e) {
      this.error.set(toUserMessage(e));
      this.confirmingDelete.set(false);
    } finally {
      this.busy.set(false);
    }
  }
}
