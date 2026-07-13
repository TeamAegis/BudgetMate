import { Component, DestroyRef, OnInit, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { listGoals, deleteGoal, toUserMessage, isTauri } from '../../core/bridge';
import type { Goal } from '../../core/models';
import { HeaderActionService } from '../../core/layout/header-action.service';
import { Banner } from '../../shared/ui/banner/banner';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { GoalProgressRow } from '../../shared/ui/goal-progress-row/goal-progress-row';
import { FormActions } from '../../shared/ui/form-actions/form-actions';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { DetailRow } from '../../shared/ui/detail-row/detail-row';

/**
 * Full-screen read-only Goal detail (FR-3.2, issue I5). The goal card taps through to here; Edit is
 * the primary bottom-bar action (-> goals/:id/edit) and Delete is the header danger icon (ADR 0003,
 * same placement as the edit forms) opening ConfirmDialog. The progress visualization reuses
 * GoalProgressRow in its
 * non-interactive mode. No money math in TS (no "amount left" - target-current arithmetic belongs in
 * Rust). The entity is handed over via router state on the list tap; a deep link refetches by id.
 */
@Component({
  selector: 'app-goal-detail',
  imports: [Banner, Skeleton, EmptyState, GoalProgressRow, FormActions, ConfirmDialog, DetailRow],
  templateUrl: './goal-detail.html',
  styleUrl: './goal-detail.scss',
})
export class GoalDetail implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly headerAction = inject(HeaderActionService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly nav = this.router.getCurrentNavigation();
  private readonly passedGoal = (this.nav?.extras.state?.['goal'] as Goal | undefined) ?? null;
  private readonly id = Number(this.route.snapshot.paramMap.get('id'));

  protected readonly goal = signal<Goal | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notFound = signal(false);
  protected readonly confirmingDelete = signal(false);

  constructor() {
    effect(() => {
      this.headerAction.set(
        this.goal()
          ? { label: 'Delete goal', icon: 'trash', run: () => this.confirmingDelete.set(true) }
          : null,
      );
    });
    this.destroyRef.onDestroy(() => this.headerAction.clear());
  }

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to view a goal.');
      return;
    }
    try {
      const found = this.passedGoal ?? (await listGoals()).find((g) => g.id === this.id) ?? null;
      if (found) this.goal.set(found);
      else this.notFound.set(true);
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected backToList(): void {
    void this.router.navigate(['/goals']);
  }

  protected edit(): void {
    const g = this.goal();
    if (!g) return;
    void this.router.navigate(['/goals', g.id, 'edit'], { state: { goal: g } });
  }

  protected async deleteConfirmed(): Promise<void> {
    const g = this.goal();
    if (!g) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await deleteGoal(g.id);
      await this.router.navigate(['/goals']);
    } catch (e) {
      this.error.set(toUserMessage(e));
      this.confirmingDelete.set(false);
    } finally {
      this.busy.set(false);
    }
  }
}
