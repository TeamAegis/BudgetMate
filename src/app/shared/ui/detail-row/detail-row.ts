import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A read-only "label + value" row for detail pages (transaction-detail, goal-detail). Attribute
 * selector on a real `<div>` so a run of them reads as a plain definition-style block (mirrors the
 * ListRow attribute-selector convention). Simple values go through `[value]`; rich values (a
 * coloured money span, a split list) go in the default content slot. Dumb/presentational, tokens
 * only - the feature owns the data.
 *
 *   <div app-detail-row label="Account" [value]="accountName(t.accountId)"></div>
 *   <div app-detail-row label="Amount"><span class="amount">...</span></div>
 */
@Component({
  // Attribute selector on a real <div> so detail rows compose in a plain block (see ListRow).
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'div[app-detail-row]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="dr-label">{{ label() }}</span>
    <span class="dr-value">
      @if (value() !== null) {
        {{ value() }}
      }
      <ng-content></ng-content>
    </span>
  `,
  styleUrl: './detail-row.scss',
})
export class DetailRow {
  readonly label = input.required<string>();
  readonly value = input<string | null>(null);
}
