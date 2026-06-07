import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Spinner } from '../spinner/spinner';

/**
 * Pill button — the single source of the `.btn` styling that was previously copy-pasted across
 * features. Dumb/presentational: the consumer keeps the `(click)` handler on `<app-button>` (the
 * native click bubbles from the inner button) and owns any Lucide icon, projected into the
 * `[icon]` slot. Text goes in the default slot.
 *
 *   <app-button variant="primary" (click)="save()" [loading]="busy()">
 *     <svg icon lucidePlus [size]="18"></svg>
 *     <span>Add</span>
 *   </app-button>
 *
 * `loading` shows an inline spinner (replacing the icon slot) and disables the button so the
 * action can't be double-fired while in flight.
 */
@Component({
  selector: 'app-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Spinner],
  host: { '[class.block]': 'block()' },
  template: `
    <button
      [type]="type()"
      class="btn"
      [class.primary]="variant() === 'primary'"
      [class.ghost]="variant() === 'ghost'"
      [disabled]="isDisabled()"
      [attr.aria-busy]="loading() || null"
    >
      @if (loading()) {
        <app-spinner [size]="18" />
      } @else {
        <ng-content select="[icon]"></ng-content>
      }
      <ng-content></ng-content>
    </button>
  `,
  styleUrl: './button.scss',
})
export class Button {
  readonly variant = input<'primary' | 'ghost'>('primary');
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false);
  /** In-flight action: shows a spinner and disables the button. */
  readonly loading = input(false);
  /** Full-width: host becomes block and the button fills it (e.g. the lock-screen actions). */
  readonly block = input(false);

  protected readonly isDisabled = computed(() => this.disabled() || this.loading());
}
