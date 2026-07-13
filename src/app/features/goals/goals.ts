import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { listGoals, toUserMessage, isTauri } from '../../core/bridge';
import type { Goal } from '../../core/models';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { GoalProgressRow } from '../../shared/ui/goal-progress-row/goal-progress-row';
import { Fab } from '../../shared/ui/fab/fab';
import { SegmentedToggle, type SegmentOption } from '../../shared/ui/segmented-toggle/segmented-toggle';

type GoalFilter = 'ongoing' | 'completed';

/**
 * Savings goals list (FR-3.2). Smart component: reads goals via the bridge and renders each as a
 * GoalProgressRow. Add/Edit are full-screen pages (`goals/new`, `goals/:id/edit`) - the row's edit
 * button and the FAB navigate there; this component never owns a form or a modal. All money
 * formatting goes through the GoalProgressRow (logic stays in Rust).
 */
@Component({
  selector: 'app-goals',
  imports: [Banner, EmptyState, Skeleton, GoalProgressRow, Fab, SegmentedToggle],
  templateUrl: './goals.html',
  styleUrl: './goals.scss',
})
export class Goals implements OnInit {
  private readonly router = inject(Router);
  protected readonly skeletonRows = [0, 1, 2];

  protected readonly goals = signal<Goal[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /** Ongoing/Completed list filter (design-system §7 SegmentedToggle). */
  protected readonly filter = signal<GoalFilter>('ongoing');
  protected readonly statusOptions: SegmentOption[] = [
    { value: 'ongoing', label: 'Ongoing' },
    { value: 'completed', label: 'Completed' },
  ];

  /**
   * Goals for the active tab. "Completed" reuses the same `completed` flag the GoalProgressRow
   * renders (derived in Rust), so the toggle and the row badge can never disagree.
   */
  protected readonly filtered = computed(() => {
    const showCompleted = this.filter() === 'completed';
    return this.goals().filter((g) => g.completed === showCompleted);
  });

  async ngOnInit(): Promise<void> {
    await this.reload();
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
      this.goals.set(await listGoals());
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected addGoal(): void {
    void this.router.navigate(['/goals/new']);
  }

  /** Open the read-only detail page, handing the row over via router state (fast path; refetches). */
  protected openGoal(g: Goal): void {
    void this.router.navigate(['/goals', g.id], { state: { goal: g } });
  }
}
