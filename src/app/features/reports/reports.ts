import { Component } from '@angular/core';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';

@Component({
  selector: 'app-reports',
  imports: [EmptyState],
  template: `
    <section class="feature-page">
      <!-- Pie/line charts from Rust-side aggregations land with FR-3.3; until there's data to
           aggregate the screen shows its empty state. -->
      <app-empty-state
        [fill]="true"
        image="assets/illustrations/analytics.svg"
        message="No data yet — spending charts appear once you have transactions."
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
export class Reports {}
