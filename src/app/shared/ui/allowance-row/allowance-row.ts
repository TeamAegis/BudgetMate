import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideTriangleAlert, LucidePause } from '@lucide/angular';
import { MoneyPipe } from '../../pipes/money.pipe';
import type { AllowanceKind, AllowancePeriod } from '../../../core/models';

/**
 * Savings-backed allowance row (FR-3.4, docs/allowances.md). Name + cadence badge, a pill track
 * (balance-of-target, mirrors EnvelopeCard's geometry), and a plain-language status line. Per
 * docs/allowances.md §16 the internal vocabulary (Reserved, imprest, top-up) never reaches the
 * screen - this row only ever says "free to spend", "set aside", or "tops back up to your
 * weekly/monthly amount". The **over-allowance** state is GENTLE and informational: an icon +
 * "Rs X over" label, never colour alone (`ux-blueprint.md` §5) - the fill itself is clamped to 0
 * width rather than showing a negative bar. **Paused** is likewise icon + label, not a colour
 * change alone. Dumb/presentational: all balances/flags (`overspent`, `underfunded`) are derived in
 * Rust; this component only formats (money pipe) and clamps display geometry (a guard, not money
 * math - mirrors EnvelopeCard/GoalProgressRow).
 *
 * The whole row is a button emitting `open`; the feature navigates to the allowance's edit page.
 */
@Component({
  selector: 'app-allowance-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyPipe, LucideTriangleAlert, LucidePause],
  template: `
    <button type="button" class="allowance-row" (click)="open.emit()" [attr.aria-label]="ariaLabel()">
      <div class="head">
        <span class="name" [class.paused]="!active()">{{ name() }}</span>
        <span class="cadence-badge">{{ cadenceLabel() }}</span>
      </div>

      <div class="track" [class.paused]="!active()">
        <div class="fill" [style.width.%]="ready() ? barWidth() : 0"></div>
      </div>

      <div class="amounts" [class.paused]="!active()">
        <span class="balance">{{ { amountMinor: balanceForDisplay(), currency: currency() } | money }}</span>
        <span class="sep">of</span>
        <span class="target">{{ { amountMinor: targetMinor(), currency: currency() } | money }}</span>
      </div>

      <div class="status-line" [class.over]="overspent()" [class.paused]="!active()">
        @if (overspent()) {
          <svg lucideTriangleAlert [size]="16" aria-hidden="true"></svg>
          <span>{{ { amountMinor: overspentAbsMinor(), currency: currency() } | money }} over</span>
        } @else if (!active()) {
          <svg lucidePause [size]="16" aria-hidden="true"></svg>
          <span>Paused - not set aside right now</span>
        } @else {
          <span>{{ statusCopy() }}</span>
        }
      </div>
    </button>
  `,
  styleUrl: './allowance-row.scss',
})
export class AllowanceRow {
  readonly name = input.required<string>();
  readonly targetMinor = input.required<number>();
  readonly balanceMinor = input.required<number>();
  readonly currency = input.required<string>();
  readonly kind = input.required<AllowanceKind>();
  readonly period = input<AllowancePeriod | null>(null);
  readonly active = input(true);
  /** Derived in Rust: `balanceMinor < 0`. */
  readonly overspent = input(false);
  /** Derived in Rust: active, recurring, and currently below target. */
  readonly underfunded = input(false);
  /** Emitted when the row is activated; the feature opens the allowance's edit page. */
  readonly open = output<void>();

  /** Flips true after first render so the fill transitions from 0 -> width (reduced-motion safe). */
  protected readonly ready = signal(false);

  /** Balance clamped to 0 for the "of target" line - the over-envelope amount is called out
   *  separately by the status line's "Rs X over", so the amounts line never shows a negative
   *  figure (a display guard, not money math). */
  protected readonly balanceForDisplay = computed(() => Math.max(0, this.balanceMinor()));

  /** Fill width, clamped to 0-100 (a display guard, not money math - mirrors EnvelopeCard). */
  protected readonly barWidth = computed(() => {
    const target = this.targetMinor();
    if (target <= 0) return 0;
    return Math.min(100, Math.max(0, (this.balanceMinor() / target) * 100));
  });

  protected overspentAbsMinor(): number {
    return Math.abs(this.balanceMinor());
  }

  protected cadenceLabel(): string {
    if (this.kind() === 'one_time') return 'One-time';
    return this.period() === 'weekly' ? 'Weekly' : 'Monthly';
  }

  /** Plain-language status line (docs/allowances.md §16) for the normal (active, not overspent)
   *  case - the over/paused cases are handled directly in the template. */
  protected statusCopy(): string {
    if (this.kind() === 'one_time') return 'Set aside to spend';
    if (!this.underfunded()) return 'Fully set aside for this period';
    return this.period() === 'weekly'
      ? 'Tops back up to your weekly amount'
      : 'Tops back up to your monthly amount';
  }

  protected ariaLabel(): string {
    const state = this.overspent() ? 'over allowance' : !this.active() ? 'paused' : 'on track';
    return `${this.name()}, ${this.cadenceLabel()}, ${state}`;
  }

  constructor() {
    afterNextRender(() => this.ready.set(true));
  }
}
