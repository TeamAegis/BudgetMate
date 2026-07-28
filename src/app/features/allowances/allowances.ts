import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { listAllowances, toUserMessage, isTauri } from '../../core/bridge';
import type { Allowance, AllowanceSummary } from '../../core/models';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { Spinner } from '../../shared/ui/spinner/spinner';
import { Fab } from '../../shared/ui/fab/fab';
import { Card } from '../../shared/ui/card/card';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { AllowanceRow } from '../../shared/ui/allowance-row/allowance-row';

/**
 * Allowances (savings-backed envelopes, FR-3.4). Smart component: reads the allowances aggregate
 * via the bridge (`list_allowances` - Rust computes the base-currency savings `Total` fresh each
 * call and derives `Reserved`/`Available` plus each row's `reservedMinor`/`overspent`/`underfunded`)
 * and renders each as an AllowanceRow, with a concise free-vs-set-aside summary up top. Add/Edit are
 * full-screen pages (`allowances/new`, `allowances/:id/edit`) - the row and the FAB navigate there;
 * this component never owns a form or a modal. All money math and the derived flags live in Rust;
 * this component only formats (the shared money pipe) and presents. Mirrors the Goals feature's
 * single-action FAB (no FabMenu - one primary action here, same as Goals).
 *
 * Five states: `loading` (first-ever fetch - skeleton rows), `empty` (no allowances yet - CTA),
 * populated (the summary card + AllowanceRow list), `error` (plain-language + retry), and `busy` (a
 * background reload - e.g. after returning from add/edit - keeps the existing list visible with a
 * small inline "Updating" indicator rather than a full-page skeleton, matching Budgets).
 */
@Component({
  selector: 'app-allowances',
  imports: [Banner, EmptyState, Skeleton, Spinner, Fab, Card, MoneyPipe, AllowanceRow],
  templateUrl: './allowances.html',
  styleUrl: './allowances.scss',
})
export class Allowances implements OnInit {
  private readonly router = inject(Router);
  protected readonly skeletonRows = [0, 1, 2];

  protected readonly summary = signal<AllowanceSummary | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to manage allowances.');
      return;
    }
    // A background reload (data already on screen, e.g. after Retry) is "busy", not "loading" - the
    // existing rows stay visible instead of flashing back to a skeleton (matches Budgets).
    const hasData = this.summary() !== null;
    if (hasData) this.busy.set(true);
    else this.loading.set(true);
    this.error.set(null);
    try {
      this.summary.set(await listAllowances());
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
      this.busy.set(false);
    }
  }

  protected retry(): void {
    void this.reload();
  }

  protected addAllowance(): void {
    void this.router.navigate(['/allowances/new']);
  }

  /** Open the edit page for this allowance, handing the row over via router state (fast path; the
   *  form falls back to fetching it if state is missing). */
  protected openAllowance(a: Allowance): void {
    void this.router.navigate(['/allowances', a.id, 'edit'], { state: { allowance: a } });
  }
}
