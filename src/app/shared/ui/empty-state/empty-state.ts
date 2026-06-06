import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Button } from '../button/button';

/**
 * Centred empty state: a message and an optional primary CTA (design-system.md §7). The host owns
 * no data — it emits `action` when the CTA is pressed.
 *
 *   <app-empty-state message="No accounts yet." cta="Add your first account" (action)="create()" />
 */
@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  template: `
    <div class="empty">
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
  readonly cta = input<string | null>(null);
  readonly action = output<void>();
}
