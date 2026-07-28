import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  createAllowance,
  updateAllowance,
  deleteAllowance,
  listAllowances,
  toUserMessage,
  isTauri,
} from '../../core/bridge';
import { asAppError, type Allowance, type AllowanceKind, type AllowancePeriod } from '../../core/models';
import { HeaderActionService } from '../../core/layout/header-action.service';
import { CurrencyService } from '../../core/money/currency.service';
import { maxFractionDigits } from '../../core/money/amount-validators';
import { Banner } from '../../shared/ui/banner/banner';
import { Spinner } from '../../shared/ui/spinner/spinner';
import { FormField } from '../../shared/ui/form-field/form-field';
import { FormActions } from '../../shared/ui/form-actions/form-actions';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { SegmentedToggle, type SegmentOption } from '../../shared/ui/segmented-toggle/segmented-toggle';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';

const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Full-screen Add/Edit Allowance page (FR-3.4, `docs/allowances.md`). A pushed route
 * (`allowances/new`, `allowances/:id/edit`) with Save in the fixed bottom action bar and the back
 * arrow as Cancel - matches the goal/budget form pattern. `currency`, `kind`, `period`, and
 * `weekStart` are chosen once at creation and are NOT editable afterwards (delete and re-add to
 * change them); the edit page instead exposes a Pause/Resume control (`active`). The target amount
 * is entered as a major-unit string (e.g. "1500.00"); Rust parses it to minor units in the vault's
 * base currency. No money math in TS.
 *
 * The initial allocation (create), a target raise, and a resume are all-or-nothing against the
 * vault's free savings (the savings gate, `docs/allowances.md` §6.2) - Rust rejects with a
 * `Validation` `AppError` carrying "not enough available savings..." when the gate fails. That
 * specific rejection is shown as a gentle `tone="warning"` banner (never the harsh default error
 * tone) and the save is never partially applied; any other failure falls back to the default error
 * banner.
 */
@Component({
  selector: 'app-allowance-form',
  imports: [
    ReactiveFormsModule,
    Banner,
    Spinner,
    FormField,
    FormActions,
    ConfirmDialog,
    SegmentedToggle,
    SelectField,
  ],
  templateUrl: './allowance-form.html',
  styleUrl: './allowance-form.scss',
})
export class AllowanceForm implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly headerAction = inject(HeaderActionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currency = inject(CurrencyService);

  /** Allowance handed over via router state at construction (fast path; consumed once). */
  private readonly nav = this.router.getCurrentNavigation();
  private readonly passedAllowance =
    (this.nav?.extras.state?.['allowance'] as Allowance | undefined) ?? null;

  /** Edit id from the route (`allowances/:id/edit`); null on the add route. */
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
  /** The savings-gate rejection, shown as a gentle warning banner (see class doc). */
  protected readonly gateWarning = signal<string | null>(null);
  protected readonly confirmingDelete = signal(false);

  // Fixed at creation - read-only afterwards (`kindSummary()` renders them on the edit page).
  protected readonly kind = signal<AllowanceKind>('recurring');
  protected readonly period = signal<AllowancePeriod>('weekly');
  protected readonly weekStart = signal<number>(1);
  /** Pause/Resume (edit only) - drives `UpdateAllowance.active`. */
  protected readonly activeState = signal<'active' | 'paused'>('active');

  protected readonly kindOptions: SegmentOption[] = [
    { value: 'recurring', label: 'Recurring' },
    { value: 'one_time', label: 'One-time' },
  ];
  protected readonly periodOptions: SegmentOption[] = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
  ];
  protected readonly activeOptions: SegmentOption[] = [
    { value: 'active', label: 'Active' },
    { value: 'paused', label: 'Paused' },
  ];
  protected readonly weekdayOptions: SelectOption[] = [
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
    { value: 7, label: 'Sunday' },
  ];

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    target: [
      '',
      [Validators.required, Validators.pattern(DECIMAL), maxFractionDigits(() => this.targetFractionDigits())],
    ],
  });

  constructor() {
    // Edit pages expose Delete as a danger icon top-right in the header; Save is the bottom action
    // bar (FormActions) and the back arrow is Cancel. Add pages carry no header action. Cleared on
    // teardown so it never leaks onto the next screen.
    effect(() => {
      this.headerAction.set(
        this.editing()
          ? { label: 'Delete allowance', icon: 'trash', run: () => this.confirmingDelete.set(true) }
          : null,
      );
    });
    this.destroyRef.onDestroy(() => this.headerAction.clear());
  }

  private targetFractionDigits(): number {
    return this.currency.fractionDigits(this.baseCurrency());
  }

  // ── Inline validation messages (shown only when invalid AND touched) ───────────────
  protected nameError(): string | null {
    const c = this.form.controls.name;
    if (!c.invalid || !c.touched) return null;
    return c.hasError('required') ? 'Enter a name.' : 'Name is too long (60 characters max).';
  }

  protected targetError(): string | null {
    const c = this.form.controls.target;
    if (!c.invalid || !c.touched) return null;
    if (c.hasError('required')) return 'Enter an amount.';
    if (c.hasError('maxFractionDigits')) return this.precisionError();
    return 'Amount must be a number greater than 0.';
  }

  private precisionError(): string {
    const cur = this.baseCurrency().toUpperCase();
    const max = this.targetFractionDigits();
    if (max === 0) return `Amounts in ${cur} don't use decimal places.`;
    return `Amounts in ${cur} use at most ${max} decimal place${max === 1 ? '' : 's'}.`;
  }

  /** Plain-language read-only summary of the fixed-at-creation fields (edit page). */
  protected kindSummary(): string {
    if (this.kind() === 'one_time') return 'One-time';
    const periodLabel = this.period() === 'weekly' ? 'Weekly' : 'Monthly';
    if (this.period() === 'weekly') {
      const day = this.weekdayOptions.find((o) => o.value === this.weekStart())?.label ?? '';
      return `Recurring - ${periodLabel}, starts ${day}`;
    }
    return `Recurring - ${periodLabel}`;
  }

  // ── Bind toggles/selects (not reactive-form controls) back onto their signals ───────
  protected setKind(v: number | string): void {
    this.kind.set(v === 'one_time' ? 'one_time' : 'recurring');
  }
  protected setPeriod(v: number | string): void {
    this.period.set(v === 'monthly' ? 'monthly' : 'weekly');
  }
  protected setWeekStart(v: number | string): void {
    this.weekStart.set(Number(v));
  }
  protected setActiveState(v: number | string): void {
    this.activeState.set(v === 'paused' ? 'paused' : 'active');
  }

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to manage allowances.');
      return;
    }
    try {
      const id = this.editingId();
      if (id !== null) {
        const a =
          this.passedAllowance ?? (await listAllowances()).allowances.find((x) => x.id === id) ?? null;
        if (!a) {
          this.error.set('That allowance could not be found.');
        } else {
          this.patchFromAllowance(a);
        }
      } else {
        const summary = await listAllowances();
        this.baseCurrency.set(summary.baseCurrency);
        this.form.reset({ name: '', target: '' });
      }
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private patchFromAllowance(a: Allowance): void {
    this.baseCurrency.set(a.currency);
    this.kind.set(a.kind);
    this.period.set(a.period ?? 'weekly');
    this.weekStart.set(a.weekStart ?? 1);
    this.activeState.set(a.active ? 'active' : 'paused');
    this.form.reset({ name: a.name, target: this.majorAmount(a.targetMinor, a.currency) });
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    this.gateWarning.set(null);
    try {
      const id = this.editingId();
      if (id === null) {
        await createAllowance({
          name: v.name.trim(),
          target: v.target,
          currency: this.baseCurrency(),
          kind: this.kind(),
          period: this.kind() === 'recurring' ? this.period() : null,
          weekStart: this.kind() === 'recurring' && this.period() === 'weekly' ? this.weekStart() : null,
        });
      } else {
        await updateAllowance({
          id,
          name: v.name.trim(),
          target: v.target,
          active: this.activeState() === 'active',
        });
      }
      await this.router.navigate(['/allowances']);
    } catch (e) {
      if (this.isSavingsGateError(e)) this.gateWarning.set(toUserMessage(e));
      else this.error.set(toUserMessage(e));
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
      await deleteAllowance(id);
      await this.router.navigate(['/allowances']);
    } catch (e) {
      this.error.set(toUserMessage(e));
      this.confirmingDelete.set(false);
    } finally {
      this.busy.set(false);
    }
  }

  /** True for the all-or-nothing savings-gate rejection (raising the target, or resuming, beyond
   *  what's currently free - `docs/allowances.md` §6.2) - shown as the gentle warning banner rather
   *  than the default error banner (see class doc). Mirrors the same substring heuristic
   *  `core/bridge/error-message.ts` uses to translate the Rust message. */
  private isSavingsGateError(e: unknown): boolean {
    const err = asAppError(e);
    const message = 'message' in err ? err.message : '';
    return message.toLowerCase().includes('available savings');
  }

  /** Stored minor units -> a major-unit string for the target field (display only; Rust re-parses). */
  private majorAmount(amountMinor: number, currency: string): string {
    const digits = this.currency.fractionDigits(currency);
    return (amountMinor / Math.pow(10, digits)).toFixed(digits);
  }
}
