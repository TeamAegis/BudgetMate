import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucidePause, LucideTriangleAlert, LucideInfo, LucideCircleCheck } from '@lucide/angular';
import { MoneyPipe } from '../../pipes/money.pipe';
import type { AllowanceKind, AllowancePeriod } from '../../../core/models';

type AllowanceCardStatus = 'funded' | 'underfunded' | 'overspent' | 'paused' | 'closed';

/**
 * Allowance (savings-backed envelope) card (FR-3.4, design-system §7 AllowanceCard). Mirrors the
 * structural pattern of `EnvelopeCard` - name + a pill (`--progress-track-h`) progress track + the
 * set-aside/target amounts - but the semantics are the imprest allowance model
 * (`docs/allowances.md`): the track fills with `Reserved / Target` (both derived/stored in Rust,
 * never computed here), and the status line is driven by the Rust-derived flags, in priority order:
 * - **closed** (a one-time allowance that ran its course: `kind === 'one_time'`, `!active`, and
 *   `balanceMinor <= 0`) - a gentle "Done - fully used" label. A DERIVED display-only state (not a
 *   Rust flag): distinguishes natural completion from a user pausing the allowance, so completing a
 *   one-time allowance never reads as an interruption.
 * - **paused** (`active === false` and not `closed`) - a muted "Paused" label (the set-aside pill is
 *   0 while paused, since a paused allowance reserves nothing - `docs/allowances.md` §11).
 * - **overspent** (`balanceMinor < 0`) - a gentle, informational "Rs X over" (never "overspent" or
 *   another judgemental word), matching the over-budget phrasing in `ux-blueprint.md` §5.
 * - **underfunded** (active, recurring, currently below target) - an informational note that it
 *   tops back up to the target on the next refresh date - this is the ordinary mid-period state of
 *   a recurring allowance, not a warning.
 * - otherwise (fully funded / a one-time allowance not yet drawn down) - no status line, nothing to
 *   flag.
 *
 * Meaning is never colour alone - every non-default status pairs the fill/tint with an icon and a
 * plain-language label (a11y hard rule, design.md). Dumb/presentational: all money math and the
 * status flags happen in Rust; this component only formats (money pipe) and clamps display
 * geometry. The whole card is a button emitting `open`; the feature navigates to the allowance's
 * edit page.
 */
@Component({
  selector: 'app-allowance-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyPipe, LucidePause, LucideTriangleAlert, LucideInfo, LucideCircleCheck],
  providers: [MoneyPipe],
  template: `
    <button
      type="button"
      class="allowance-card"
      (click)="open.emit()"
      [attr.aria-label]="ariaLabel()"
    >
      <div class="head">
        <span class="name">{{ name() }}</span>
        <span class="kind">{{ kindLabel() }}</span>
      </div>

      <div class="track">
        <div class="fill" [class]="status()" [style.width.%]="ready() ? barWidth() : 0"></div>
      </div>

      <div class="amounts">
        <span class="set-aside">{{
          { amountMinor: reservedMinor(), currency: currency() } | money
        }}</span>
        <span class="sep">set aside of</span>
        <span class="target">{{ { amountMinor: targetMinor(), currency: currency() } | money }}</span>
      </div>

      @if (statusLine(); as line) {
        <div class="status-line" [class]="status()">
          @switch (status()) {
            @case ('closed') {
              <svg lucideCircleCheck [size]="16" aria-hidden="true"></svg>
            }
            @case ('paused') {
              <svg lucidePause [size]="16" aria-hidden="true"></svg>
            }
            @case ('overspent') {
              <svg lucideTriangleAlert [size]="16" aria-hidden="true"></svg>
            }
            @case ('underfunded') {
              <svg lucideInfo [size]="16" aria-hidden="true"></svg>
            }
          }
          <span>{{ line }}</span>
        </div>
      }
    </button>
  `,
  styleUrl: './allowance-card.scss',
})
export class AllowanceCard {
  private readonly money = inject(MoneyPipe);

  readonly name = input.required<string>();
  readonly kind = input.required<AllowanceKind>();
  /** `null` for a one-time allowance. */
  readonly period = input<AllowancePeriod | null>(null);
  /** `YYYY-MM-DD`; `null` for a one-time allowance (it never refreshes). */
  readonly nextRefreshDate = input<string | null>(null);
  readonly targetMinor = input.required<number>();
  readonly balanceMinor = input.required<number>();
  readonly reservedMinor = input.required<number>();
  readonly currency = input.required<string>();
  readonly active = input.required<boolean>();
  readonly overspent = input.required<boolean>();
  readonly underfunded = input.required<boolean>();
  /** Emitted when the card is activated; the feature navigates to the allowance's edit page. */
  readonly open = output<void>();

  /** Flips true after first render so the fill transitions from 0 -> width (reduced-motion safe). */
  protected readonly ready = signal(false);

  /** A one-time allowance that ran its course (fully used, then auto-closed by Rust) rather than
   *  being paused by the user - a derived, display-only distinction (see the class doc). */
  protected readonly closed = computed<boolean>(
    () => this.kind() === 'one_time' && !this.active() && this.balanceMinor() <= 0,
  );

  protected readonly kindLabel = computed(() => {
    if (this.kind() === 'one_time') return 'One-time';
    const period = this.period() === 'weekly' ? 'Weekly' : 'Monthly';
    // A paused allowance's next-refresh date is stale (it won't actually refresh while paused) and
    // would contradict the "Paused" status line below - show just the cadence while inactive.
    if (!this.active()) return period;
    const next = this.nextRefreshDate();
    return next ? `${period} - next ${next}` : period;
  });

  /** Priority order: closed (a one-time allowance that naturally completed) overrides paused, then
   *  paused overrides the rest (nothing is reserved while paused), then the gentle overspent flag,
   *  then the routine mid-period underfunded note, else nothing to flag. */
  protected readonly status = computed<AllowanceCardStatus>(() => {
    if (this.closed()) return 'closed';
    if (!this.active()) return 'paused';
    if (this.overspent()) return 'overspent';
    if (this.underfunded()) return 'underfunded';
    return 'funded';
  });

  /** Fill width, clamped to 0-100 (a display guard, not money math - mirrors EnvelopeCard). */
  protected readonly barWidth = computed(() => {
    const target = this.targetMinor();
    if (target <= 0) return 0;
    return Math.min(100, Math.max(0, (this.reservedMinor() / target) * 100));
  });

  protected statusLine(): string | null {
    switch (this.status()) {
      case 'closed':
        return 'Done - fully used.';
      case 'paused':
        return 'Paused - not currently set aside.';
      case 'overspent': {
        const over = this.money.transform({
          amountMinor: Math.abs(this.balanceMinor()),
          currency: this.currency(),
        });
        return `${over} over`;
      }
      case 'underfunded': {
        const period = this.period() === 'weekly' ? 'weekly' : 'monthly';
        const next = this.nextRefreshDate();
        return next
          ? `Tops back up to your ${period} amount on ${next}.`
          : `Tops back up to your ${period} amount.`;
      }
      default:
        return null;
    }
  }

  /** Folds the reserved/target amounts and the status text into the accessible name (mirrors
   *  `EnvelopeCard.ariaLabel()`) so a screen-reader user hears the same quantitative/status detail
   *  a sighted user sees, not just the name and a bare status word. */
  protected ariaLabel(): string {
    const reserved = this.money.transform({
      amountMinor: this.reservedMinor(),
      currency: this.currency(),
    });
    const target = this.money.transform({ amountMinor: this.targetMinor(), currency: this.currency() });
    const status = this.statusLine() ?? 'fully set aside';
    return `${this.name()}, ${reserved} set aside of ${target}, ${status}`;
  }

  constructor() {
    afterNextRender(() => this.ready.set(true));
  }
}
