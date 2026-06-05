import { Component } from '@angular/core';

@Component({
  selector: 'app-transactions',
  template: `
    <section class="feature-page">
      <p class="muted">
        Transaction list + manual entry, splits, recurring, and multi-currency (FR-1.x); Scan
        Receipt and Import are nested actions here. All money math runs in the Rust core; this
        screen calls typed bridge wrappers.
      </p>
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
export class Transactions {}
