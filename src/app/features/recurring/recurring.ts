import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucidePlus, LucidePencil, LucidePlay, LucidePause } from '@lucide/angular';
import {
  listRecurringRules,
  createRecurringRule,
  updateRecurringRule,
  setRecurringActive,
  listAccounts,
  listCategories,
  toUserMessage,
  isTauri,
} from '../../core/bridge';
import type { RecurringRule, Account, Category, Schedule } from '../../core/models';
import { Button } from '../../shared/ui/button/button';
import { IconButton } from '../../shared/ui/icon-button/icon-button';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { FormField } from '../../shared/ui/form-field/form-field';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { Modal } from '../../shared/ui/modal/modal';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';

const SCHEDULES: Schedule[] = ['daily', 'weekly', 'monthly'];
const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Recurring rules management (FR-1.3). Create/edit/activate rules; occurrences are materialised
 * lazily on app open by the Rust core (no scheduler here). Money/sign/scheduling all live in Rust.
 */
@Component({
  selector: 'app-recurring',
  imports: [
    ReactiveFormsModule,
    LucidePlus,
    LucidePencil,
    LucidePlay,
    LucidePause,
    Button,
    IconButton,
    Banner,
    EmptyState,
    ListRow,
    FormField,
    Skeleton,
    Modal,
    SelectField,
  ],
  templateUrl: './recurring.html',
  styleUrl: './recurring.scss',
})
export class Recurring implements OnInit {
  private readonly fb = inject(FormBuilder);
  /** Placeholder row count shown while the list loads. */
  protected readonly skeletonRows = [0, 1, 2, 3];

  protected readonly rules = signal<RecurringRule[]>([]);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editingId = signal<number | null>(null);
  protected readonly showForm = signal(false);
  protected readonly editing = computed(() => this.editingId() !== null);

  /** Themed-dropdown options (native <select> can't be styled in the WebView — see SelectField). */
  protected readonly scheduleOptions: SelectOption[] = SCHEDULES.map((s) => ({ value: s, label: s }));
  protected readonly accountOptions = computed<SelectOption[]>(() =>
    this.accounts().map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` })),
  );
  protected readonly categoryOptions = computed<SelectOption[]>(() =>
    this.categories().map((c) => ({ value: c.id, label: `${c.name} · ${c.kind}` })),
  );

  protected readonly form = this.fb.group({
    schedule: this.fb.nonNullable.control<Schedule>('monthly', Validators.required),
    nextRunDate: this.fb.nonNullable.control(this.today(), Validators.required),
    accountId: this.fb.control<number | null>(null, Validators.required),
    categoryId: this.fb.control<number | null>(null, Validators.required),
    amount: this.fb.nonNullable.control('', [Validators.required, Validators.pattern(DECIMAL)]),
    payee: this.fb.nonNullable.control(''),
    note: this.fb.nonNullable.control(''),
  });

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

  /** Inline validation message (A9) — shown only when invalid AND touched. */
  protected amountError(): string | null {
    const c = this.form.controls.amount;
    if (!c.invalid || !c.touched) return null;
    return c.hasError('required') ? 'Enter an amount.' : 'Amount must be a number greater than 0.';
  }

  protected accountName(id: number): string {
    return this.accounts().find((a) => a.id === id)?.name ?? '—';
  }
  protected categoryName(id: number): string {
    return this.categories().find((c) => c.id === id)?.name ?? '—';
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

  protected startCreate(): void {
    this.editingId.set(null);
    this.form.reset({
      schedule: 'monthly',
      nextRunDate: this.today(),
      accountId: this.accounts()[0]?.id ?? null,
      categoryId: null,
      amount: '',
      payee: '',
      note: '',
    });
    this.error.set(null);
    this.showForm.set(true);
  }

  protected startEdit(r: RecurringRule): void {
    this.editingId.set(r.id);
    this.form.reset({
      schedule: r.schedule,
      nextRunDate: r.nextRunDate,
      accountId: r.template.accountId,
      categoryId: r.template.categoryId,
      amount: r.template.amount,
      payee: r.template.payee ?? '',
      note: r.template.note ?? '',
    });
    this.error.set(null);
    this.showForm.set(true);
  }

  protected cancel(): void {
    this.showForm.set(false);
    this.error.set(null);
  }

  /** Bind a SelectField's emitted value back onto a form control (custom listbox → reactive form). */
  protected setSchedule(v: number | string): void {
    this.form.controls.schedule.setValue(v as Schedule);
  }
  protected setAccount(v: number | string): void {
    this.form.controls.accountId.setValue(Number(v));
  }
  protected setCategory(v: number | string): void {
    this.form.controls.categoryId.setValue(Number(v));
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const rule = {
      schedule: v.schedule,
      nextRunDate: v.nextRunDate,
      template: {
        accountId: v.accountId as number,
        categoryId: v.categoryId as number,
        amount: v.amount,
        payee: v.payee.trim() || null,
        note: v.note.trim() || null,
      },
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      const id = this.editingId();
      if (id === null) await createRecurringRule(rule);
      else await updateRecurringRule({ id, ...rule });
      this.showForm.set(false);
      await this.reload();
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
    }
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

  /** Today as `YYYY-MM-DD` for the date input default. */
  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
