import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Loading placeholder — pulsing token-coloured blocks shown while data loads, so a screen reveals
 * its shape progressively instead of a blank "Loading…" (design-system §6). Decorative: the host
 * carries `aria-hidden`/`aria-busy`, so screen readers skip the bones and announce the busy region.
 * The pulse is disabled under prefers-reduced-motion (see _animations.scss).
 *
 *   <app-skeleton variant="text" [lines]="3" />
 *   <app-skeleton variant="circle" [size]="40" />
 *   <app-skeleton variant="block" height="120px" />
 */
@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', 'aria-busy': 'true' },
  template: `
    @if (variant() === 'text') {
      @for (line of lineArray(); track $index) {
        <span
          class="bone anim-skeleton-pulse"
          [style.width]="$last && lineArray().length > 1 ? '60%' : width()"
        ></span>
      }
    } @else {
      <span
        class="bone anim-skeleton-pulse"
        [class.circle]="variant() === 'circle'"
        [style.width]="boxWidth()"
        [style.height]="boxHeight()"
      ></span>
    }
  `,
  styleUrl: './skeleton.scss',
})
export class Skeleton {
  readonly variant = input<'text' | 'block' | 'circle'>('text');
  /** Width for text lines / block (CSS length). Defaults to full width. */
  readonly width = input('100%');
  /** Height for block variant (CSS length). */
  readonly height = input('1rem');
  /** Diameter for circle / line-height for text (px). */
  readonly size = input(40);
  /** Number of text lines (text variant only). */
  readonly lines = input(1);

  protected readonly lineArray = computed(() => Array.from({ length: Math.max(1, this.lines()) }));
  protected readonly boxWidth = computed(() =>
    this.variant() === 'circle' ? `${this.size()}px` : this.width(),
  );
  protected readonly boxHeight = computed(() =>
    this.variant() === 'circle' ? `${this.size()}px` : this.height(),
  );
}
