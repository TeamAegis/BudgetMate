import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideSettings } from '@lucide/angular';

/**
 * The app header (design-system.md §7): a leading back affordance on pushed screens, the
 * title/brand wordmark, and a trailing settings link on the top-level tabs. Fully presentational
 * - the root App owns all routing state and the back behaviour, passed in via inputs/`(back)`.
 * It is the only place a screen name appears (no in-body titles).
 */
@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideArrowLeft, LucideSettings],
  template: `
    <header class="app-header">
      @if (hasBack()) {
        <button type="button" class="back" (click)="back.emit()" aria-label="Back" title="Back">
          <svg lucideArrowLeft [size]="24"></svg>
        </button>
      }
      <span class="brand" [class.titled]="!isBrand()">{{ title() }}</span>
      @if (!hasBack()) {
        <a class="settings-link" routerLink="/settings" aria-label="Settings" title="Settings">
          <svg lucideSettings [size]="24"></svg>
        </a>
      }
    </header>
  `,
  styleUrl: './app-header.scss',
})
export class AppHeader {
  readonly title = input.required<string>();
  readonly isBrand = input.required<boolean>();
  readonly hasBack = input.required<boolean>();
  readonly back = output<void>();
}
