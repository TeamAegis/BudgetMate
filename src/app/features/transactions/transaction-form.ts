import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucidePlus, LucideX, LucideTag, LucideWalletCards, LucideChevronRight } from '@lucide/angular';
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  listTransactions,
  listAccounts,
  listCategories,
  listAllowances,
  getSettings,
  previewRules,
  toUserMessage,
  isTauri,
} from '../../core/bridge';
import type {
  Transaction,
  Account,
  Allowance,
  Category,
  CategoryKind,
  TransactionPrefill,
} from '../../core/models';
import { HeaderActionService } from '../../core/layout/header-action.service';
import { CurrencyService } from '../../core/money/currency.service';
import { maxFractionDigits } from '../../core/money/amount-validators';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { IconButton } from '../../shared/ui/icon-button/icon-button';
import { Banner } from '../../shared/ui/banner/banner';
import { Spinner } from '../../shared/ui/spinner/spinner';
import { FormField } from '../../shared/ui/form-field/form-field';
import { FormActions } from '../../shared/ui/form-actions/form-actions';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';

const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * A snapshot of the in-progress form, carried in nav state when the user taps the category row (or
 * the allowance row, FR-3.4) to change it (form -> picker -> form). Restoring it makes changing the
 * category/allowance lossless. `form.getRawValue()` plus the out-of-form `allowanceId` signal.
 */
interface FormSnapshot {
  accountId: number | null;
  postedDate: string;
  amount: string;
  currency: string;
  fxRate: string;
  payee: string;
  note: string;
  splits: { categoryId: number | null; amount: string }[];
  /** Optional allowance envelope tag (FR-3.4); `null` for an untagged transaction. */
  allowanceId: number | null;
}

/**
 * Full-screen Add/Edit Transaction page (FR-1.1, splits FR-1.2, multi-currency FR-1.4). Replaces the
 * former centred modal: a pushed route (`expenses/new`, `expenses/:id/edit`) with Save in the app
 * header (so the Android soft keyboard can never hide it) and the back arrow as Cancel. Smart
 * component - reads reference data through the bridge and renders with shared/ui. All money parsing,
 * signing, the split-sum invariant, and `base_amount_minor` happen in Rust; TS only formats and
 * shows a live "remaining to allocate" hint (Rust re-validates). Field order is amount-first
 * (genre quick-entry); Split/FX are progressively disclosed.
 *
 * Tagging an allowance (FR-3.4, `docs/allowances.md` §12) is optional and shown as a context row
 * (mirroring the category row) below the category/split block; tapping it opens
 * `AllowancePicker`, carrying the in-progress form via `FormSnapshot` so changing (or clearing) the
 * tag is lossless, for both the create and edit routes.
 */
@Component({
  selector: 'app-transaction-form',
  imports: [
    ReactiveFormsModule,
    MoneyPipe,
    LucidePlus,
    LucideX,
    LucideTag,
    LucideWalletCards,
    LucideChevronRight,
    IconButton,
    Banner,
    Spinner,
    FormField,
    FormActions,
    ConfirmDialog,
    SelectField,
  ],
  templateUrl: './transaction-form.html',
  styleUrl: './transaction-form.scss',
})
export class TransactionForm implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly headerAction = inject(HeaderActionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currency = inject(CurrencyService);

  /** Entity + OCR prefill handed over via router state at construction (consumed once). */
  private readonly nav = this.router.getCurrentNavigation();
  private readonly passedTx =
    (this.nav?.extras.state?.['transaction'] as Transaction | undefined) ?? null;
  private readonly pendingPrefill =
    (this.nav?.extras.state?.['transactionPrefill'] as TransactionPrefill | undefined) ?? null;
  /** In-progress entry handed back when the user changes the category (lossless round-trip). */
  private readonly resume =
    (this.nav?.extras.state?.['resume'] as FormSnapshot | undefined) ?? null;

  /** Kind branch from the create route (`expenses/new/:kind/...`); drives the title + amount hint. */
  private readonly presetKind: CategoryKind =
    this.route.snapshot.paramMap.get('kind') === 'income' ? 'income' : 'expense';
  /** Category chosen in step 1b (`:categoryId`); `0`/absent means not yet chosen (e.g. scan). */
  private readonly presetCategoryId = ((): number | null => {
    const raw = this.route.snapshot.paramMap.get('categoryId');
    const n = raw == null ? NaN : Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  })();
  /**
   * The transaction kind for this whole form session (stable): the route preset on create, or the
   * loaded transaction's category kind on edit. A transaction is a single kind, so category options
   * and the amount hint key off this rather than re-deriving per render.
   */
  protected readonly formKind = signal<CategoryKind>(this.presetKind);

  /** Edit id from the route (`expenses/:id/edit`); null on the add route. */
  protected readonly editingId = signal<number | null>(
    this.route.snapshot.paramMap.has('id')
      ? Number(this.route.snapshot.paramMap.get('id'))
      : null,
  );
  protected readonly editing = computed(() => this.editingId() !== null);

  protected readonly accounts = signal<Account[]>([]);
  protected readonly categories = signal<Category[]>([]);
  /** Every allowance (not just active ones) - so an already-tagged paused allowance still resolves
   *  to a name here; the picker itself lists active allowances only. */
  protected readonly allowances = signal<Allowance[]>([]);
  /** The optional allowance tag (FR-3.4) - `null` for an untagged transaction. Kept outside the
   *  reactive form (like `formKind`) since it isn't a per-split concern. */
  protected readonly allowanceId = signal<number | null>(null);
  protected readonly baseCurrency = signal('MUR');
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmingDelete = signal(false);
  /**
   * Category a rule suggested from the payee, plus the deterministic reason it fired (an
   * inspectable, overridable hint - no black-box categorisation, ux-blueprint.md §3).
   */
  protected readonly suggestion = signal<{ category: string; reason: string } | null>(null);

  protected readonly accountOptions = computed<SelectOption[]>(() =>
    this.accounts().map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` })),
  );
  // Split editor + edit dropdown: only this transaction's kind, with no redundant "· kind" suffix
  // (the kind is already fixed for the whole entry).
  protected readonly categoryOptions = computed<SelectOption[]>(() =>
    this.categories()
      .filter((c) => c.kind === this.formKind())
      .map((c) => ({ value: c.id, label: c.name })),
  );

  protected readonly form = this.fb.group({
    accountId: this.fb.control<number | null>(null, Validators.required),
    postedDate: this.fb.nonNullable.control(this.today(), Validators.required),
    amount: this.fb.nonNullable.control('', [
      Validators.required,
      Validators.pattern(DECIMAL),
      maxFractionDigits(() => this.fractionDigits(this.currentCurrency())),
    ]),
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
    // needs no per-split entry. With >=2 splits the user allocates each line explicitly.
    this.form.controls.amount.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      if (this.splits.length === 1) {
        this.splits.at(0).get('amount')!.setValue(v ?? '', { emitEvent: false });
      }
    });

    // The max-fraction-digits cap depends on the selected `currency` - revalidate the amount and
    // every split whenever it changes, so switching to a fewer-decimal currency re-flags an
    // already-typed over-precise value.
    this.form.controls.currency.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.revalidateAmounts());

    // Edit pages expose Delete as a danger icon top-right in the header; Save is the bottom action
    // bar (FormActions) and the back arrow is Cancel. Add pages carry no header action. Cleared on
    // teardown so it never leaks onto the next screen.
    effect(() => {
      this.headerAction.set(
        this.editing()
          ? { label: 'Delete transaction', icon: 'trash', run: () => this.confirmingDelete.set(true) }
          : null,
      );
    });
    this.destroyRef.onDestroy(() => this.headerAction.clear());
  }

  protected get splits(): FormArray {
    return this.form.controls.splits;
  }

  // -- Inline validation messages (shown only when invalid AND touched) ---------------

  protected amountError(): string | null {
    const c = this.form.controls.amount;
    if (!c.invalid || !c.touched) return null;
    if (c.hasError('required')) return 'Enter an amount.';
    if (c.hasError('maxFractionDigits')) return this.precisionError();
    return 'Amount must be a number greater than 0.';
  }

  protected currencyError(): string | null {
    const c = this.form.controls.currency;
    if (!c.invalid || !c.touched) return null;
    return 'Use a 3-letter currency code, e.g. MUR.';
  }

  protected splitAmountError(i: number): string | null {
    const c = this.splits.at(i).get('amount')!;
    if (!c.invalid || !c.touched) return null;
    if (c.hasError('required')) return 'Enter an amount.';
    if (c.hasError('maxFractionDigits')) return this.precisionError();
    return 'Amount must be a number greater than 0.';
  }

  /** Shared "too many decimal places" wording for the currently-selected currency (amount + splits). */
  private precisionError(): string {
    const cur = this.currentCurrency();
    const max = this.fractionDigits(cur);
    if (max === 0) return `Amounts in ${cur} don't use decimal places.`;
    return `Amounts in ${cur} use at most ${max} decimal place${max === 1 ? '' : 's'}.`;
  }

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to add transactions.');
      return;
    }
    try {
      const [accts, cats, allowanceSummary, settings] = await Promise.all([
        listAccounts(false),
        listCategories(false),
        listAllowances(),
        getSettings(),
      ]);
      this.accounts.set(accts);
      this.categories.set(cats);
      this.allowances.set(allowanceSummary.allowances);
      this.baseCurrency.set(settings.baseCurrency);

      const id = this.editingId();
      if (id !== null) {
        if (this.resume) {
          // Returning from the category/allowance picker mid-edit (lossless "change" round trip) -
          // the in-progress form already has everything; no need to refetch the transaction.
          this.patchFromResume(this.resume);
        } else {
          const tx = this.passedTx ?? (await listTransactions()).find((t) => t.id === id) ?? null;
          if (!tx) {
            this.error.set('That transaction could not be found.');
          } else {
            this.patchFromTransaction(tx);
          }
        }
      } else {
        // Restore an in-progress entry when changing the category/allowance; otherwise start fresh
        // (or from an OCR prefill). The two-step add picks the category first, so it is preset here.
        if (this.resume) this.patchFromResume(this.resume);
        else this.patchForCreate(this.pendingPrefill);

        if (this.presetCategoryId != null) {
          this.splits.at(0).get('categoryId')!.setValue(this.presetCategoryId);
        } else if (this.pendingPrefill?.payee) {
          // Scan path with no chosen category: suggest one from the payee (still user-confirmed).
          void this.suggestCategory();
        }
      }
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  // -- Split editor ------------------------------------------------------------------

  private newSplitGroup(amount = ''): FormGroup {
    return this.fb.group({
      categoryId: this.fb.control<number | null>(null, Validators.required),
      amount: this.fb.nonNullable.control(amount, [
        Validators.required,
        Validators.pattern(DECIMAL),
        maxFractionDigits(() => this.fractionDigits(this.currentCurrency())),
      ]),
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
    return (
      this.accounts().find((a) => a.id === this.form.controls.accountId.value)?.currency ?? 'MUR'
    );
  }

  /** Show the fx-rate field only when recording in a currency other than the base (FR-1.4). */
  protected showFx(): boolean {
    return this.currentCurrency() !== this.baseCurrency();
  }

  /** Remaining-to-allocate in minor units (total - sum of splits). Exact integer math, display only. */
  protected remainingMinor(): number {
    const currency = this.currentCurrency();
    const total = this.toMinor(this.form.controls.amount.value, currency) ?? 0;
    const allocated = this.splits.controls.reduce(
      (sum, g) => sum + (this.toMinor(g.get('amount')!.value as string, currency) ?? 0),
      0,
    );
    return total - allocated;
  }

  /** True when splits don't yet add up to the total (only meaningful with >=2 splits). */
  protected unbalanced(): boolean {
    return this.splits.length > 1 && this.remainingMinor() !== 0;
  }

  private patchForCreate(prefill: TransactionPrefill | null): void {
    const accounts = this.accounts();
    // `prefill.currency` is the currency `totalMinor` is expressed in (see TransactionPrefill in
    // core/models) - it must win over the default account's currency, or a prefill from a
    // different-currency account silently mis-scales by a power of ten (0dp vs 2dp vs 3dp).
    const preferred = prefill?.currency
      ? (accounts.find((a) => a.currency === prefill.currency) ?? accounts[0] ?? null)
      : (accounts[0] ?? null);
    const currency = prefill?.currency ?? preferred?.currency ?? this.baseCurrency();
    // OCR suggestions (FR-2.1) only PREFILL the editable form - the user confirms before Save.
    this.resetForm({
      accountId: preferred?.id ?? null,
      currency,
      postedDate: prefill?.postedDate ?? undefined,
      amount:
        prefill?.totalMinor != null ? this.majorAmount(prefill.totalMinor, currency) : undefined,
      payee: prefill?.payee ?? undefined,
    });
    this.allowanceId.set(null);
  }

  private patchFromTransaction(t: Transaction): void {
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
    this.allowanceId.set(t.allowanceId);
    this.syncFormKindFromFirstSplit();
  }

  /** Restore a snapshot handed back from the category or allowance picker (lossless "change
   *  category"/"change allowance"), for both the create and edit routes. */
  private patchFromResume(s: FormSnapshot): void {
    this.resetForm({
      accountId: s.accountId,
      currency: s.currency,
      fxRate: s.fxRate,
      postedDate: s.postedDate,
      amount: s.amount,
      payee: s.payee,
      note: s.note,
      splits: s.splits,
    });
    this.allowanceId.set(s.allowanceId ?? null);
    this.syncFormKindFromFirstSplit();
  }

  /** Fix `formKind` from the first split's category (a transaction is a single kind for the whole
   *  session) - shared by `patchFromTransaction` and `patchFromResume` (an edit-mode "change
   *  allowance/category" round trip resumes without refetching the transaction). */
  private syncFormKindFromFirstSplit(): void {
    const firstCategoryId = this.splits.at(0).get('categoryId')!.value as number | null;
    const firstCat = this.categories().find((c) => c.id === firstCategoryId);
    if (firstCat) this.formKind.set(firstCat.kind);
  }

  private resetForm(opts: {
    accountId?: number | null;
    currency?: string;
    fxRate?: string;
    postedDate?: string;
    amount?: string;
    payee?: string;
    note?: string;
    splits?: { categoryId: number | null; amount: string }[];
  }): void {
    const splitData: { categoryId: number | null; amount: string }[] = opts.splits?.length
      ? opts.splits
      : [{ categoryId: null, amount: opts.amount ?? '' }];
    // Match the FormArray's control count to the data, then reset everything - including splits - in
    // one call. Resetting splits *within* form.reset (not before it) is essential: a bare
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

  /** Bind a SelectField's emitted value back onto a form control (custom listbox -> reactive form). */
  protected setAccount(v: number | string): void {
    this.form.controls.accountId.setValue(Number(v));
  }
  protected setSplitCategory(i: number, v: number | string): void {
    this.splits.at(i).get('categoryId')!.setValue(Number(v));
  }

  // -- Two-step category context (create, single-split) ------------------------------

  /** The category currently chosen for a simple (single-split) entry, resolved for display. */
  protected selectedCategory(): Category | null {
    const id = this.splits.at(0).get('categoryId')!.value as number | null;
    if (id == null) return null;
    return this.categories().find((c) => c.id === id) ?? null;
  }

  /** Expense vs income for this entry (stable for the session). */
  protected kind(): CategoryKind {
    return this.formKind();
  }

  /** Amount field hint, phrased for the kind (the type is already chosen, never set here). */
  protected amountHint(): string {
    return this.kind() === 'income' ? 'How much you received.' : 'How much you spent.';
  }

  /** Inline error when a simple entry has no category yet (shown only once touched). */
  protected categoryRowError(): string | null {
    const c = this.splits.at(0).get('categoryId')!;
    return c.invalid && c.touched ? 'Choose a category.' : null;
  }

  /**
   * Reopen the picker to change the category, carrying the in-progress entry so nothing is lost.
   * `replaceUrl` swaps the form out of history (the picker re-adds it on pick), so repeatedly
   * changing the category never stacks up entries the Back button has to unwind.
   */
  protected changeCategory(): void {
    void this.router.navigate(['/expenses/new', this.kind()], {
      state: { resume: { ...this.form.getRawValue(), allowanceId: this.allowanceId() } },
      replaceUrl: true,
    });
  }

  // -- Optional allowance tagging (FR-3.4, docs/allowances.md §12) -------------------

  /** The allowance currently tagged, resolved for display in the context row (or `null`). */
  protected selectedAllowance(): Allowance | null {
    const id = this.allowanceId();
    if (id == null) return null;
    return this.allowances().find((a) => a.id === id) ?? null;
  }

  /**
   * Open the picker to tag (or clear) an allowance, carrying the in-progress entry so nothing is
   * lost - works from both the create and edit routes since `returnTo` is just this form's own
   * current URL. `replaceUrl` swaps the form out of history (the picker re-adds it on pick), so
   * repeatedly changing the tag never stacks up entries the Back button has to unwind.
   */
  protected changeAllowance(): void {
    void this.router.navigate(['/expenses/allowance'], {
      state: {
        returnTo: this.router.url,
        resume: { ...this.form.getRawValue(), allowanceId: this.allowanceId() },
      },
      replaceUrl: true,
    });
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
        allowanceId: this.allowanceId(),
      };
      const id = this.editingId();
      if (id === null) await createTransaction(input);
      else await updateTransaction({ id, ...input });
      await this.router.navigate(['/expenses']);
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async deleteConfirmed(): Promise<void> {
    const id = this.editingId();
    if (id === null) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await deleteTransaction(id);
      await this.router.navigate(['/expenses']);
    } catch (e) {
      this.error.set(toUserMessage(e));
      this.confirmingDelete.set(false);
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
      const preview = await previewRules({ merchant: payee });
      const name = preview.category;
      if (!name) return;
      const match = this.categories().find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (!match) return;
      categoryCtrl.setValue(match.id);
      // Rust already picked the causal rule (the last one that set category - later rules override
      // earlier ones). Only phrase a specific reason for the everyday payee-driven case (matched on
      // "merchant" - shown to the user as "payee", matching the field label). A chained rule whose
      // last category-setter matched on a category value would read as a confusing self-referential
      // "category equals ..." - leave the reason empty so the template falls back to the generic copy.
      const cr = preview.categoryReason;
      const reason = cr && cr.matchField === 'merchant' ? `payee ${cr.matchOp} "${cr.matchValue}"` : '';
      this.suggestion.set({ category: match.name, reason });
    } catch {
      // Suggestions are best-effort; never block entry on a preview failure.
    }
  }

  /** Today as `YYYY-MM-DD` for the date input's default (a date default, not money math). */
  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Minor-unit digits for a currency (Rust's authoritative table, same one the money pipe uses). */
  private fractionDigits(currency: string): number {
    return this.currency.fractionDigits(currency);
  }

  /** Re-run the amount + per-split max-fraction-digits check after the effective currency changes. */
  private revalidateAmounts(): void {
    this.form.controls.amount.updateValueAndValidity({ emitEvent: false });
    for (const g of this.splits.controls) g.get('amount')!.updateValueAndValidity({ emitEvent: false });
  }

  /** Exact integer parse of a major-unit string -> minor units for display math; null if invalid. */
  private toMinor(s: string, currency: string): number | null {
    if (!DECIMAL.test(s.trim())) return null;
    const digits = this.fractionDigits(currency);
    const [intPart, fracRaw = ''] = s.trim().split('.');
    if (fracRaw.length > digits) return null;
    const frac = (fracRaw + '0'.repeat(digits)).slice(0, digits);
    return Number(intPart) * Math.pow(10, digits) + Number(frac || '0');
  }

  /** Stored signed minor units -> a positive major-unit string for the edit fields. */
  private majorAmount(amountMinor: number, currency: string): string {
    const digits = this.fractionDigits(currency);
    return (Math.abs(amountMinor) / Math.pow(10, digits)).toFixed(digits);
  }
}
