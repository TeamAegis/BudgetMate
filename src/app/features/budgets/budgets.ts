import { Component } from '@angular/core';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';

/**
 * Budgets / envelopes (FR-3.1). The envelope engine (caps + spent-vs-remaining) is not built yet, so
 * the screen shows a plain-language explanation rather than a dev note. Presentation only.
 */
@Component({
  selector: 'app-budgets',
  imports: [EmptyState],
  template: `
    <section class="feature-page">
      <app-empty-state
        [fill]="true"
        image="assets/illustrations/get-started.svg"
        message="Budgets let you set a monthly limit for each category and see what's left as you spend. This screen comes to life once budgets are available."
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
export class Budgets {}
