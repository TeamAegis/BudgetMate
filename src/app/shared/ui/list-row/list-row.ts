import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A card-styled list row: leading name + optional meta line, an optional trailing amount, and an
 * actions cluster. Both the amount and the actions are projected so the consumer keeps the
 * MoneyPipe and any Lucide/IconButton imports:
 *
 *   <li app-list-row [name]="a.name" [meta]="a.accountType + ' · ' + a.currency">
 *     <span lead class="avatar">W</span>            <!-- optional leading glyph/monogram -->
 *     <span amount class="amount numeric">{{ { amountMinor: a.openingBalanceMinor, currency: a.currency } | money }}</span>
 *     <app-icon-button actions ariaLabel="Edit" (click)="edit(a)"><svg lucidePencil [size]="18"></svg></app-icon-button>
 *   </li>
 *
 * Attribute selector on a real `<li>` so it stays valid inside `<ul class="rows">`. The optional
 * `[lead]` slot holds a leading avatar/monogram (the feature owns its styling).
 */
@Component({
  // Attribute selector on a real <li> so the row stays a valid child of <ul class="rows">.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'li[app-list-row]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row-main">
      <span class="name">{{ name() }}</span>
      @if (meta(); as m) {
        <span class="meta">{{ m }}</span>
      }
    </div>
    <ng-content select="[amount]"></ng-content>
    <div class="row-actions">
      <ng-content select="[actions]"></ng-content>
    </div>
  `,
  styleUrl: './list-row.scss',
})
export class ListRow {
  readonly name = input.required<string>();
  readonly meta = input<string | null>(null);
}
