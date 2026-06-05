import { Component } from '@angular/core';

@Component({
  selector: 'app-transactions',
  template: `
    <section class="feature-page">
      <h1>Transactions</h1>
      <p class="muted">
        Manual entry, splits, recurring, and multi-currency (FR-1.x). All money math runs in the
        Rust core; this screen will call typed bridge wrappers.
      </p>
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
export class Transactions {}
