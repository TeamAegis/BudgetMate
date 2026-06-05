import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Pill button — the single source of the `.btn` styling that was previously copy-pasted across
 * features. Dumb/presentational: the consumer keeps the `(click)` handler on `<app-button>` (the
 * native click bubbles from the inner button) and owns any Lucide icon, projected into the
 * `[icon]` slot. Text goes in the default slot.
 *
 *   <app-button variant="primary" (click)="save()" [disabled]="busy()">
 *     <svg icon lucidePlus [size]="18"></svg>
 *     <span>Add</span>
 *   </app-button>
 */
@Component({
  selector: 'app-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.block]': 'block()' },
  template: `
    <button
      [type]="type()"
      class="btn"
      [class.primary]="variant() === 'primary'"
      [class.ghost]="variant() === 'ghost'"
      [disabled]="disabled()"
    >
      <ng-content select="[icon]"></ng-content>
      <ng-content></ng-content>
    </button>
  `,
  styleUrl: './button.scss',
})
export class Button {
  readonly variant = input<'primary' | 'ghost'>('primary');
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false);
  /** Full-width: host becomes block and the button fills it (e.g. the lock-screen actions). */
  readonly block = input(false);
}
