import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideSettings } from '@lucide/angular';
import type { HeaderAction } from '../../../core/layout/header-action.service';

/**
 * The app header (design-system.md §7): a leading back affordance on pushed screens, the
 * title/brand wordmark, and a trailing slot that holds either a primary page action (e.g. the
 * **Save** of a full-screen form page, set via HeaderActionService) or, on top-level tabs, the
 * settings link. Fully presentational - the root App owns all routing state and the back
 * behaviour, passed in via inputs/`(back)`. It is the only place a screen name appears.
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
      @if (action(); as act) {
        <button
          type="button"
          class="header-action"
          (click)="act.run()"
          [disabled]="act.loading || act.disabled || null"
          [attr.aria-busy]="act.loading || null"
        >
          {{ act.label }}
        </button>
      } @else if (!hasBack()) {
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
  /** Trailing primary action (e.g. Save) for full-screen task pages; null on tabs (settings shows). */
  readonly action = input<HeaderAction | null>(null);
  readonly back = output<void>();
}
