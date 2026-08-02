import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideMenu, LucideSettings, LucideTrash2, LucideArchive } from '@lucide/angular';
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
  imports: [RouterLink, LucideArrowLeft, LucideMenu, LucideSettings, LucideTrash2, LucideArchive],
  template: `
    <header class="app-header">
      @if (hasBack()) {
        <button type="button" class="back" (click)="back.emit()" aria-label="Back" title="Back">
          <svg lucideArrowLeft [size]="24"></svg>
        </button>
      } @else if (showMenu()) {
        <!-- Opens the nav drawer (ADR 0013). Only on top-level tabs: a pushed screen's leading slot
             belongs to Back, which must never be displaced by a menu. -->
        <button
          type="button"
          class="menu"
          (click)="menu.emit()"
          aria-label="Go to"
          title="Go to"
          aria-haspopup="dialog"
          [attr.aria-expanded]="menuOpen()"
        >
          <svg lucideMenu [size]="24"></svg>
        </button>
      }
      <span class="brand" [class.titled]="!isBrand()">{{ title() }}</span>
      @if (action(); as act) {
        @if (act.icon) {
          <button
            type="button"
            class="header-action-icon"
            (click)="act.run()"
            [attr.aria-label]="act.label"
            [attr.title]="act.label"
            [disabled]="act.loading || act.disabled || null"
          >
            @switch (act.icon) {
              @case ('trash') { <svg lucideTrash2 [size]="24"></svg> }
              @case ('archive') { <svg lucideArchive [size]="24"></svg> }
            }
          </button>
        } @else {
          <button
            type="button"
            class="header-action"
            (click)="act.run()"
            [disabled]="act.loading || act.disabled || null"
            [attr.aria-busy]="act.loading || null"
          >
            {{ act.label }}
          </button>
        }
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
  /** Show the leading nav-drawer button. Ignored when `hasBack()` - Back owns that slot. */
  readonly showMenu = input(false);
  /** Whether the drawer is currently open, for the button's `aria-expanded`. */
  readonly menuOpen = input(false);
  readonly back = output<void>();
  /** The nav-drawer button was activated; the shell opens the drawer. */
  readonly menu = output<void>();
}
