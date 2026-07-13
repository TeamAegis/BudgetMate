import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideCheck } from '@lucide/angular';
import { MoneyPipe } from '../../pipes/money.pipe';

/**
 * Savings-goal progress row (FR-3.2, design-system §7 GoalProgressRow). Label + pill track with a
 * fill knob + `current / target` amounts. The fill animates from 0 on mount (honours
 * reduced-motion). **Completed** state: full track + trailing check icon + strikethrough title -
 * meaning is conveyed by icon + text, never colour alone (a11y). Display-only: progress is derived
 * from the saved amount, not dragged. Dumb component.
 *
 * By default the whole row is a button that emits `open`; the feature opens the goal DETAIL page in
 * response (issue I5). When `interactive` is false (e.g. the goal-detail hero) it renders as a
 * static, non-interactive row with the same visuals.
 */
@Component({
  selector: 'app-goal-progress-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyPipe, LucideCheck],
  template: `
    @if (interactive()) {
      <button
        type="button"
        class="goal-row"
        (click)="open.emit()"
        [attr.aria-label]="name() + (completed() ? ' - completed' : '')"
      >
        <div class="head">
          <span class="name" [class.done]="completed()">{{ name() }}</span>
          @if (completed()) {
            <svg lucideCheck [size]="18" class="check" aria-hidden="true"></svg>
          }
        </div>
        <div class="track" [class.done]="completed()">
          <div class="fill" [style.width.%]="ready() ? percent() : 0">
            <span class="knob"></span>
          </div>
        </div>
        <div class="amounts" [class.done]="completed()">
          <span class="current">{{ { amountMinor: currentMinor(), currency: currency() } | money }}</span>
          <span class="sep">/</span>
          <span class="target">{{ { amountMinor: targetMinor(), currency: currency() } | money }}</span>
        </div>
      </button>
    } @else {
      <div class="goal-row static">
        <div class="head">
          <span class="name" [class.done]="completed()">{{ name() }}</span>
          @if (completed()) {
            <svg lucideCheck [size]="18" class="check" aria-hidden="true"></svg>
          }
        </div>
        <div class="track" [class.done]="completed()">
          <div class="fill" [style.width.%]="ready() ? percent() : 0">
            <span class="knob"></span>
          </div>
        </div>
        <div class="amounts" [class.done]="completed()">
          <span class="current">{{ { amountMinor: currentMinor(), currency: currency() } | money }}</span>
          <span class="sep">/</span>
          <span class="target">{{ { amountMinor: targetMinor(), currency: currency() } | money }}</span>
        </div>
      </div>
    }
  `,
  styleUrl: './goal-progress-row.scss',
})
export class GoalProgressRow {
  readonly name = input.required<string>();
  readonly currentMinor = input.required<number>();
  readonly targetMinor = input.required<number>();
  readonly currency = input.required<string>();
  readonly completed = input(false);
  /** When false, render a static (non-button) row - for the goal-detail hero. */
  readonly interactive = input(true);
  /** Emitted when the interactive row is activated; the feature opens the goal detail page. */
  readonly open = output<void>();

  /** Flips true after first render so the fill transitions from 0 -> percent (reduced-motion safe). */
  protected readonly ready = signal(false);

  /** Fill fraction, clamped to 0-100 (a guard, not money math - the value comes from Rust). */
  protected readonly percent = computed(() => {
    const target = this.targetMinor();
    if (target <= 0) return 0;
    return Math.min(100, Math.max(0, (this.currentMinor() / target) * 100));
  });

  constructor() {
    afterNextRender(() => this.ready.set(true));
  }
}
