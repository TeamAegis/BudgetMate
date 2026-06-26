import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideTrash2 } from '@lucide/angular';
import {
  createGoal,
  updateGoal,
  deleteGoal,
  listGoals,
  getSettings,
  toUserMessage,
  isTauri,
} from '../../core/bridge';
import type { Goal } from '../../core/models';
import { HeaderActionService } from '../../core/layout/header-action.service';
import { Button } from '../../shared/ui/button/button';
import { Banner } from '../../shared/ui/banner/banner';
import { Spinner } from '../../shared/ui/spinner/spinner';
import { FormField } from '../../shared/ui/form-field/form-field';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';

const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Full-screen Add/Edit Goal page (FR-3.2). Replaces the former centred modal: a pushed route
 * (`goals/new`, `goals/:id/edit`) with Save in the app header (so the Android soft keyboard can
 * never hide it) and the back arrow as Cancel. Smart component - reads reference data through the
 * bridge and renders with shared/ui. The saved/target amounts are major-unit strings parsed (and
 * `completed` derived) in Rust; TS only formats. No money math in TS.
 */
@Component({
  selector: 'app-goal-form',
  imports: [ReactiveFormsModule, LucideTrash2, Button, Banner, Spinner, FormField, ConfirmDialog],
  templateUrl: './goal-form.html',
  styleUrl: './goal-form.scss',
})
export class GoalForm implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly headerAction = inject(HeaderActionService);
  private readonly destroyRef = inject(DestroyRef);

  /** Entity handed over via router state at construction (consumed once). */
  private readonly nav = this.router.getCurrentNavigation();
  private readonly passedGoal = (this.nav?.extras.state?.['goal'] as Goal | undefined) ?? null;

  /** Edit id from the route (`goals/:id/edit`); null on the add route. */
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

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    target: ['', [Validators.required, Validators.pattern(DECIMAL)]],
    current: ['0', [Validators.required, Validators.pattern(DECIMAL)]],
    currency: ['MUR', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
    targetDate: [''],
  });

  constructor() {
    // Publish Save into the global header; the back arrow is Cancel (App owns it). Re-published on
    // busy() change so the header button shows the in-flight state. Cleared on teardown.
    effect(() => {
      this.headerAction.set({ label: 'Save', loading: this.busy(), run: () => void this.save() });
    });
    this.destroyRef.onDestroy(() => this.headerAction.clear());
  }

  // ── Inline validation messages (A9) - message only when invalid AND touched; null otherwise. ──
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

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to add goals.');
      return;
    }
    try {
      const settings = await getSettings();
      this.baseCurrency.set(settings.baseCurrency);

      const id = this.editingId();
      if (id !== null) {
        const goal = this.passedGoal ?? (await listGoals()).find((g) => g.id === id) ?? null;
        if (!goal) {
          this.error.set('That goal could not be found.');
        } else {
          this.patchFromGoal(goal);
        }
      } else {
        this.form.reset({
          name: '',
          target: '',
          current: '0',
          currency: this.baseCurrency(),
          targetDate: '',
        });
      }
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private patchFromGoal(g: Goal): void {
    this.form.reset({
      name: g.name,
      target: this.majorAmount(g.targetMinor, g.currency),
      current: this.majorAmount(g.currentMinor, g.currency),
      currency: g.currency,
      targetDate: g.targetDate ?? '',
    });
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
      await this.router.navigate(['/goals']);
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
      await deleteGoal(id);
      await this.router.navigate(['/goals']);
    } catch (e) {
      this.error.set(toUserMessage(e));
      this.confirmingDelete.set(false);
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
