import { Component } from '@angular/core';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';

@Component({
  selector: 'app-goals',
  imports: [EmptyState],
  template: `
    <section class="feature-page">
      <!-- Savings-goal CRUD lands with FR-3.2; until then the screen shows its empty state. -->
      <app-empty-state
        [fill]="true"
        image="assets/illustrations/get-started.svg"
        message="No goals yet — savings goals with milestone progress are coming soon."
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
export class Goals {}
