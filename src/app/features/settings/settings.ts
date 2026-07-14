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
  LucideDownload,
  LucideDatabaseBackup,
} from '@lucide/angular';
import { LockService } from '../../core/lock/lock.service';
import { getSettings, setBaseCurrency, isTauri } from '../../core/bridge';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';
import { SettingsRow } from '../../shared/ui/settings-row/settings-row';
import { PrivacyNote } from '../../shared/ui/privacy-note/privacy-note';

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
    LucideDownload,
    LucideDatabaseBackup,
    SelectField,
    SettingsRow,
    PrivacyNote,
  ],
  template: `
    <section class="feature-page">
      <h2 class="group-title">Your money</h2>
      <ul class="rows">
        <li>
          <a app-settings-row routerLink="/settings/accounts" label="Accounts" hint="Cash, bank, card or wallet">
            <svg icon lucideWallet [size]="24" aria-hidden="true"></svg>
            <svg trailing lucideChevronRight [size]="18" aria-hidden="true"></svg>
          </a>
        </li>
        <li>
          <a app-settings-row routerLink="/settings/categories" label="Categories" hint="Group your spending and income">
            <svg icon lucideTags [size]="24" aria-hidden="true"></svg>
            <svg trailing lucideChevronRight [size]="18" aria-hidden="true"></svg>
          </a>
        </li>
        <li>
          <a app-settings-row routerLink="/settings/recurring" label="Recurring" hint="Bills and income that repeat">
            <svg icon lucideRepeat [size]="24" aria-hidden="true"></svg>
            <svg trailing lucideChevronRight [size]="18" aria-hidden="true"></svg>
          </a>
        </li>
        <li>
          <a app-settings-row routerLink="/settings/rules" label="Rules" hint="Auto-categorise by merchant">
            <svg icon lucideFunnel [size]="24" aria-hidden="true"></svg>
            <svg trailing lucideChevronRight [size]="18" aria-hidden="true"></svg>
          </a>
        </li>
      </ul>

      <h2 class="group-title">General</h2>
      <ul class="rows">
        <li>
          <a app-settings-row routerLink="/settings/export" label="Export" hint="Save your transactions as a CSV or Excel file">
            <svg icon lucideDownload [size]="24" aria-hidden="true"></svg>
            <svg trailing lucideChevronRight [size]="18" aria-hidden="true"></svg>
          </a>
        </li>
        <li>
          <a app-settings-row routerLink="/settings/backup" label="Backup" hint="Save an encrypted copy of your data">
            <svg icon lucideDatabaseBackup [size]="24" aria-hidden="true"></svg>
            <svg trailing lucideChevronRight [size]="18" aria-hidden="true"></svg>
          </a>
        </li>
        <li>
          <div app-settings-row label="Base currency" hint="Foreign-currency transactions convert to this for reporting">
            <svg icon lucideCoins [size]="24" aria-hidden="true"></svg>
            <app-select-field
              trailing
              ariaLabel="Base currency"
              [options]="currencyOptions"
              [value]="baseCurrency()"
              (valueChange)="onBaseCurrencyChange($event)"
            />
          </div>
        </li>
      </ul>

      <app-privacy-note />

      <h2 class="group-title">Security</h2>
      <ul class="rows">
        <li>
          <div app-settings-row label="Auto-lock" hint="Locks after this idle time; backgrounding always locks">
            <svg icon lucideLock [size]="24" aria-hidden="true"></svg>
            <app-select-field
              trailing
              ariaLabel="Lock timeout"
              [options]="timeoutOptions"
              [value]="lock.idleTimeoutSecs()"
              (valueChange)="onTimeoutChange($event)"
            />
          </div>
        </li>
      </ul>
    </section>
  `,
  styles: `
    .feature-page {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }
    .group-title {
      margin: 0 0 calc(-1 * var(--space-2));
      color: var(--c-text-muted);
      font-size: var(--t-section);
      font-weight: var(--fw-medium);
    }
    .rows {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
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
