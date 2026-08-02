import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideWallet,
  LucideArrowLeftRight,
  LucideTags,
  LucideChevronRight,
  LucideLock,
  LucideRepeat,
  LucideCoins,
  LucideFunnel,
  LucideFileUp,
  LucidePiggyBank,
  LucideHandCoins,
  LucideDownload,
  LucideDatabaseBackup,
  LucideCopy,
} from '@lucide/angular';
import { LockService } from '../../core/lock/lock.service';
import { MONEY_DESTINATIONS, GENERAL_DESTINATIONS } from '../../core/layout/nav-destinations';
import { getSettings, setBaseCurrency, setDedupWindow, isTauri } from '../../core/bridge';
import { SelectField, type SelectOption } from '../../shared/ui/select-field/select-field';
import { SettingsRow } from '../../shared/ui/settings-row/settings-row';
import { PrivacyNote } from '../../shared/ui/privacy-note/privacy-note';

@Component({
  selector: 'app-settings',
  imports: [
    RouterLink,
    LucideWallet,
    LucideArrowLeftRight,
    LucideTags,
    LucideChevronRight,
    LucideLock,
    LucideRepeat,
    LucideCoins,
    LucideFunnel,
    LucideFileUp,
    LucidePiggyBank,
    LucideHandCoins,
    LucideDownload,
    LucideDatabaseBackup,
    LucideCopy,
    SelectField,
    SettingsRow,
    PrivacyNote,
  ],
  template: `
    <section class="feature-page">
      <h2 class="group-title">Your money</h2>
      <ul class="rows">
        <!-- Rendered from core/layout/nav-destinations, the SAME list the nav drawer uses, so a new
             destination can never appear in one surface and be forgotten in the other. -->
        @for (item of moneyDestinations; track item.id) {
          <li>
            <a app-settings-row [routerLink]="item.route" [label]="item.label" [hint]="item.hint">
              <span icon class="srow-glyph">
                @switch (item.icon) {
                  @case ('allowances') { <svg lucideHandCoins [size]="24" aria-hidden="true"></svg> }
                  @case ('budgets') { <svg lucidePiggyBank [size]="24" aria-hidden="true"></svg> }
                  @case ('accounts') { <svg lucideWallet [size]="24" aria-hidden="true"></svg> }
                  @case ('transfer') { <svg lucideArrowLeftRight [size]="24" aria-hidden="true"></svg> }
                  @case ('categories') { <svg lucideTags [size]="24" aria-hidden="true"></svg> }
                  @case ('recurring') { <svg lucideRepeat [size]="24" aria-hidden="true"></svg> }
                  @case ('rules') { <svg lucideFunnel [size]="24" aria-hidden="true"></svg> }
                  @case ('import') { <svg lucideFileUp [size]="24" aria-hidden="true"></svg> }
                }
              </span>
              <svg trailing lucideChevronRight [size]="18" aria-hidden="true"></svg>
            </a>
          </li>
        }
        <li>
          <div
            app-settings-row
            label="Duplicate detection"
            hint="When importing, mark transactions this many days apart at the same amount so you can check them before they're added"
          >
            <svg icon lucideCopy [size]="24" aria-hidden="true"></svg>
            <app-select-field
              trailing
              ariaLabel="Duplicate detection window"
              [options]="dedupWindowOptions"
              [value]="dedupWindowDays()"
              (valueChange)="onDedupWindowChange($event)"
            />
          </div>
        </li>
      </ul>

      <h2 class="group-title">General</h2>
      <ul class="rows">
        <!-- Same shared list. The Settings destination itself is deliberately NOT included here:
             Settings must not link to itself (that row exists for the drawer only). -->
        @for (item of generalDestinations; track item.id) {
          <li>
            <a app-settings-row [routerLink]="item.route" [label]="item.label" [hint]="item.hint">
              <span icon class="srow-glyph">
                @switch (item.icon) {
                  @case ('export') { <svg lucideDownload [size]="24" aria-hidden="true"></svg> }
                  @case ('backup') { <svg lucideDatabaseBackup [size]="24" aria-hidden="true"></svg> }
                }
              </span>
              <svg trailing lucideChevronRight [size]="18" aria-hidden="true"></svg>
            </a>
          </li>
        }
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
    /* The projected icon slot is a span (it wraps the @switch), so it needs to centre like the bare
       <svg icon> it replaced; the colour comes from SettingsRow's own .srow-icon wrapper. */
    .srow-glyph {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
  `,
})
export class Settings implements OnInit {
  protected readonly lock = inject(LockService);

  /** The navigation rows, shared with the nav drawer (ADR 0013) - see core/layout/nav-destinations. */
  protected readonly moneyDestinations = MONEY_DESTINATIONS;
  protected readonly generalDestinations = GENERAL_DESTINATIONS;

  protected readonly baseCurrency = signal<string>('MUR');
  protected readonly dedupWindowDays = signal<number>(3);

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

  protected readonly dedupWindowOptions: SelectOption[] = [
    { value: 0, label: 'Same day only' },
    { value: 1, label: '1 day' },
    { value: 3, label: '3 days' },
    { value: 7, label: '1 week' },
    { value: 14, label: '2 weeks' },
  ];

  async ngOnInit(): Promise<void> {
    if (!isTauri()) return;
    try {
      const settings = await getSettings();
      this.baseCurrency.set(settings.baseCurrency);
      this.dedupWindowDays.set(settings.dedupWindowDays);
    } catch {
      // Non-fatal: keep the defaults; the pickers still work once the core is reachable.
    }
  }

  protected onTimeoutChange(value: number | string): void {
    void this.lock.updateIdleTimeout(Number(value));
  }

  protected async onBaseCurrencyChange(value: number | string): Promise<void> {
    const settings = await setBaseCurrency(String(value));
    this.baseCurrency.set(settings.baseCurrency);
  }

  protected async onDedupWindowChange(value: number | string): Promise<void> {
    const settings = await setDedupWindow(Number(value));
    this.dedupWindowDays.set(settings.dedupWindowDays);
  }
}
