import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Indeterminate loading spinner - inline SVG, inherits `currentColor`, no remote assets (NFR-P4).
 * Used for in-place busy feedback (button saving, processing). For data-load placeholders prefer
 * `app-skeleton`. The spin keyframe is disabled under prefers-reduced-motion (see _animations.scss).
 *
 *   <app-spinner [size]="18" label="Saving" />
 */
@Component({
  selector: 'app-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', '[attr.aria-label]': 'label()' },
  template: `
    <svg
      class="anim-spin"
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.viewBox]="viewBox()"
      fill="none"
      aria-hidden="true"
    >
      <circle
        [attr.cx]="center()"
        [attr.cy]="center()"
        [attr.r]="radius()"
        stroke="currentColor"
        [attr.stroke-width]="stroke()"
        stroke-linecap="round"
        stroke-dasharray="60 100"
        opacity="0.9"
      />
    </svg>
  `,
  styleUrl: './spinner.scss',
})
export class Spinner {
  /** Diameter in px. */
  readonly size = input(24);
  /** Stroke width in px. */
  readonly stroke = input(2.5);
  /** Accessible name announced to assistive tech. */
  readonly label = input('Loading');

  protected readonly center = computed(() => this.size() / 2);
  protected readonly radius = computed(() => (this.size() - this.stroke()) / 2);
  protected readonly viewBox = computed(() => `0 0 ${this.size()} ${this.size()}`);
}
