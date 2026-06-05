import { Component } from '@angular/core';

@Component({
  selector: 'app-goals',
  template: `
    <section class="feature-page">
      <h1>Goals</h1>
      <p class="muted">Savings goals with milestone progress (FR-3.2).</p>
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
export class Goals {}
