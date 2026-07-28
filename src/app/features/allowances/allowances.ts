import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { listAllowances, toUserMessage, isTauri } from '../../core/bridge';
import type { Allowance, AllowanceSummary } from '../../core/models';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { Spinner } from '../../shared/ui/spinner/spinner';
import { Fab } from '../../shared/ui/fab/fab';
import { AllowanceCard } from '../../shared/ui/allowance-card/allowance-card';
import { AllowanceSummaryStrip } from '../../shared/ui/allowance-summary-strip/allowance-summary-strip';

/**
 * Allowances (savings-backed envelopes, FR-3.4). Smart component: reads the aggregate via the
 * bridge (`list_allowances` - Rust derives `Reserved`/`Available`/`Total` fresh every call, never
 * stored - see `docs/allowances.md` §4) and renders the summary strip + each allowance as an
 * AllowanceCard. Add/Edit are full-screen pages (`allowances/new`, `allowances/:id/edit`) - the card
 * and the FAB navigate there; this component never owns a form or a modal. All money math and the
 * derived status flags (`reservedMinor`/`overspent`/`underfunded`) live in Rust.
 *
 * Five states: `loading` (first-ever fetch - skeleton rows), `empty` (no allowances yet - CTA),
 * populated (the summary strip + AllowanceCard list), `error` (plain-language + retry), and `busy`
 * (a background reload - e.g. after returning from add/edit - keeps the existing list visible with a
 * small inline "Updating" indicator rather than a full-page skeleton, per design.md's
 * "busy/processing... UI stays responsive").
 */
@Component({
  selector: 'app-allowances',
  imports: [Banner, EmptyState, Skeleton, Spinner, Fab, AllowanceCard, AllowanceSummaryStrip],
  templateUrl: './allowances.html',
  styleUrl: './allowances.scss',
})
export class Allowances implements OnInit {
  private readonly router = inject(Router);
  protected readonly skeletonRows = [0, 1, 2];

  protected readonly summary = signal<AllowanceSummary | null>(null);
  protected readonly allowances = computed(() => this.summary()?.allowances ?? []);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Plain-language note when active allowances in another currency aren't in the totals (defensive
   *  - allowances are base-currency only at creation, but a later base-currency change can strand a
   *  row - mirrors Home's `caveatNote` for `excludedAccounts`/`excludedGoals`). */
  protected readonly excludedNote = computed<string | null>(() => {
    const n = this.summary()?.excludedAllowances ?? 0;
    if (n <= 0) return null;
    const noun = n === 1 ? 'allowance' : 'allowances';
    const verb = n === 1 ? "isn't" : "aren't";
    return `${n} ${noun} in another currency ${verb} included in this total yet.`;
  });

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
    // existing cards stay visible instead of flashing back to a skeleton.
    const hasData = this.allowances().length > 0;
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

  /** Open the edit page for this allowance, handing it over via router state (fast path; the form
   *  falls back to fetching it if state is missing). */
  protected openAllowance(a: Allowance): void {
    void this.router.navigate(['/allowances', a.id, 'edit'], { state: { allowance: a } });
  }
}
