import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucidePlus, LucidePencil, LucideTrash2, LucideX } from '@lucide/angular';
import {
  listTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  listAccounts,
  listCategories,
  getSettings,
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

const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Manual transaction entry + list (FR-1.1) with split support (FR-1.2). Smart component: it reads
 * accounts/categories/transactions through the bridge and renders with shared/ui. All money
 * parsing, signing, the split-sum invariant, and `base_amount_minor` happen in Rust — TS only
 * formats (the `money` pipe) and shows a live "remaining to allocate" hint (Rust re-validates).
 */
@Component({
  selector: 'app-transactions',
  imports: [
    ReactiveFormsModule,
    MoneyPipe,
    LucidePlus,
    LucidePencil,
    LucideTrash2,
    LucideX,
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
  protected readonly baseCurrency = signal('MUR');
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editingId = signal<number | null>(null);
  protected readonly showForm = signal(false);

  protected readonly form = this.fb.group({
    accountId: this.fb.control<number | null>(null, Validators.required),
    postedDate: this.fb.nonNullable.control(this.today(), Validators.required),
    amount: this.fb.nonNullable.control('', [Validators.required, Validators.pattern(DECIMAL)]),
    currency: this.fb.nonNullable.control('MUR', [
      Validators.required,
      Validators.pattern(/^[A-Za-z]{3}$/),
    ]),
    fxRate: this.fb.nonNullable.control('1', [Validators.required, Validators.pattern(DECIMAL)]),
    payee: this.fb.nonNullable.control(''),
    note: this.fb.nonNullable.control(''),
    splits: this.fb.array([this.newSplitGroup()]),
  });

  constructor() {
    // With a single split the amount IS the total — keep them in lock-step so the simple case
    // needs no per-split entry. With ≥2 splits the user allocates each line explicitly.
    this.form.controls.amount.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      if (this.splits.length === 1) {
        this.splits.at(0).get('amount')!.setValue(v ?? '', { emitEvent: false });
      }
    });
  }

  protected get splits(): FormArray {
    return this.form.controls.splits;
  }

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
      const [txs, accts, cats, settings] = await Promise.all([
        listTransactions(),
        listAccounts(false),
        listCategories(false),
        getSettings(),
      ]);
      this.transactions.set(txs);
      this.accounts.set(accts);
      this.categories.set(cats);
      this.baseCurrency.set(settings.baseCurrency);
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected accountName(id: number): string {
    return this.accounts().find((a) => a.id === id)?.name ?? '—';
  }

  /** Category label for a list row: the single category, or each split's category for ≥2. */
  protected categoryLabel(t: Transaction): string {
    if (t.splits.length <= 1) return t.splits[0]?.categoryName ?? '—';
    return t.splits.map((s) => s.categoryName).join(', ');
  }

  protected metaLine(t: Transaction): string {
    const cats = t.splits.length > 1 ? `${t.splits.length} splits` : this.categoryLabel(t);
    return `${cats} · ${this.accountName(t.accountId)}`;
  }

  // ── Split editor ──────────────────────────────────────────────────────────────

  private newSplitGroup(amount = ''): FormGroup {
    return this.fb.group({
      categoryId: this.fb.control<number | null>(null, Validators.required),
      amount: this.fb.nonNullable.control(amount, [Validators.required, Validators.pattern(DECIMAL)]),
    });
  }

  protected addSplit(): void {
    // Leaving single mode: clear the first line so the user allocates both against the total.
    if (this.splits.length === 1) this.splits.at(0).get('amount')!.setValue('');
    this.splits.push(this.newSplitGroup());
  }

  protected removeSplit(i: number): void {
    this.splits.removeAt(i);
    if (this.splits.length === 1) {
      // Back to single mode: the lone split tracks the total again.
      this.splits.at(0).get('amount')!.setValue(this.form.controls.amount.value);
    }
  }

  /** The transaction currency from the form (drives display + the remaining-to-allocate hint). */
  protected currentCurrency(): string {
    const c = this.form.controls.currency.value?.trim().toUpperCase();
    if (c) return c;
    return this.accounts().find((a) => a.id === this.form.controls.accountId.value)?.currency ?? 'MUR';
  }

  /** Show the fx-rate field only when recording in a currency other than the base (FR-1.4). */
  protected showFx(): boolean {
    return this.currentCurrency() !== this.baseCurrency();
  }

  /** Remaining-to-allocate in minor units (total − Σ splits). Exact integer math, display only. */
  protected remainingMinor(): number {
    const currency = this.currentCurrency();
    const total = this.toMinor(this.form.controls.amount.value, currency) ?? 0;
    const allocated = this.splits.controls.reduce(
      (sum, g) => sum + (this.toMinor(g.get('amount')!.value as string, currency) ?? 0),
      0,
    );
    return total - allocated;
  }

  /** True when splits don't yet add up to the total (only meaningful with ≥2 splits). */
  protected unbalanced(): boolean {
    return this.splits.length > 1 && this.remainingMinor() !== 0;
  }

  protected startCreate(): void {
    this.editingId.set(null);
    const account = this.accounts()[0] ?? null;
    this.resetForm({ accountId: account?.id ?? null, currency: account?.currency ?? this.baseCurrency() });
    this.error.set(null);
    this.showForm.set(true);
  }

  protected startEdit(t: Transaction): void {
    this.editingId.set(t.id);
    this.resetForm({
      accountId: t.accountId,
      currency: t.currency,
      fxRate: t.fxRate,
      postedDate: t.postedDate,
      amount: this.majorAmount(t.amountMinor, t.currency),
      payee: t.payee ?? '',
      note: t.note ?? '',
      splits: t.splits.map((s) => ({
        categoryId: s.categoryId,
        amount: this.majorAmount(s.amountMinor, t.currency),
      })),
    });
    this.error.set(null);
    this.showForm.set(true);
  }

  private resetForm(opts: {
    accountId?: number | null;
    currency?: string;
    fxRate?: string;
    postedDate?: string;
    amount?: string;
    payee?: string;
    note?: string;
    splits?: { categoryId: number; amount: string }[];
  }): void {
    const splitData = opts.splits?.length ? opts.splits : [{ categoryId: null, amount: opts.amount ?? '' }];
    this.splits.clear();
    for (const s of splitData) {
      const g = this.newSplitGroup(s.amount);
      g.get('categoryId')!.setValue(s.categoryId);
      this.splits.push(g);
    }
    this.form.reset({
      accountId: opts.accountId ?? null,
      currency: opts.currency ?? this.baseCurrency(),
      fxRate: opts.fxRate ?? '1',
      postedDate: opts.postedDate ?? this.today(),
      amount: opts.amount ?? '',
      payee: opts.payee ?? '',
      note: opts.note ?? '',
    });
  }

  protected cancel(): void {
    this.showForm.set(false);
    this.error.set(null);
  }

  protected async save(): Promise<void> {
    if (this.form.invalid || this.unbalanced()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const splits = this.splits.controls.map((g) => ({
      categoryId: g.get('categoryId')!.value as number,
      amount: g.get('amount')!.value as string,
    }));
    const currency = this.currentCurrency();
    this.busy.set(true);
    this.error.set(null);
    try {
      const input = {
        accountId: v.accountId as number,
        postedDate: v.postedDate,
        amount: v.amount,
        currency,
        // A foreign-currency entry carries the user rate; same-currency stays at 1.
        fxRate: currency === this.baseCurrency() ? '1' : v.fxRate,
        splits,
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

  /** Minor-unit digits for a currency (same Intl-derived scale the money pipe uses for display). */
  private fractionDigits(currency: string): number {
    return (
      new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  }

  /** Exact integer parse of a major-unit string → minor units for display math; null if invalid. */
  private toMinor(s: string, currency: string): number | null {
    if (!DECIMAL.test(s.trim())) return null;
    const digits = this.fractionDigits(currency);
    const [intPart, fracRaw = ''] = s.trim().split('.');
    if (fracRaw.length > digits) return null;
    const frac = (fracRaw + '0'.repeat(digits)).slice(0, digits);
    return Number(intPart) * Math.pow(10, digits) + Number(frac || '0');
  }

  /** Stored signed minor units → a positive major-unit string for the edit fields. */
  private majorAmount(amountMinor: number, currency: string): string {
    const digits = this.fractionDigits(currency);
    return (Math.abs(amountMinor) / Math.pow(10, digits)).toFixed(digits);
  }
}
