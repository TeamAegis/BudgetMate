import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  createRecurringRule,
  updateRecurringRule,
  listRecurringRules,
  listAccounts,
  listCategories,
  toUserMessage,
  isTauri,
} from '../../core/bridge';
import type { RecurringRule, Account, Category, Schedule } from '../../core/models';
import { HeaderActionService } from '../../core/layout/header-action.service';
import { Banner } from '../../shared/ui/banner/banner';
import { Spinner } from '../../shared/ui/spinner/spinner';
import { FormField } from '../../shared/ui/form-field/form-field';
import { FormActions } from '../../shared/ui/form-actions/form-actions';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';

const SCHEDULES: Schedule[] = ['daily', 'weekly', 'monthly'];
const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Full-screen Add/Edit Recurring rule page (FR-1.3). Replaces the former centred modal: a pushed
 * route (`settings/recurring/new`, `settings/recurring/:id/edit`) with Save in the app header (so the
 * Android soft keyboard can never hide it) and the back arrow as Cancel. Smart component - reads
 * reference data through the bridge and renders with shared/ui. All money parsing, signing, and the
 * lazy materialisation happen in Rust; TS only formats and validates shape. Recurring has no delete
 * (pause/resume stays on the list), so this page has no danger-zone.
 */
@Component({
  selector: 'app-recurring-form',
  imports: [ReactiveFormsModule, Banner, Spinner, FormField, FormActions, SelectField],
  templateUrl: './recurring-form.html',
  styleUrl: './recurring-form.scss',
})
export class RecurringForm implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly headerAction = inject(HeaderActionService);
  private readonly destroyRef = inject(DestroyRef);

  /** Entity handed over via router state at construction (fast path; edit refetches if absent). */
  private readonly nav = this.router.getCurrentNavigation();
  private readonly passedRule =
    (this.nav?.extras.state?.['recurringRule'] as RecurringRule | undefined) ?? null;

  /** Edit id from the route (`settings/recurring/:id/edit`); null on the add route. */
  protected readonly editingId = signal<number | null>(
    this.route.snapshot.paramMap.has('id') ? Number(this.route.snapshot.paramMap.get('id')) : null,
  );
  protected readonly editing = computed(() => this.editingId() !== null);

  protected readonly accounts = signal<Account[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Raw enum values never render (ux-blueprint §10) - display labels only. */
  private static readonly SCHEDULE_LABELS: Record<string, string> = {
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    custom: 'Custom',
  };
  private static readonly KIND_LABELS: Record<string, string> = {
    expense: 'Expense',
    income: 'Income',
    transfer: 'Transfer',
  };

  /** Themed-dropdown options (native <select> can't be styled in the WebView - see SelectField). */
  protected readonly scheduleOptions: SelectOption[] = SCHEDULES.map((s) => ({
    value: s,
    label: RecurringForm.SCHEDULE_LABELS[s] ?? s,
  }));
  protected readonly accountOptions = computed<SelectOption[]>(() =>
    this.accounts().map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` })),
  );
  protected readonly categoryOptions = computed<SelectOption[]>(() =>
    this.categories().map((c) => ({
      value: c.id,
      label: `${c.name} · ${RecurringForm.KIND_LABELS[c.kind] ?? c.kind}`,
    })),
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

  constructor() {
    // Recurring has no destructive action (pause/resume stays on the list), so the header carries no
    // action here; Save is the bottom action bar (FormActions) and the back arrow is Cancel. Clear
    // any stale action so nothing leaks in, and clear again on teardown.
    this.headerAction.clear();
    this.destroyRef.onDestroy(() => this.headerAction.clear());
  }

  /** Inline validation message (A9) - shown only when invalid AND touched. */
  protected amountError(): string | null {
    const c = this.form.controls.amount;
    if (!c.invalid || !c.touched) return null;
    return c.hasError('required') ? 'Enter an amount.' : 'Amount must be a number greater than 0.';
  }

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to manage recurring rules.');
      return;
    }
    try {
      const [accts, cats] = await Promise.all([listAccounts(false), listCategories(false)]);
      this.accounts.set(accts);
      this.categories.set(cats);

      const id = this.editingId();
      if (id !== null) {
        const rule =
          this.passedRule ?? (await listRecurringRules()).find((r) => r.id === id) ?? null;
        if (!rule) {
          this.error.set('That recurring rule could not be found.');
        } else {
          this.patchFromRule(rule);
        }
      } else {
        this.form.reset({
          schedule: 'monthly',
          nextRunDate: this.today(),
          accountId: this.accounts()[0]?.id ?? null,
          categoryId: null,
          amount: '',
          payee: '',
          note: '',
        });
      }
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private patchFromRule(r: RecurringRule): void {
    this.form.reset({
      schedule: r.schedule,
      nextRunDate: r.nextRunDate,
      accountId: r.template.accountId,
      categoryId: r.template.categoryId,
      amount: r.template.amount,
      payee: r.template.payee ?? '',
      note: r.template.note ?? '',
    });
  }

  /** Bind a SelectField's emitted value back onto a form control (custom listbox -> reactive form). */
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
      await this.router.navigate(['/settings/recurring']);
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
