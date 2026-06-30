import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';

/**
 * Analytics. The spend-by-category and over-time charts come from Rust aggregations (FR-3.3, not yet
 * built), so until there is data the screen shows a friendly empty state that points at the next
 * step. Presentation only - no fabricated charts.
 */
@Component({
  selector: 'app-reports',
  imports: [EmptyState],
  template: `
    <section class="feature-page">
      <app-empty-state
        [fill]="true"
        image="assets/illustrations/analytics.svg"
        message="No spending to chart yet. Add a few expenses and your spending by category and over time will appear here."
        cta="Add an expense"
        (action)="addExpense()"
      />
    </section>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    .feature-page {
      display: flex;
      flex-direction: column;
      flex: 1;
      gap: var(--space-4);
    }
  `,
})
export class Reports {
  private readonly router = inject(Router);

  protected addExpense(): void {
    void this.router.navigate(['/expenses/new']);
  }
}
