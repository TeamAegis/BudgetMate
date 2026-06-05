import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideWallet, LucideTags, LucideChevronRight, LucideLock } from '@lucide/angular';
import { LockService } from '../../core/lock/lock.service';

@Component({
  selector: 'app-settings',
  imports: [RouterLink, LucideWallet, LucideTags, LucideChevronRight, LucideLock],
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

      <h2 class="group-title">Security</h2>
      <div class="setting-row">
        <svg lucideLock [size]="20" aria-hidden="true"></svg>
        <span class="label" id="lock-timeout-label">Lock timeout</span>
        <select
          class="control"
          aria-labelledby="lock-timeout-label"
          [value]="lock.idleTimeoutSecs()"
          (change)="onTimeoutChange($event)"
        >
          <option [value]="30">30 seconds</option>
          <option [value]="60">1 minute</option>
          <option [value]="120">2 minutes</option>
          <option [value]="300">5 minutes</option>
          <option [value]="0">Never</option>
        </select>
      </div>
      <p class="hint">Auto-locks the app after this idle time. Backgrounding always locks.</p>

      <p class="muted">
        Base currency, budgets/envelopes, rules, export, and encrypted backup/restore
        (FR-3.1, FR-4.x, FR-5.x) arrive in later tickets.
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
    .group-title {
      margin-bottom: calc(-1 * var(--space-3));
      color: var(--c-text-muted);
      font-size: var(--t-section);
    }
    .setting-row {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-4);
      min-height: var(--tap-target-min);
      background: var(--c-surface);
      border: 1px solid var(--c-border);
      border-radius: var(--radius-md);
    }
    .setting-row svg {
      color: var(--c-primary-700);
    }
    .setting-row .label {
      flex: 1;
      font-weight: var(--fw-medium);
    }
    .setting-row .control {
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--c-border);
      border-radius: var(--radius-sm);
      font: inherit;
      background: var(--c-bg);
      color: var(--c-text);
    }
    .hint {
      margin-top: calc(-1 * var(--space-3));
      font-size: var(--t-caption);
      color: var(--c-text-muted);
    }
  `,
})
export class Settings {
  protected readonly lock = inject(LockService);

  protected onTimeoutChange(event: Event): void {
    const secs = Number((event.target as HTMLSelectElement).value);
    void this.lock.updateIdleTimeout(secs);
  }
}
