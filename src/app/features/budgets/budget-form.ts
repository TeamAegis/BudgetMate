import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  createBudget,
  updateBudget,
  deleteBudget,
  getBudget,
  listEnvelopes,
  listCategories,
  getSettings,
  toUserMessage,
  isTauri,
} from '../../core/bridge';
import type { EnvelopeSummary } from '../../core/models';
import { HeaderActionService } from '../../core/layout/header-action.service';
import { readOrigin, returnTo } from '../../core/navigation/origin';
import { CurrencyService } from '../../core/money/currency.service';
import { maxFractionDigits } from '../../core/money/amount-validators';
import { Banner } from '../../shared/ui/banner/banner';
import { Spinner } from '../../shared/ui/spinner/spinner';
import { FormField } from '../../shared/ui/form-field/form-field';
import { FormActions } from '../../shared/ui/form-actions/form-actions';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';

const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Full-screen Add/Edit Budget (envelope) page (FR-3.1). A pushed route (`budgets/new`,
 * `budgets/:id/edit`) with Save in the fixed bottom action bar and the back arrow as Cancel -
 * matches the goal/account form pattern. Category and period are chosen once at creation and are
 * NOT editable afterwards (v1) - to change the category, delete this budget and add a new one.
 * The cap is entered as a major-unit string (e.g. "100.00"); Rust parses it to minor units in the
 * vault's base currency. No money math in TS.
 */
@Component({
  selector: 'app-budget-form',
  imports: [ReactiveFormsModule, Banner, Spinner, FormField, FormActions, ConfirmDialog, SelectField],
  templateUrl: './budget-form.html',
  styleUrl: './budget-form.scss',
})
export class BudgetForm implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly headerAction = inject(HeaderActionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currency = inject(CurrencyService);

  /** Envelope handed over via router state at construction (fast path; consumed once). */
  private readonly nav = this.router.getCurrentNavigation();
  private readonly passedEnvelope =
    (this.nav?.extras.state?.['envelope'] as EnvelopeSummary | undefined) ?? null;

  /**
   * Where to go after a successful save/delete: back to the screen that opened this form (e.g.
   * Home's quick-add) rather than always the Budgets list. See core/navigation/origin.ts.
   */
  private readonly origin = readOrigin(this.router);

  /** Edit id from the route (`budgets/:id/edit`); null on the add route. */
  protected readonly editingId = signal<number | null>(
    this.route.snapshot.paramMap.has('id')
      ? Number(this.route.snapshot.paramMap.get('id'))
      : null,
  );
  protected readonly editing = computed(() => this.editingId() !== null);

  protected readonly baseCurrency = signal('MUR');
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmingDelete = signal(false);

  /** The category name shown as read-only context on the edit page (not re-pickable in v1). */
  protected readonly categoryName = signal<string>('');
  /** Expense categories that don't already have a budget - the `new`-page picker options. */
  protected readonly categoryOptions = signal<SelectOption[]>([]);
  /** True once we've established there is no expense category left to budget (add page only). */
  protected readonly noCategoriesAvailable = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    categoryId: [0, Validators.required],
    cap: ['', [Validators.required, Validators.pattern(DECIMAL), maxFractionDigits(() => this.capFractionDigits())]],
  });

  constructor() {
    // Edit pages expose Delete as a danger icon top-right in the header; Save is the bottom action
    // bar (FormActions) and the back arrow is Cancel. Add pages carry no header action. Cleared on
    // teardown so it never leaks onto the next screen.
    effect(() => {
      this.headerAction.set(
        this.editing()
          ? { label: 'Delete budget', icon: 'trash', run: () => this.confirmingDelete.set(true) }
          : null,
      );
    });
    this.destroyRef.onDestroy(() => this.headerAction.clear());
  }

  private capFractionDigits(): number {
    return this.currency.fractionDigits(this.baseCurrency());
  }

  // ── Inline validation messages (shown only when invalid AND touched) ───────────────
  protected categoryError(): string | null {
    const c = this.form.controls.categoryId;
    if (!c.invalid || !c.touched) return null;
    return 'Choose a category.';
  }

  protected capError(): string | null {
    const c = this.form.controls.cap;
    if (!c.invalid || !c.touched) return null;
    if (c.hasError('required')) return 'Enter a monthly limit.';
    if (c.hasError('maxFractionDigits')) return this.precisionError();
    return 'Enter a number greater than 0.';
  }

  private precisionError(): string {
    const cur = this.baseCurrency().toUpperCase();
    const max = this.capFractionDigits();
    if (max === 0) return `Amounts in ${cur} don't use decimal places.`;
    return `Amounts in ${cur} use at most ${max} decimal place${max === 1 ? '' : 's'}.`;
  }

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to manage budgets.');
      return;
    }
    try {
      const settings = await getSettings();
      this.baseCurrency.set(settings.baseCurrency);

      const id = this.editingId();
      if (id !== null) {
        await this.loadForEdit(id);
      } else {
        await this.loadForCreate();
      }
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  /** Edit: preload the category (read-only) + cap from the passed envelope, or fetch it. */
  private async loadForEdit(id: number): Promise<void> {
    if (this.passedEnvelope && this.passedEnvelope.id === id) {
      this.categoryName.set(this.passedEnvelope.categoryName);
      this.form.reset({
        categoryId: this.passedEnvelope.categoryId,
        cap: this.majorAmount(this.passedEnvelope.capMinor),
      });
      return;
    }
    const budget = await getBudget(id);
    const categories = await listCategories(false);
    const category = categories.find((c) => c.id === budget.categoryId);
    this.categoryName.set(category?.name ?? 'Category');
    this.form.reset({ categoryId: budget.categoryId, cap: this.majorAmount(budget.capMinor) });
  }

  /** Add: only expense categories that don't already have a budget can be picked (one envelope
   *  per category). */
  private async loadForCreate(): Promise<void> {
    const [categories, envelopes] = await Promise.all([listCategories(false), listEnvelopes()]);
    const budgeted = new Set(envelopes.map((e) => e.categoryId));
    const available = categories.filter((c) => c.kind === 'expense' && !budgeted.has(c.id));
    this.categoryOptions.set(available.map((c) => ({ value: c.id, label: c.name })));
    this.noCategoriesAvailable.set(available.length === 0);
    this.form.reset({ categoryId: available[0]?.id ?? 0, cap: '' });
  }

  /** Bind the SelectField's emitted value back onto the form control. */
  protected setCategory(v: number | string): void {
    this.form.controls.categoryId.setValue(Number(v));
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { categoryId, cap } = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    try {
      const id = this.editingId();
      if (id === null) {
        await createBudget({ categoryId, period: 'monthly', cap });
      } else {
        await updateBudget({ id, cap });
      }
      await this.router.navigate([returnTo(this.origin, '/budgets')]);
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
      await deleteBudget(id);
      await this.router.navigate([returnTo(this.origin, '/budgets')]);
    } catch (e) {
      this.error.set(toUserMessage(e));
      this.confirmingDelete.set(false);
    } finally {
      this.busy.set(false);
    }
  }

  /** Stored minor units -> a major-unit string for the cap field (display only; Rust re-parses). */
  private majorAmount(amountMinor: number): string {
    const digits = this.capFractionDigits();
    return (amountMinor / Math.pow(10, digits)).toFixed(digits);
  }
}
