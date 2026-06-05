import { Component } from '@angular/core';

@Component({
  selector: 'app-settings',
  template: `
    <section class="feature-page">
      <h1>Settings</h1>
      <p class="muted">
        Backup / restore / export, base currency, lock timeout (FR-4.x, FR-5.x). Export is
        plaintext by design and the UI warns accordingly.
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
export class Settings {}
