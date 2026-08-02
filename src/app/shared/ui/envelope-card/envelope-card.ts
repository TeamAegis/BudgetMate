import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideTriangleAlert } from '@lucide/angular';
import { MoneyPipe } from '../../pipes/money.pipe';
import type { EnvelopeStatus } from '../../../core/models';

/**
 * Envelope-budget card (FR-3.1, design-system §7 EnvelopeCard). Category name + cap, an 8px
 * (`--progress-track-h`) pill track, and the spent/remaining amounts. Three states, driven by the
 * Rust-computed `status` (never re-derived here):
 * - **under** (`--c-positive` fill) - plain "Rs X left" line, no icon (nothing to flag).
 * - **approaching** (`--c-warning` fill) - icon + "Rs X left", the cap is close.
 * - **over** (`--c-danger` fill) - icon + "Rs Y over".
 *
 * Approaching/over are NEVER signalled by colour alone - they always pair the fill with a
 * `lucideTriangleAlert` icon + a plain-language label (a11y hard rule, design.md). Over-budget is
 * phrased as information ("Rs Y over"), not punitively - the fill itself is also capped at 100%
 * width even when over; the label/icon (and the ">100%" percent figure) carry the "how much over"
 * detail instead of an overflowing bar. Dumb/presentational: all money math and the status
 * classification happen in Rust; this component only formats (money pipe) and clamps display
 * geometry (a guard, not money math - mirrors GoalProgressRow's `percent`).
 *
 * The whole card is a button emitting `open`; the feature navigates to the budget's edit page.
 */
@Component({
  selector: 'app-envelope-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyPipe, LucideTriangleAlert],
  template: `
    <button
      type="button"
      class="envelope-card"
      [class]="status()"
      (click)="open.emit()"
      [attr.aria-label]="ariaLabel()"
    >
      <div class="head">
        <span class="name">{{ categoryName() }}</span>
        <span class="tag" [class]="status()">{{ statusTag() }}</span>
      </div>

      <div class="track">
        <div class="fill" [class]="status()" [style.width.%]="ready() ? barWidth() : 0"></div>
      </div>

      <div class="amounts">
        <span class="spent numeric">{{ { amountMinor: spentMinor(), currency: currency() } | money }}</span>
        <span class="sep">of</span>
        <span class="cap numeric">{{ { amountMinor: capMinor(), currency: currency() } | money }}</span>
        <span class="percent numeric">{{ percentLabel() }}%</span>
      </div>

      <div class="status-line" [class]="status()">
        @if (status() !== 'under') {
          <svg lucideTriangleAlert [size]="16" aria-hidden="true"></svg>
        }
        <span class="numeric">{{ { amountMinor: remainingAbsMinor(), currency: currency() } | money }}</span>
        <span>{{ statusWord() }}</span>
      </div>
    </button>
  `,
  styleUrl: './envelope-card.scss',
})
export class EnvelopeCard {
  readonly categoryName = input.required<string>();
  readonly capMinor = input.required<number>();
  readonly spentMinor = input.required<number>();
  readonly remainingMinor = input.required<number>();
  readonly currency = input.required<string>();
  readonly status = input.required<EnvelopeStatus>();
  /** Emitted when the card is activated; the feature opens the budget's edit page. */
  readonly open = output<void>();

  /** Flips true after first render so the fill transitions from 0 -> width (reduced-motion safe). */
  protected readonly ready = signal(false);

  /** Spend as a percentage of the cap, rounded for the label. Not clamped - >100% is meaningful
   *  ("125%") and is the percentage counterpart to the "Rs Y over" label. Display guard only. */
  protected readonly percentLabel = computed(() => {
    const cap = this.capMinor();
    if (cap <= 0) return 0;
    return Math.round((this.spentMinor() / cap) * 100);
  });

  /** Fill width, clamped to 0-100 so an over-budget envelope never overflows the track visually
   *  (design.md: the label/icon carry "how much over", not the bar). Display guard, not money math. */
  protected readonly barWidth = computed(() => {
    const cap = this.capMinor();
    if (cap <= 0) return 0;
    return Math.min(100, Math.max(0, (this.spentMinor() / cap) * 100));
  });

  /** "left" (under/approaching) or "over" (over) - paired with the money pipe in the template to
   *  read "Rs X left" / "Rs Y over", phrased as information rather than failure
   *  (design.md "over-budget is gentle"). */
  protected statusWord(): string {
    return this.status() === 'over' ? 'over' : 'left';
  }

  /** The glanceable status tag ("on track" / "getting close" / "over") shown next to the category
   *  name - a second, non-colour-only cue alongside the fill and status line (design.md a11y). */
  protected statusTag(): string {
    switch (this.status()) {
      case 'over':
        return 'over';
      case 'approaching':
        return 'getting close';
      default:
        return 'on track';
    }
  }

  protected ariaLabel(): string {
    const statusText =
      this.status() === 'over'
        ? 'over budget'
        : this.status() === 'approaching'
          ? 'approaching budget'
          : 'on track';
    return `${this.categoryName()}, ${this.percentLabel()} percent spent, ${statusText}`;
  }

  /** Remaining/over amount for the status line, always non-negative for display (the sign already
   *  distinguishes "left" vs "over" via the word, not a negative number - a display guard, not
   *  money math: no scaling/rounding, just `Math.abs`). */
  protected remainingAbsMinor(): number {
    return Math.abs(this.remainingMinor());
  }

  constructor() {
    afterNextRender(() => this.ready.set(true));
  }
}
