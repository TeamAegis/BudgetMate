import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MoneyPipe } from '../../pipes/money.pipe';

/**
 * The Allowances-screen summary strip (FR-3.4): three compact stats - total savings, how much of it
 * is set aside across all active allowances, and what's still free to spend. All three figures are
 * computed fresh in Rust (`AllowanceSummary` - see `docs/allowances.md` §4) and only formatted here
 * (the shared money pipe) - no money math in TS. Deliberately lighter-weight than `BalanceCard` (the
 * Home hero): this is a row of three small stats, not a single large figure.
 *
 * When more has been set aside across allowances than is actually free (`availableMinor < 0` -
 * over-committed, e.g. after lowering the base currency's balance), "Free to spend" replaces the
 * bare figure with a gentle plain-language sentence instead of a bare negative amount - mirrors
 * `Home.readyToSpendLine()`'s over-committed phrasing for goals.
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
  providers: [MoneyPipe],
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
        <span class="stat-figure" [class.over-committed]="availableMinor() < 0">{{
          freeToSpendLine()
        }}</span>
      </div>
    </div>
  `,
  styleUrl: './allowance-summary-strip.scss',
})
export class AllowanceSummaryStrip {
  private readonly money = inject(MoneyPipe);

  readonly totalMinor = input.required<number>();
  readonly reservedMinor = input.required<number>();
  readonly availableMinor = input.required<number>();
  readonly currency = input('MUR');

  /** The positive case is the plain money-pipe figure, unchanged. The over-committed case (negative
   *  `availableMinor`) is a full plain-language sentence using the magnitude (never a bare "-Rs X"),
   *  matching Home's gentle framing for an over-committed free balance. */
  protected readonly freeToSpendLine = computed<string>(() => {
    const available = this.availableMinor();
    const currency = this.currency();
    if (available < 0) {
      const over = this.money.transform({ amountMinor: Math.abs(available), currency });
      return `${over} more is set aside than is free right now.`;
    }
    return this.money.transform({ amountMinor: available, currency });
  });
}
