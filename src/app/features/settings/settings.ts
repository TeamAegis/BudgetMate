import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideWallet, LucideTags, LucideChevronRight } from '@lucide/angular';

@Component({
  selector: 'app-settings',
  imports: [RouterLink, LucideWallet, LucideTags, LucideChevronRight],
  template: `
    <section class="feature-page">
      <ul class="settings-list">
        <li>
          <a routerLink="/settings/accounts">
            <svg lucideWallet [size]="20"></svg>
            <span class="label">Accounts</span>
            <span class="hint">Manage where money lives</span>
            <svg lucideChevronRight [size]="18" class="chevron"></svg>
          </a>
        </li>
        <li>
          <a routerLink="/settings/categories">
            <svg lucideTags [size]="20"></svg>
            <span class="label">Categories</span>
            <span class="hint">Organise spending &amp; income</span>
            <svg lucideChevronRight [size]="18" class="chevron"></svg>
          </a>
        </li>
      </ul>

      <p class="muted">
        Base currency, lock timeout, budgets/envelopes, rules, export, and encrypted
        backup/restore (FR-3.1, FR-4.x, FR-5.x) arrive in later tickets.
      </p>
    </section>
  `,
  styles: `
    .feature-page {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }
    .muted {
      color: var(--c-text-muted);
    }
    .settings-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .settings-list a {
      display: grid;
      grid-template-columns: auto 1fr auto;
      grid-template-areas: 'icon label chevron' 'icon hint chevron';
      align-items: center;
      column-gap: var(--space-3);
      padding: var(--space-4);
      min-height: var(--tap-target-min);
      background: var(--c-surface);
      border: 1px solid var(--c-border);
      border-radius: var(--radius-md);
      text-decoration: none;
      color: var(--c-text);
    }
    .settings-list svg:first-child {
      grid-area: icon;
      color: var(--c-primary-700);
    }
    .settings-list .label {
      grid-area: label;
      font-weight: var(--fw-medium);
    }
    .settings-list .hint {
      grid-area: hint;
      font-size: var(--t-caption);
      color: var(--c-text-muted);
    }
    .settings-list .chevron {
      grid-area: chevron;
      color: var(--c-text-muted);
    }
  `,
})
export class Settings {}
