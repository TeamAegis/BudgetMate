import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A settings list row: leading icon, label + optional hint, and a trailing slot (a chevron for a
 * navigation row, or a control for a value row). Attribute selector so the host can be an
 * `<a routerLink>` (navigation, one accessible target) or a `<div>` (control row):
 *
 *   <a app-settings-row routerLink="/settings/accounts" label="Accounts" hint="Cash, bank or card">
 *     <svg icon lucideWallet [size]="24" aria-hidden="true"></svg>
 *     <svg trailing lucideChevronRight [size]="18" aria-hidden="true"></svg>
 *   </a>
 *
 *   <div app-settings-row label="Base currency" hint="Reports add up in this">
 *     <svg icon lucideCoins [size]="24" aria-hidden="true"></svg>
 *     <app-select-field trailing ... />
 *   </div>
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: '[app-settings-row]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="srow-icon"><ng-content select="[icon]"></ng-content></span>
    <span class="srow-text">
      <span class="srow-label">{{ label() }}</span>
      @if (hint(); as h) {
        <span class="srow-hint">{{ h }}</span>
      }
    </span>
    <span class="srow-trailing"><ng-content select="[trailing]"></ng-content></span>
  `,
  styleUrl: './settings-row.scss',
})
export class SettingsRow {
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
}
