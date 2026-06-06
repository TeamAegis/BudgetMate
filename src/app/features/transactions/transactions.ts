import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucidePlus, LucidePencil, LucideTrash2 } from '@lucide/angular';
import {
  listTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  listAccounts,
  listCategories,
  isTauri,
} from '../../core/bridge';
import type { Transaction, Account, Category } from '../../core/models';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Button } from '../../shared/ui/button/button';
import { IconButton } from '../../shared/ui/icon-button/icon-button';
import { Card } from '../../shared/ui/card/card';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { FormField } from '../../shared/ui/form-field/form-field';

/** A run of transactions sharing one posted date, for the grouped list. */
interface DateGroup {
  date: string;
  items: Transaction[];
}

/**
 * Manual transaction entry + list (FR-1.1). Smart component: it reads accounts/categories/
 * transactions through the bridge and renders with shared/ui. All money parsing, signing, and
 * `base_amount_minor` derivation happen in Rust — TS only formats (the `money` pipe) and presents.
 */
@Component({
  selector: 'app-transactions',
  imports: [
    ReactiveFormsModule,
    MoneyPipe,
    LucidePlus,
    LucidePencil,
    LucideTrash2,
    Button,
    IconButton,
    Card,
    Banner,
    EmptyState,
    ListRow,
    FormField,
  ],
  templateUrl: './transactions.html',
  styleUrl: './transactions.scss',
})
export class Transactions implements OnInit {
  private readonly fb = inject(FormBuilder);

  protected readonly transactions = signal<Transaction[]>([]);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editingId = signal<number | null>(null);
  protected readonly showForm = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    accountId: [null as number | null, Validators.required],
    categoryId: [null as number | null, Validators.required],
    postedDate: [this.today(), Validators.required],
    // A non-negative decimal; Rust is the authority on precision/scale per currency.
    amount: ['', [Validators.required, Validators.pattern(/^\d+(\.\d+)?$/)]],
    payee: [''],
    note: [''],
  });

  /** Transactions grouped into consecutive runs by posted date (list is newest-first from Rust). */
  protected readonly grouped = computed<DateGroup[]>(() => {
    const groups: DateGroup[] = [];
    for (const t of this.transactions()) {
      const last = groups.at(-1);
      if (last && last.date === t.postedDate) last.items.push(t);
      else groups.push({ date: t.postedDate, items: [t] });
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
      const [txs, accts, cats] = await Promise.all([
        listTransactions(),
        listAccounts(false),
        listCategories(false),
      ]);
      this.transactions.set(txs);
      this.accounts.set(accts);
      this.categories.set(cats);
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected accountName(id: number): string {
    return this.accounts().find((a) => a.id === id)?.name ?? '—';
  }

  /** First split's category is the row's category (a manual entry has exactly one). */
  protected categoryName(t: Transaction): string {
    return t.splits[0]?.categoryName ?? '—';
  }

  protected startCreate(): void {
    this.editingId.set(null);
    this.form.reset({
      accountId: this.accounts()[0]?.id ?? null,
      categoryId: null,
      postedDate: this.today(),
      amount: '',
      payee: '',
      note: '',
    });
    this.error.set(null);
    this.showForm.set(true);
  }

  protected startEdit(t: Transaction): void {
    this.editingId.set(t.id);
    this.form.reset({
      accountId: t.accountId,
      categoryId: t.splits[0]?.categoryId ?? null,
      postedDate: t.postedDate,
      amount: this.majorAmount(t.amountMinor, t.currency),
      payee: t.payee ?? '',
      note: t.note ?? '',
    });
    this.error.set(null);
    this.showForm.set(true);
  }

  protected cancel(): void {
    this.showForm.set(false);
    this.error.set(null);
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    try {
      const input = {
        accountId: v.accountId as number,
        categoryId: v.categoryId as number,
        postedDate: v.postedDate,
        amount: v.amount,
        payee: v.payee.trim() || null,
        note: v.note.trim() || null,
      };
      const id = this.editingId();
      if (id === null) await createTransaction(input);
      else await updateTransaction({ id, ...input });
      this.showForm.set(false);
      await this.reload();
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(t: Transaction): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await deleteTransaction(t.id);
      await this.reload();
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** Today as `YYYY-MM-DD` for the date input's default (a date default, not money math). */
  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Stored signed minor units → a positive major-unit string for the edit field, using the
   * currency's fraction digits (the same Intl-derived scale the money pipe uses for display).
   */
  private majorAmount(amountMinor: number, currency: string): string {
    const digits =
      new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    return (Math.abs(amountMinor) / Math.pow(10, digits)).toFixed(digits);
  }
}
