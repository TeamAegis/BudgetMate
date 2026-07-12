import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LucideCircleAlert, LucideTriangleAlert, LucideCircleCheck, LucideInfo } from '@lucide/angular';

export type BannerTone = 'error' | 'warning' | 'success' | 'info';

/**
 * Inline status banner. The live-region role/politeness is derived from tone so consumers can't
 * forget it: `error` is urgent and uses `role="alert"` (assertive, WCAG 2.2 SC 4.1.3); `warning`,
 * `success`, and `info` are advisory and use `role="status"` with `aria-live="polite"` so they
 * don't interrupt like an alert. The message is projected; a tone-driven Lucide icon leads it so
 * meaning is never carried by colour alone (design-system.md §2.3, ui-ux-principles §2.4). Tones
 * map to the semantic tokens.
 *
 *   @if (error(); as err) { <app-banner>{{ err }}</app-banner> }                // error (default)
 *   <app-banner tone="success">Backup saved.</app-banner>
 */
@Component({
  selector: 'app-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideCircleAlert, LucideTriangleAlert, LucideCircleCheck, LucideInfo],
  template: `
    <p
      class="banner"
      [class]="tone()"
      [attr.role]="isAlert() ? 'alert' : 'status'"
      [attr.aria-live]="isAlert() ? null : 'polite'"
    >
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

  /** Only `error` is urgent enough for an assertive alert; other tones are advisory/polite. */
  readonly isAlert = computed(() => this.tone() === 'error');
}
