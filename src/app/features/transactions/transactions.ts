import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
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
  previewRules,
  toUserMessage,
  isTauri,
} from '../../core/bridge';
import type { Transaction, Account, Category, TransactionPrefill } from '../../core/models';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Button } from '../../shared/ui/button/button';
import { Fab } from '../../shared/ui/fab/fab';
import { IconButton } from '../../shared/ui/icon-button/icon-button';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { FormField } from '../../shared/ui/form-field/form-field';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { Modal } from '../../shared/ui/modal/modal';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';

/** A transaction plus its position in the flattened (cross-group) list - drives the capped stagger. */
interface GroupItem {
  tx: Transaction;
  /** Cumulative index across all date groups, so the entrance stagger reads correctly (A12). */
  flatIndex: number;
}

/** A run of transactions sharing one posted date, for the grouped list. */
interface DateGroup {
  date: string;
  items: GroupItem[];
}

const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Manual transaction entry + list (FR-1.1) with split support (FR-1.2). Smart component: it reads
 * accounts/categories/transactions through the bridge and renders with shared/ui. All money
 * parsing, signing, the split-sum invariant, and `base_amount_minor` happen in Rust - TS only
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
    Fab,
    IconButton,
    Banner,
    EmptyState,
    ListRow,
    FormField,
    Skeleton,
    Modal,
    ConfirmDialog,
    SelectField,
  ],
  templateUrl: './transactions.html',
  styleUrl: './transactions.scss',
})
export class Transactions implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  /** OCR/scan hand-off captured from router state at construction (consumed once after load). */
  private readonly pendingPrefill: TransactionPrefill | null =
    (this.router.getCurrentNavigation()?.extras.state?.['transactionPrefill'] as
      | TransactionPrefill
      | undefined) ?? null;
  /** Placeholder row count shown while the list loads. */
  protected readonly skeletonRows = [0, 1, 2, 3, 4];

  protected readonly transactions = signal<Transaction[]>([]);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly baseCurrency = signal('MUR');
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editingId = signal<number | null>(null);
  protected readonly showForm = signal(false);
  /** True while the modal is editing an existing transaction (vs adding) - drives the footer trash. */
  protected readonly editing = computed(() => this.editingId() !== null);
  /** Set while the delete-confirm dialog is open over the edit modal. */
  protected readonly confirmingDelete = signal(false);
  /** Category name a rule suggested from the payee (shown as an inspectable, overridable hint). */
  protected readonly suggestedCategory = signal<string | null>(null);

  /** Themed-dropdown options (native <select> can't be styled in the WebView - see SelectField). */
  protected readonly accountOptions = computed<SelectOption[]>(() =>
    this.accounts().map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` })),
  );
  protected readonly categoryOptions = computed<SelectOption[]>(() =>
    this.categories().map((c) => ({ value: c.id, label: `${c.name} · ${c.kind}` })),
  );

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
    // With a single split the amount IS the total - keep them in lock-step so the simple case
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

  // ── Inline validation messages (A9) ──────────────────────────────────────────
  // Each returns a plain-language message only when the control is invalid AND touched, so the
  // form-field flags the error inline; null otherwise. Validators are unchanged.

  protected amountError(): string | null {
    const c = this.form.controls.amount;
    if (!c.invalid || !c.touched) return null;
    return c.hasError('required') ? 'Enter an amount.' : 'Amount must be a number greater than 0.';
  }

  protected currencyError(): string | null {
    const c = this.form.controls.currency;
    if (!c.invalid || !c.touched) return null;
    return 'Use a 3-letter currency code, e.g. MUR.';
  }

  protected splitAmountError(i: number): string | null {
    const c = this.splits.at(i).get('amount')!;
    if (!c.invalid || !c.touched) return null;
    return c.hasError('required') ? 'Enter an amount.' : 'Amount must be a number greater than 0.';
  }

  /**
   * Transactions grouped into consecutive runs by posted date (list is newest-first from Rust).
   * Each item carries a `flatIndex` (its position across all groups) so the capped entrance stagger
   * reads correctly instead of restarting per group (A12).
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
    // A scan/OCR hand-off (FR-2.1) opens the create modal pre-filled; the user still reviews + Saves.
    if (this.pendingPrefill && this.accounts().length > 0) {
      this.startCreate(this.pendingPrefill);
    }
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
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected accountName(id: number): string {
    return this.accounts().find((a) => a.id === id)?.name ?? '-';
  }

  /** Category label for a list row: the single category, or each split's category for ≥2. */
  protected categoryLabel(t: Transaction): string {
    if (t.splits.length <= 1) return t.splits[0]?.categoryName ?? '-';
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

  protected startCreate(prefill?: TransactionPrefill): void {
    this.editingId.set(null);
    const account = this.accounts()[0] ?? null;
    const currency = account?.currency ?? this.baseCurrency();
    // OCR suggestions (FR-2.1) only PREFILL the editable form - the user confirms before Save.
    this.resetForm({
      accountId: account?.id ?? null,
      currency,
      postedDate: prefill?.postedDate ?? undefined,
      amount:
        prefill?.totalMinor != null ? this.majorAmount(prefill.totalMinor, currency) : undefined,
      payee: prefill?.payee ?? undefined,
    });
    this.suggestedCategory.set(null);
    this.error.set(null);
    this.showForm.set(true);
    // If the scan supplied a merchant, offer the same rule-based category hint as manual entry.
    if (prefill?.payee) void this.suggestCategory();
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
    this.suggestedCategory.set(null);
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
    const splitData: { categoryId: number | null; amount: string }[] = opts.splits?.length
      ? opts.splits
      : [{ categoryId: null, amount: opts.amount ?? '' }];
    // Match the FormArray's control count to the data, then reset everything - including the splits -
    // in one call. Resetting splits *within* form.reset (not before it) is essential: a bare
    // form.reset() also resets this FormArray, which would otherwise wipe each split's categoryId.
    this.splits.clear();
    for (let i = 0; i < splitData.length; i++) this.splits.push(this.newSplitGroup());
    this.form.reset({
      accountId: opts.accountId ?? null,
      currency: opts.currency ?? this.baseCurrency(),
      fxRate: opts.fxRate ?? '1',
      postedDate: opts.postedDate ?? this.today(),
      amount: opts.amount ?? '',
      payee: opts.payee ?? '',
      note: opts.note ?? '',
      splits: splitData,
    });
  }

  protected cancel(): void {
    this.showForm.set(false);
    this.confirmingDelete.set(false);
    this.error.set(null);
  }

  /** Bind a SelectField's emitted value back onto a form control (custom listbox → reactive form). */
  protected setAccount(v: number | string): void {
    this.form.controls.accountId.setValue(Number(v));
  }
  protected setSplitCategory(i: number, v: number | string): void {
    this.splits.at(i).get('categoryId')!.setValue(Number(v));
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
      this.error.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** Delete the transaction currently open in the edit modal (after footer-trash confirmation). */
  protected async deleteConfirmed(): Promise<void> {
    const id = this.editingId();
    if (id === null) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await deleteTransaction(id);
      this.confirmingDelete.set(false);
      this.showForm.set(false);
      await this.reload();
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Suggest a category from the payee via the rule engine (FR-2.3) when the user hasn't picked one
   * (single-split entry only). Non-destructive + inspectable: it pre-selects the match and shows a
   * hint the user can override - no hidden categorisation.
   */
  protected async suggestCategory(): Promise<void> {
    if (!isTauri() || this.splits.length !== 1) return;
    const categoryCtrl = this.splits.at(0).get('categoryId')!;
    if (categoryCtrl.value != null) return; // respect an explicit choice
    const payee = this.form.controls.payee.value.trim();
    if (!payee) return;
    try {
      const name = (await previewRules({ merchant: payee })).category;
      if (!name) return;
      const match = this.categories().find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (match) {
        categoryCtrl.setValue(match.id);
        this.suggestedCategory.set(match.name);
      }
    } catch {
      // Suggestions are best-effort; never block entry on a preview failure.
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
