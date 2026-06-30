import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MoneyPipe } from '../../pipes/money.pipe';

/**
 * The Home hero summary card (signature coral-40 fill + offset pink shadow). Shows a label, an
 * optional big money figure (minor units from Rust, formatted by the money pipe - never TS math),
 * and an optional caption. When no `amountMinor` is supplied it renders label + caption only, so it
 * works as an honest first-run / "summary lands later" hero until the Rust dashboard query exists.
 *
 *   <app-balance-card label="This month" caption="Add expenses to see your summary here." />
 *   <app-balance-card label="This month" [amountMinor]="spentMinor()" [currency]="base()" caption="…left" />
 */
@Component({
  selector: 'app-balance-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyPipe],
  template: `
    <span class="bc-label">{{ label() }}</span>
    @if (amountMinor() !== null) {
      <span class="bc-figure numeric">{{
        { amountMinor: amountMinor()!, currency: currency() } | money
      }}</span>
    }
    @if (caption(); as c) {
      <span class="bc-caption">{{ c }}</span>
    }
  `,
  styleUrl: './balance-card.scss',
})
export class BalanceCard {
  readonly label = input.required<string>();
  /** Minor units (from Rust). Null renders the label + caption only (no figure). */
  readonly amountMinor = input<number | null>(null);
  readonly currency = input('MUR');
  readonly caption = input<string | null>(null);
}
