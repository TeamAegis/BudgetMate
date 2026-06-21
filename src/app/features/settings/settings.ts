import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideWallet,
  LucideTags,
  LucideChevronRight,
  LucideLock,
  LucideRepeat,
  LucideCoins,
  LucideFunnel,
} from '@lucide/angular';
import { LockService } from '../../core/lock/lock.service';
import { getSettings, setBaseCurrency, isTauri } from '../../core/bridge';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';

@Component({
  selector: 'app-settings',
  imports: [
    RouterLink,
    LucideWallet,
    LucideTags,
    LucideChevronRight,
    LucideLock,
    LucideRepeat,
    LucideCoins,
    LucideFunnel,
    SelectField,
  ],
  template: `
    <section class="feature-page">
      <ul class="settings-list">
        <li>
          <a routerLink="/settings/accounts">
            <svg lucideWallet [size]="24" aria-hidden="true"></svg>
            <span class="label">Accounts</span>
            <span class="hint">Manage where money lives</span>
            <svg lucideChevronRight [size]="18" class="chevron" aria-hidden="true"></svg>
          </a>
        </li>
        <li>
          <a routerLink="/settings/categories">
            <svg lucideTags [size]="24" aria-hidden="true"></svg>
            <span class="label">Categories</span>
            <span class="hint">Organise spending &amp; income</span>
            <svg lucideChevronRight [size]="18" class="chevron" aria-hidden="true"></svg>
          </a>
        </li>
        <li>
          <a routerLink="/settings/recurring">
            <svg lucideRepeat [size]="24" aria-hidden="true"></svg>
            <span class="label">Recurring</span>
            <span class="hint">Scheduled, auto-materialised transactions</span>
            <svg lucideChevronRight [size]="18" class="chevron" aria-hidden="true"></svg>
          </a>
        </li>
        <li>
          <a routerLink="/settings/rules">
            <svg lucideFunnel [size]="24" aria-hidden="true"></svg>
            <span class="label">Rules</span>
            <span class="hint">Auto-categorise by if-then rules</span>
            <svg lucideChevronRight [size]="18" class="chevron" aria-hidden="true"></svg>
          </a>
        </li>
      </ul>

      <h2 class="group-title">General</h2>
      <div class="setting-row">
        <svg lucideCoins [size]="24" aria-hidden="true"></svg>
        <span class="label" id="base-currency-label">Base currency</span>
        <app-select-field
          [options]="currencyOptions"
          [value]="baseCurrency()"
          (valueChange)="onBaseCurrencyChange($event)"
          ariaLabelledby="base-currency-label"
        />
      </div>
      <p class="setting-hint">Foreign-currency transactions convert to this for reporting.</p>

      <h2 class="group-title">Security</h2>
      <div class="setting-row">
        <svg lucideLock [size]="24" aria-hidden="true"></svg>
        <span class="label" id="lock-timeout-label">Lock timeout</span>
        <app-select-field
          [options]="timeoutOptions"
          [value]="lock.idleTimeoutSecs()"
          (valueChange)="onTimeoutChange($event)"
          ariaLabelledby="lock-timeout-label"
        />
      </div>
      <p class="setting-hint">Auto-locks the app after this idle time. Backgrounding always locks.</p>

      <p class="muted">
        Budgets/envelopes, rules, export, and encrypted backup/restore
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
    .setting-hint {
      margin-top: calc(-1 * var(--space-3));
      font-size: var(--t-caption);
      color: var(--c-text-muted);
    }
  `,
})
export class Settings implements OnInit {
  protected readonly lock = inject(LockService);

  protected readonly baseCurrency = signal<string>('MUR');

  protected readonly timeoutOptions: SelectOption[] = [
    { value: 30, label: '30 seconds' },
    { value: 60, label: '1 minute' },
    { value: 120, label: '2 minutes' },
    { value: 300, label: '5 minutes' },
    { value: 0, label: 'Never' },
  ];

  // A small curated set (no full ISO list - binary/UX size); any 3-letter code is valid in Rust.
  protected readonly currencyOptions: SelectOption[] = [
    { value: 'MUR', label: 'MUR · Mauritian rupee' },
    { value: 'USD', label: 'USD · US dollar' },
    { value: 'EUR', label: 'EUR · Euro' },
    { value: 'GBP', label: 'GBP · Pound sterling' },
    { value: 'INR', label: 'INR · Indian rupee' },
    { value: 'ZAR', label: 'ZAR · South African rand' },
    { value: 'AUD', label: 'AUD · Australian dollar' },
    { value: 'JPY', label: 'JPY · Japanese yen' },
  ];

  async ngOnInit(): Promise<void> {
    if (!isTauri()) return;
    try {
      this.baseCurrency.set((await getSettings()).baseCurrency);
    } catch {
      // Non-fatal: keep the default; the picker still works once the core is reachable.
    }
  }

  protected onTimeoutChange(value: number | string): void {
    void this.lock.updateIdleTimeout(Number(value));
  }

  protected async onBaseCurrencyChange(value: number | string): Promise<void> {
    const settings = await setBaseCurrency(String(value));
    this.baseCurrency.set(settings.baseCurrency);
  }
}
