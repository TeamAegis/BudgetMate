import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucidePlus, LucideTrash2 } from '@lucide/angular';
import {
  listGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  getSettings,
  toUserMessage,
  isTauri,
} from '../../core/bridge';
import type { Goal } from '../../core/models';
import { Button } from '../../shared/ui/button/button';
import { IconButton } from '../../shared/ui/icon-button/icon-button';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { FormField } from '../../shared/ui/form-field/form-field';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { Modal } from '../../shared/ui/modal/modal';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { GoalProgressRow } from '../../shared/ui/goal-progress-row/goal-progress-row';

const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Savings goals (FR-3.2). Smart component: reads goals via the bridge and renders each as a
 * GoalProgressRow. Add/Edit happen in an app-modal; the saved/target amounts are major-unit
 * strings parsed (and `completed` derived) in Rust. No money math in TS.
 */
@Component({
  selector: 'app-goals',
  imports: [
    ReactiveFormsModule,
    LucidePlus,
    LucideTrash2,
    Button,
    IconButton,
    Banner,
    EmptyState,
    FormField,
    Skeleton,
    Modal,
    ConfirmDialog,
    GoalProgressRow,
  ],
  templateUrl: './goals.html',
  styleUrl: './goals.scss',
})
export class Goals implements OnInit {
  private readonly fb = inject(FormBuilder);
  protected readonly skeletonRows = [0, 1, 2];

  protected readonly goals = signal<Goal[]>([]);
  protected readonly baseCurrency = signal('MUR');
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editingId = signal<number | null>(null);
  protected readonly showForm = signal(false);
  protected readonly editing = computed(() => this.editingId() !== null);
  protected readonly confirmingDelete = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    target: ['', [Validators.required, Validators.pattern(DECIMAL)]],
    current: ['0', [Validators.required, Validators.pattern(DECIMAL)]],
    currency: ['MUR', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
    targetDate: [''],
  });

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  // ── Inline validation messages (A9) — message only when invalid AND touched; null otherwise. ──
  protected nameError(): string | null {
    const c = this.form.controls.name;
    if (!c.invalid || !c.touched) return null;
    return c.hasError('required') ? 'Enter a name.' : 'Name is too long (60 characters max).';
  }

  protected targetError(): string | null {
    const c = this.form.controls.target;
    if (!c.invalid || !c.touched) return null;
    return c.hasError('required') ? 'Enter a target amount.' : 'Target must be a number greater than 0.';
  }

  protected currentError(): string | null {
    const c = this.form.controls.current;
    if (!c.invalid || !c.touched) return null;
    return c.hasError('required') ? 'Enter an amount (use 0 if none).' : 'Use a number, e.g. 0.';
  }

  protected currencyError(): string | null {
    const c = this.form.controls.currency;
    if (!c.invalid || !c.touched) return null;
    return 'Use a 3-letter currency code, e.g. MUR.';
  }

  private async reload(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to manage goals.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const [goals, settings] = await Promise.all([listGoals(), getSettings()]);
      this.goals.set(goals);
      this.baseCurrency.set(settings.baseCurrency);
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected startCreate(): void {
    this.editingId.set(null);
    this.form.reset({ name: '', target: '', current: '0', currency: this.baseCurrency(), targetDate: '' });
    this.error.set(null);
    this.showForm.set(true);
  }

  protected startEdit(g: Goal): void {
    this.editingId.set(g.id);
    this.form.reset({
      name: g.name,
      target: this.majorAmount(g.targetMinor, g.currency),
      current: this.majorAmount(g.currentMinor, g.currency),
      currency: g.currency,
      targetDate: g.targetDate ?? '',
    });
    this.error.set(null);
    this.showForm.set(true);
  }

  protected cancel(): void {
    this.showForm.set(false);
    this.confirmingDelete.set(false);
    this.error.set(null);
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const input = {
      name: v.name.trim(),
      target: v.target,
      current: v.current,
      currency: v.currency.toUpperCase(),
      targetDate: v.targetDate.trim() || null,
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      const id = this.editingId();
      if (id === null) await createGoal(input);
      else await updateGoal({ id, ...input });
      this.showForm.set(false);
      await this.reload();
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** Delete the goal currently open in the edit modal (after footer-trash confirmation). */
  protected async deleteConfirmed(): Promise<void> {
    const id = this.editingId();
    if (id === null) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await deleteGoal(id);
      this.confirmingDelete.set(false);
      this.showForm.set(false);
      await this.reload();
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** Stored minor units → a major-unit string for the edit fields (display only; Rust re-parses). */
  private majorAmount(amountMinor: number, currency: string): string {
    const digits =
      new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    return (amountMinor / Math.pow(10, digits)).toFixed(digits);
  }
}
