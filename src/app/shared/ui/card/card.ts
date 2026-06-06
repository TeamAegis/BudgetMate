import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Surface container — the `.card` background/border/radius/padding that was duplicated across
 * features. Styling lives on `:host` so no wrapper element is added; project any content.
 */
@Component({
  selector: 'app-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content></ng-content>`,
  styleUrl: './card.scss',
})
export class Card {}
