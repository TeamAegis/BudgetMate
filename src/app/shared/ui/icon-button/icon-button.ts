import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Icon-only button with a guaranteed 44px tap target and a required accessible name. The icon
 * itself is projected so the consumer owns the Lucide import:
 *
 *   <app-icon-button ariaLabel="Edit" (click)="edit()" [disabled]="busy()">
 *     <svg lucidePencil [size]="18"></svg>
 *   </app-icon-button>
 */
@Component({
  selector: 'app-icon-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="icon-btn" [disabled]="disabled()" [attr.aria-label]="ariaLabel()">
      <ng-content></ng-content>
    </button>
  `,
  styleUrl: './icon-button.scss',
})
export class IconButton {
  readonly ariaLabel = input.required<string>();
  readonly disabled = input(false);
}
