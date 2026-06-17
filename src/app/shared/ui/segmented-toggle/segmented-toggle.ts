import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

export interface SegmentOption {
  value: string;
  label: string;
}

/**
 * Pill segmented toggle (design-system §7) — a small set of mutually-exclusive options shown as a
 * single pill, the active one filled coral. Used for Daily/Weekly/Monthly period and
 * Ongoing/Completed goal filters. Dumb/presentational and two-way bound:
 *
 *   <app-segmented-toggle
 *     ariaLabel="Goal status"
 *     [options]="[{ value: 'ongoing', label: 'Ongoing' }, { value: 'completed', label: 'Completed' }]"
 *     [(value)]="filter" />
 *
 * a11y: a `radiogroup` of `radio`s. Selection state is conveyed by both background fill AND
 * `aria-checked` (never colour alone). Left/Right arrows move selection (wrapping); only the
 * active segment is in the tab order (roving tabindex), matching the ARIA radio pattern.
 */
@Component({
  selector: 'app-segmented-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="seg" role="radiogroup" [attr.aria-label]="ariaLabel()">
      @for (opt of options(); track opt.value) {
        <button
          type="button"
          class="segment"
          role="radio"
          [class.active]="opt.value === value()"
          [attr.aria-checked]="opt.value === value()"
          [tabindex]="opt.value === value() ? 0 : -1"
          (click)="select(opt.value)"
          (keydown)="onKeydown($event)"
        >
          {{ opt.label }}
        </button>
      }
    </div>
  `,
  styleUrl: './segmented-toggle.scss',
})
export class SegmentedToggle {
  readonly options = input.required<SegmentOption[]>();
  readonly value = model.required<string>();
  /** Accessible group name (e.g. "Goal status", "Period"). */
  readonly ariaLabel = input.required<string>();

  /** Index of the currently selected option (for arrow-key movement). */
  private readonly activeIndex = computed(() =>
    this.options().findIndex((o) => o.value === this.value()),
  );

  protected select(value: string): void {
    this.value.set(value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const opts = this.options();
    if (opts.length === 0) return;
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (this.activeIndex() + 1) % opts.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (this.activeIndex() - 1 + opts.length) % opts.length;
    }
    if (next === null) return;
    event.preventDefault();
    this.value.set(opts[next].value);
    // Move focus to the newly selected segment so keyboard navigation stays visible.
    const buttons = (event.currentTarget as HTMLElement)
      .closest('.seg')
      ?.querySelectorAll<HTMLButtonElement>('.segment');
    buttons?.[next]?.focus();
  }
}
