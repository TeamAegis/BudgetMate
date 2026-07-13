import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { listEnvelopes, toUserMessage, isTauri } from '../../core/bridge';
import type { EnvelopeSummary } from '../../core/models';
import { Banner } from '../../shared/ui/banner/banner';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { Spinner } from '../../shared/ui/spinner/spinner';
import { Fab } from '../../shared/ui/fab/fab';
import { EnvelopeCard } from '../../shared/ui/envelope-card/envelope-card';

/**
 * Budgets / envelopes (FR-3.1). Smart component: reads the current month's envelope summaries via
 * the bridge (`list_envelopes` - Rust aggregates spend from splits, converts to base currency, and
 * classifies under/approaching/over) and renders each as an EnvelopeCard. Add/Edit are full-screen
 * pages (`budgets/new`, `budgets/:id/edit`) - the card and the FAB navigate there; this component
 * never owns a form or a modal. All money math and status classification live in Rust.
 *
 * Five states: `loading` (first-ever fetch - skeleton rows), `empty` (no caps set yet - CTA),
 * populated (the EnvelopeCard grid), `error` (plain-language + retry), and `busy` (a background
 * reload - e.g. after returning from add/edit - keeps the existing list visible with a small
 * inline "Updating" indicator rather than a full-page skeleton, per design.md's "busy/processing…
 * UI stays responsive").
 */
@Component({
  selector: 'app-budgets',
  imports: [Banner, EmptyState, Skeleton, Spinner, Fab, EnvelopeCard],
  templateUrl: './budgets.html',
  styleUrl: './budgets.scss',
})
export class Budgets implements OnInit {
  private readonly router = inject(Router);
  protected readonly skeletonRows = [0, 1, 2];

  protected readonly envelopes = signal<EnvelopeSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to manage budgets.');
      return;
    }
    // A background reload (data already on screen, e.g. after Retry) is "busy", not "loading" -
    // the existing cards stay visible instead of flashing back to a skeleton.
    const hasData = this.envelopes().length > 0;
    if (hasData) this.busy.set(true);
    else this.loading.set(true);
    this.error.set(null);
    try {
      this.envelopes.set(await listEnvelopes());
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

  protected addBudget(): void {
    void this.router.navigate(['/budgets/new']);
  }

  /** Open the edit page for this envelope's underlying budget row, handing the summary over via
   *  router state (fast path; the form falls back to fetching it if state is missing). */
  protected openEnvelope(e: EnvelopeSummary): void {
    void this.router.navigate(['/budgets', e.id, 'edit'], { state: { envelope: e } });
  }
}
