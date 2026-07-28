import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MoneyPipe } from '../../pipes/money.pipe';

/**
 * The Allowances-screen summary strip (FR-3.4): three compact stats - total savings, how much of it
 * is set aside across all active allowances, and what's still free to spend. All three figures are
 * computed fresh in Rust (`AllowanceSummary` - see `docs/allowances.md` §4) and only formatted here
 * (the shared money pipe) - no money math in TS. Deliberately lighter-weight than `BalanceCard` (the
 * Home hero): this is a row of three small stats, not a single large figure.
 *
 *   <app-allowance-summary-strip
 *     [totalMinor]="summary().totalMinor"
 *     [reservedMinor]="summary().reservedMinor"
 *     [availableMinor]="summary().availableMinor"
 *     [currency]="summary().baseCurrency" />
 */
@Component({
  selector: 'app-allowance-summary-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyPipe],
  template: `
    <div class="strip">
      <div class="stat">
        <span class="stat-label">Total savings</span>
        <span class="stat-figure">{{ { amountMinor: totalMinor(), currency: currency() } | money }}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Set aside</span>
        <span class="stat-figure">{{ { amountMinor: reservedMinor(), currency: currency() } | money }}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Free to spend</span>
        <span class="stat-figure">{{ { amountMinor: availableMinor(), currency: currency() } | money }}</span>
      </div>
    </div>
  `,
  styleUrl: './allowance-summary-strip.scss',
})
export class AllowanceSummaryStrip {
  readonly totalMinor = input.required<number>();
  readonly reservedMinor = input.required<number>();
  readonly availableMinor = input.required<number>();
  readonly currency = input('MUR');
}
