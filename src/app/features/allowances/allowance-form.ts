import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  createAllowance,
  updateAllowance,
  deleteAllowance,
  listAllowances,
  getSettings,
  toUserMessage,
  isTauri,
  SAVINGS_GATE_MESSAGE,
} from '../../core/bridge';
import type { Allowance, AllowanceKind, AllowancePeriod } from '../../core/models';
import { HeaderActionService } from '../../core/layout/header-action.service';
import { CurrencyService } from '../../core/money/currency.service';
import { maxFractionDigits } from '../../core/money/amount-validators';
import { Banner, type BannerTone } from '../../shared/ui/banner/banner';
import { Spinner } from '../../shared/ui/spinner/spinner';
import { FormField } from '../../shared/ui/form-field/form-field';
import { FormActions } from '../../shared/ui/form-actions/form-actions';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { SegmentedToggle, type SegmentOption } from '../../shared/ui/segmented-toggle/segmented-toggle';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';

const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Full-screen Add/Edit Allowance page (FR-3.4). A pushed route (`allowances/new`,
 * `allowances/:id/edit`) with Save in the fixed bottom action bar and the back arrow as Cancel -
 * matches the goal/budget form pattern. Currency, kind, period, and week-start are chosen once at
 * creation and are NOT editable afterwards (mirrors `UpdateAllowance` - delete and re-add to
 * change them); the edit page instead exposes name, target, and an Active/Paused control. A target
 * increase or a resume (`active: false -> true`) is gated all-or-nothing against Available - a
 * rejection surfaces as a plain-language WARNING banner (never a partial apply; the form is left
 * exactly as it was). The target is entered as a major-unit string (e.g. "1500.00"); Rust parses it
 * to minor units in the vault's base currency (allowances are base-currency only). No money math in
 * TS.
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

  /** Entity handed over via router state at construction (fast path; consumed once). */
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
  protected readonly confirmingDelete = signal(false);

  /** Read-only cadence context shown on the edit page (kind/period/weekStart are fixed at creation). */
  protected readonly cadenceContext = signal<string>('');

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
  protected readonly weekStartOptions: SelectOption[] = [
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
    // Create-only fields (fixed at creation, read-only context on edit):
    kind: this.fb.nonNullable.control<AllowanceKind>('recurring'),
    period: this.fb.nonNullable.control<AllowancePeriod>('weekly'),
    weekStart: this.fb.nonNullable.control<number>(1),
    // Edit-only field (pause/resume):
    activeChoice: this.fb.nonNullable.control<'active' | 'paused'>('active'),
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
    if (c.hasError('required')) return 'Enter a target amount.';
    if (c.hasError('maxFractionDigits')) return this.precisionError();
    return 'Target must be a number greater than 0.';
  }

  private precisionError(): string {
    const cur = this.baseCurrency().toUpperCase();
    const max = this.targetFractionDigits();
    if (max === 0) return `Amounts in ${cur} don't use decimal places.`;
    return `Amounts in ${cur} use at most ${max} decimal place${max === 1 ? '' : 's'}.`;
  }

  /** Only meaningful on the add page (kind/period are fixed after creation). */
  protected showPeriod(): boolean {
    return this.form.controls.kind.value === 'recurring';
  }
  protected showWeekStart(): boolean {
    return this.form.controls.kind.value === 'recurring' && this.form.controls.period.value === 'weekly';
  }

  protected setKind(v: string): void {
    this.form.controls.kind.setValue(v as AllowanceKind);
  }
  protected setPeriod(v: string): void {
    this.form.controls.period.setValue(v as AllowancePeriod);
  }
  protected setWeekStart(v: number | string): void {
    this.form.controls.weekStart.setValue(Number(v));
  }
  protected setActiveChoice(v: string): void {
    this.form.controls.activeChoice.setValue(v as 'active' | 'paused');
  }

  /** The banner tone: a savings-gate rejection is an advisory WARNING (nothing was changed, retry
   *  with a smaller amount or free up savings first), any other failure is an error. Keyed off the
   *  shared `SAVINGS_GATE_MESSAGE` constant (`core/bridge/error-message.ts`) - the single place that
   *  owns this copy - so the tone can never silently drift from the text if the wording changes. */
  protected bannerTone(): BannerTone {
    return this.error() === SAVINGS_GATE_MESSAGE ? 'warning' : 'error';
  }

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to add allowances.');
      return;
    }
    try {
      const settings = await getSettings();
      this.baseCurrency.set(settings.baseCurrency);

      const id = this.editingId();
      if (id !== null) {
        const allowance =
          this.passedAllowance ?? (await listAllowances()).allowances.find((a) => a.id === id) ?? null;
        if (!allowance) {
          this.error.set('That allowance could not be found.');
        } else {
          this.patchFromAllowance(allowance);
        }
      } else {
        this.form.reset({
          name: '',
          target: '',
          kind: 'recurring',
          period: 'weekly',
          weekStart: 1,
          activeChoice: 'active',
        });
      }
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private patchFromAllowance(a: Allowance): void {
    this.cadenceContext.set(this.describeCadence(a));
    this.form.reset({
      name: a.name,
      target: this.majorAmount(a.targetMinor),
      kind: a.kind,
      period: a.period ?? 'weekly',
      weekStart: a.weekStart ?? 1,
      activeChoice: a.active ? 'active' : 'paused',
    });
  }

  /** Plain-language, read-only cadence line for the edit page (kind/period/weekStart are fixed at
   *  creation - docs/allowances.md §16). */
  private describeCadence(a: Allowance): string {
    if (a.kind === 'one_time') return 'One-time - never refreshes.';
    if (a.period === 'weekly') {
      const day = this.weekStartOptions.find((o) => o.value === a.weekStart)?.label ?? 'Monday';
      return `Weekly - tops back up to your target every ${day}.`;
    }
    return 'Monthly - tops back up to your target on the 1st of the month.';
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
      const id = this.editingId();
      if (id === null) {
        await createAllowance({
          name: v.name.trim(),
          target: v.target,
          currency: this.baseCurrency(),
          kind: v.kind,
          period: v.kind === 'recurring' ? v.period : undefined,
          weekStart: v.kind === 'recurring' && v.period === 'weekly' ? v.weekStart : undefined,
        });
      } else {
        await updateAllowance({
          id,
          name: v.name.trim(),
          target: v.target,
          active: v.activeChoice === 'active',
        });
      }
      await this.router.navigate(['/allowances']);
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
      await deleteAllowance(id);
      await this.router.navigate(['/allowances']);
    } catch (e) {
      this.error.set(toUserMessage(e));
      this.confirmingDelete.set(false);
    } finally {
      this.busy.set(false);
    }
  }

  /** Stored minor units -> a major-unit string for the target field (display only; Rust re-parses). */
  private majorAmount(amountMinor: number): string {
    const digits = this.targetFractionDigits();
    return (amountMinor / Math.pow(10, digits)).toFixed(digits);
  }
}
