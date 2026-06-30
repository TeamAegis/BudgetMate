import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A labelled quick-action tile (Home grid). The whole tile is one accessible link; the glyph is
 * projected so the consumer keeps its Lucide import. Always labelled (never icon-only - low-literacy
 * rule). Attribute selector on an `<a>` so routing/`routerLink` lives on the consumer:
 *
 *   <a app-action-tile routerLink="/expenses/new" label="Add expense">
 *     <svg icon lucidePlus [size]="24" aria-hidden="true"></svg>
 *   </a>
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'a[app-action-tile]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="tile-glyph"><ng-content select="[icon]"></ng-content></span>
    <span class="tile-label">{{ label() }}</span>
  `,
  styleUrl: './action-tile.scss',
})
export class ActionTile {
  readonly label = input.required<string>();
}
