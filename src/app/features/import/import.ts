import { Component } from '@angular/core';

@Component({
  selector: 'app-import',
  template: `
    <section class="feature-page">
      <h1>Import</h1>
      <p class="muted">
        On-device OCR receipt review (FR-2.1), CSV/OFX/QFX file import (FR-2.2), rule engine
        (FR-2.3) and dedup review (FR-2.4). OCR returns raw text + boxes; deterministic Rust
        extracts merchant/date/total and the user confirms before saving. Lazy-loaded route.
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
export class Import {}
