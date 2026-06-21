import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Button } from '../button/button';

/**
 * Centred empty state: an optional illustration, a message, and an optional primary CTA
 * (design-system.md §7). The host owns no data - it emits `action` when the CTA is pressed.
 * Illustrations are bundled locally (no CDN, NFR-P4) under `assets/illustrations/`; they are
 * decorative (`aria-hidden`) since the message conveys the meaning.
 *
 *   <app-empty-state
 *     image="assets/illustrations/get-started.svg"
 *     message="No accounts yet." cta="Add your first account" (action)="create()" />
 */
@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  host: { '[class.fill]': 'fill()' },
  template: `
    <div class="empty">
      @if (image(); as src) {
        <img [src]="src" alt="" aria-hidden="true" class="illustration" />
      }
      <p>{{ message() }}</p>
      @if (cta(); as label) {
        <app-button variant="primary" (click)="action.emit()">{{ label }}</app-button>
      }
    </div>
  `,
  styleUrl: './empty-state.scss',
})
export class EmptyState {
  readonly message = input.required<string>();
  /** Path to a bundled illustration (e.g. `assets/illustrations/get-started.svg`). */
  readonly image = input<string | null>(null);
  readonly cta = input<string | null>(null);
  /** Grow to fill the parent and centre vertically (for screens that are only an empty state). */
  readonly fill = input(false);
  readonly action = output<void>();
}
