import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideCircleAlert, LucideTriangleAlert, LucideCircleCheck, LucideInfo } from '@lucide/angular';

export type BannerTone = 'error' | 'warning' | 'success' | 'info';

/**
 * Inline status banner. `role="alert"` is baked in so consumers can't forget it. The message is
 * projected; a tone-driven Lucide icon leads it so meaning is never carried by colour alone
 * (design-system.md §2.3, ui-ux-principles §2.4). Tones map to the semantic tokens.
 *
 *   @if (error(); as err) { <app-banner>{{ err }}</app-banner> }                // error (default)
 *   <app-banner tone="success">Backup saved.</app-banner>
 */
@Component({
  selector: 'app-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideCircleAlert, LucideTriangleAlert, LucideCircleCheck, LucideInfo],
  template: `
    <p class="banner" [class]="tone()" role="alert">
      @switch (tone()) {
        @case ('success') {
          <svg lucideCircleCheck class="icon" [size]="20" aria-hidden="true"></svg>
        }
        @case ('warning') {
          <svg lucideTriangleAlert class="icon" [size]="20" aria-hidden="true"></svg>
        }
        @case ('info') {
          <svg lucideInfo class="icon" [size]="20" aria-hidden="true"></svg>
        }
        @default {
          <svg lucideCircleAlert class="icon" [size]="20" aria-hidden="true"></svg>
        }
      }
      <span class="msg"><ng-content></ng-content></span>
    </p>
  `,
  styleUrl: './banner.scss',
})
export class Banner {
  readonly tone = input<BannerTone>('error');
}
