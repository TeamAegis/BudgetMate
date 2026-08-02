import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideHandCoins, LucideTriangleAlert, LucideChevronRight } from '@lucide/angular';
import { MoneyPipe } from '../../pipes/money.pipe';

/**
 * The Home allowances summary card (FR-3.4): how much of this period's allowances has been spent,
 * as a card rather than the loose sentence Home used to carry under the hero.
 *
 * It answers one question - "how much of what I set aside have I used?" - with a figure, a progress
 * track, and a plain-language line, then hands off to the Allowances screen. Per docs/allowances.md
 * §16 the internal vocabulary (Reserved, imprest, top-up) never reaches the screen: this card says
 * "used", "set aside", and "left".
 *
 * The over-allowance state is GENTLE and informational (`ux-blueprint.md` §5): an icon + "Rs X over"
 * label, never colour alone, and the track fill is clamped to 100% rather than overflowing its own
 * geometry. Dumb/presentational - every figure (`usedMinor`, `targetTotalMinor`, `reservedMinor`) is
 * derived in Rust; this component formats (money pipe) and clamps display geometry only (a guard,
 * not money math - mirrors AllowanceRow / EnvelopeCard).
 *
 * The whole card is a button emitting `open`; the feature navigates to the allowances list.
 */
@Component({
  selector: 'app-allowance-summary-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyPipe, LucideHandCoins, LucideTriangleAlert, LucideChevronRight],
  template: `
    <button type="button" class="asc" (click)="open.emit()" [attr.aria-label]="ariaLabel()">
      <span class="asc-head">
        <svg lucideHandCoins [size]="24" class="asc-glyph" aria-hidden="true"></svg>
        <span class="asc-title">Allowances</span>
        <svg lucideChevronRight [size]="18" class="asc-chevron" aria-hidden="true"></svg>
      </span>

      <span class="asc-amounts">
        <span class="asc-used numeric">{{
          { amountMinor: usedMinor(), currency: currency() } | money
        }}</span>
        <span class="asc-of">used of</span>
        <span class="asc-target numeric">{{
          { amountMinor: targetTotalMinor(), currency: currency() } | money
        }}</span>
      </span>

      <span class="asc-track">
        <span class="asc-fill" [class.over]="overspent()" [style.width.%]="ready() ? barWidth() : 0"></span>
      </span>

      <span class="asc-status" [class.over]="overspent()">
        @if (overspent()) {
          <svg lucideTriangleAlert [size]="16" aria-hidden="true"></svg>
          <span>{{ { amountMinor: overAmountMinor(), currency: currency() } | money }} over what you set aside</span>
        } @else {
          <span>{{ { amountMinor: leftMinor(), currency: currency() } | money }} left across {{ countLabel() }}</span>
        }
      </span>
    </button>
  `,
  styleUrl: './allowance-summary-card.scss',
})
export class AllowanceSummaryCard {
  /** Spent against this period's allowances, derived in Rust. May exceed `targetTotalMinor`. */
  readonly usedMinor = input.required<number>();
  /** This period's total allowance (sum of active targets), derived in Rust. */
  readonly targetTotalMinor = input.required<number>();
  /** How many active allowances the figures cover, for the plain-language line. */
  readonly count = input.required<number>();
  readonly currency = input.required<string>();
  /** Emitted when the card is activated; the feature opens the allowances list. */
  readonly open = output<void>();

  /** Flips true after first render so the fill transitions from 0 -> width (reduced-motion safe). */
  protected readonly ready = signal(false);

  /** Spent past the total set aside. Rust allows `used > target`; that IS the over state. */
  protected readonly overspent = computed(() => this.usedMinor() > this.targetTotalMinor());

  /** Display-only differences of two Rust-derived figures (a formatter's subtraction, not money
   *  logic - the same guard AllowanceRow / EnvelopeCard use for their own labels). */
  protected readonly leftMinor = computed(() =>
    Math.max(0, this.targetTotalMinor() - this.usedMinor()),
  );
  protected readonly overAmountMinor = computed(() =>
    Math.max(0, this.usedMinor() - this.targetTotalMinor()),
  );

  /** Fill width, clamped to 0-100 (a display guard, not money math). */
  protected readonly barWidth = computed(() => {
    const target = this.targetTotalMinor();
    if (target <= 0) return 0;
    return Math.min(100, Math.max(0, (this.usedMinor() / target) * 100));
  });

  protected countLabel(): string {
    const n = this.count();
    return n === 1 ? '1 allowance' : `${n} allowances`;
  }

  protected ariaLabel(): string {
    const state = this.overspent() ? 'over what you set aside' : 'on track';
    return `Allowances, ${state}. Open allowances`;
  }

  constructor() {
    afterNextRender(() => this.ready.set(true));
  }
}
