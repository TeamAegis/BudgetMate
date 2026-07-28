import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucideBan, LucideWalletCards, LucideChevronRight } from '@lucide/angular';
import { listAllowances, toUserMessage, isTauri } from '../../core/bridge';
import type { Allowance } from '../../core/models';
import { SettingsRow } from '../../shared/ui/settings-row/settings-row';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Banner } from '../../shared/ui/banner/banner';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';

/**
 * Optional allowance-tagging picker for a transaction (FR-3.4, `docs/allowances.md` §12). Reached
 * by tapping the transaction form's "Allowance" context row - mirrors `category-picker.ts`'s pattern
 * (ADR 0004): a plain navigation list (Settings style, no Save bar) of ACTIVE allowances plus a
 * "None" row to clear the tag. The in-progress form is forwarded here as `resume` (router state) and
 * carried straight back to `returnTo` (also router state - the create OR edit form's own URL, set by
 * `TransactionForm.changeAllowance()`) unchanged except for the picked `allowanceId`, so tagging (or
 * clearing) an allowance never loses anything else the user typed. Tagging is fully optional - the
 * form works exactly the same with `allowanceId` left `null` (§12).
 */
@Component({
  selector: 'app-allowance-picker',
  imports: [RouterLink, SettingsRow, EmptyState, Banner, Skeleton, LucideBan, LucideWalletCards, LucideChevronRight],
  template: `
    <section class="feature-page">
      @if (error(); as err) {
        <app-banner>{{ err }}</app-banner>
      }

      @if (loading()) {
        <ul class="rows" aria-busy="true">
          @for (i of skeletonRows; track i) {
            <li class="skeleton-row"><app-skeleton variant="text" width="60%" /></li>
          }
        </ul>
      } @else {
        <p class="prompt">Tag this transaction to an allowance (optional)</p>
        <ul class="rows">
          <li>
            <a
              app-settings-row
              [routerLink]="returnTo"
              [state]="stateFor(null)"
              [replaceUrl]="true"
              label="None"
              hint="Don't tag this transaction to any allowance"
            >
              <svg icon lucideBan [size]="24" aria-hidden="true"></svg>
              <svg trailing lucideChevronRight [size]="18" aria-hidden="true"></svg>
            </a>
          </li>
          @for (a of allowances(); track a.id; let i = $index) {
            <li animate.enter="list-item-enter" [style.animation-delay]="(i < 12 ? i * 40 : 0) + 'ms'">
              <a
                app-settings-row
                [routerLink]="returnTo"
                [state]="stateFor(a.id)"
                [replaceUrl]="true"
                [label]="a.name"
                [hint]="hintFor(a)"
              >
                <svg icon lucideWalletCards [size]="24" aria-hidden="true"></svg>
                <svg trailing lucideChevronRight [size]="18" aria-hidden="true"></svg>
              </a>
            </li>
          }
        </ul>
        @if (allowances().length === 0 && !error()) {
          <app-empty-state message="No active allowances yet. Add one from Settings to tag transactions." />
        }
      }
    </section>
  `,
  styles: `
    .feature-page {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .prompt {
      margin: 0;
      color: var(--c-text-muted);
    }
    .rows {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .skeleton-row {
      padding: var(--space-4);
      border: 1px solid var(--c-border);
      border-radius: var(--radius-md);
    }
  `,
})
export class AllowancePicker implements OnInit {
  private readonly router = inject(Router);

  /** Where to navigate back to (the create/edit form's own URL) and the in-progress form to
   *  forward unchanged, both handed over via router state by `TransactionForm.changeAllowance()`. */
  protected readonly returnTo =
    (this.router.getCurrentNavigation()?.extras.state?.['returnTo'] as string | undefined) ??
    '/expenses';
  private readonly resume = this.router.getCurrentNavigation()?.extras.state?.['resume'] as
    | Record<string, unknown>
    | undefined;

  protected readonly skeletonRows = [0, 1, 2];
  protected readonly allowances = signal<Allowance[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    if (!isTauri()) {
      this.loading.set(false);
      this.error.set('Run the app (npm run tauri dev) to tag an allowance.');
      return;
    }
    try {
      const summary = await listAllowances();
      this.allowances.set(
        summary.allowances.filter((a) => a.active).sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (e) {
      this.error.set(toUserMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected hintFor(a: Allowance): string {
    if (a.kind === 'one_time') return 'One-time';
    return a.period === 'weekly' ? 'Weekly' : 'Monthly';
  }

  /** The resumed form snapshot with only `allowanceId` overridden - forwarded verbatim otherwise. */
  protected stateFor(allowanceId: number | null): { resume: Record<string, unknown> } {
    return { resume: { ...this.resume, allowanceId } };
  }
}
