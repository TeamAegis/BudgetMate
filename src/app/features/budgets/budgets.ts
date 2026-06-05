import { Component } from '@angular/core';

@Component({
  selector: 'app-budgets',
  template: `
    <section class="feature-page">
      <p class="muted">Envelope-style monthly caps, spent vs remaining (FR-3.1). Reached from Settings.</p>
    </section>
  `,
  styles: `
    .feature-page {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .muted {
      color: var(--c-text-muted);
    }
  `,
})
export class Budgets {}
