import { Component } from '@angular/core';

@Component({
  selector: 'app-budgets',
  template: `
    <section class="feature-page">
      <h1>Budgets</h1>
      <p class="muted">Envelope-style monthly caps, spent vs remaining (FR-3.1).</p>
    </section>
  `,
  styles: `
    .feature-page {
      display: flex;
      flex-direction: column;
      gap: var(--space-md);
    }
    .muted {
      color: var(--color-on-surface-variant);
    }
  `,
})
export class Budgets {}
