import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { LucideCircle, LucideCircleDot } from '@lucide/angular';

export interface SegmentOption {
  value: string;
  label: string;
  /**
   * Optional plain-language explainer for the option. Rendered ONLY in `layout="list"` (the pill
   * has no room for a second line). Use it to say what the choice means in ordinary words.
   */
  hint?: string;
}

/** Visual treatment - see the class doc for when to pick which. */
export type SegmentLayout = 'pill' | 'list';

/**
 * Segmented toggle (design-system §7) - a small set of mutually-exclusive options. Two visual
 * treatments, same behaviour and same a11y contract:
 *
 * - `layout="pill"` (DEFAULT) - one pill, the active segment filled coral. Correct for **filters
 *   and mode switches**, where the control changes what you are *looking at*: the Goals
 *   status filter, the Analytics period filter, the Export file format, the Import file type.
 * - `layout="list"` - full-width stacked rows, each optionally carrying a `hint`. Correct for a
 *   **form answer**, especially one that reveals or hides other fields. GOV.UK builds its
 *   conditionally-revealed-question pattern on stacked radios and explicitly warns against
 *   revealing follow-up questions from inline side-by-side options; Material 3 likewise recommends
 *   radios (vertically listed) for a single choice of five or fewer and advises against horizontal
 *   radio lists. Stacked rows also leave room for a plain-language `hint` per option, which the
 *   pill cannot fit - and that matters for low-financial-literacy users.
 *
 * Pick by the question "is this an answer I am saving, or a view I am switching?" Do NOT change the
 * default: flipping every usage to `list` would restyle the four filters, where the pill is right.
 *
 * Dumb/presentational and two-way bound:
 *
 *   <app-segmented-toggle
 *     ariaLabel="Goal status"
 *     [options]="[{ value: 'ongoing', label: 'Ongoing' }, { value: 'completed', label: 'Completed' }]"
 *     [(value)]="filter" />
 *
 * a11y: a `radiogroup` of `radio`s (the W3C APG radio pattern), identical in both layouts. Selection
 * state is conveyed by `aria-checked` AND a visible non-colour cue - the background fill in `pill`,
 * a filled/hollow circle glyph plus border and tint in `list` - never colour alone. Left/Right (and
 * Up/Down) arrows move selection, wrapping; only the active option is in the tab order (roving
 * tabindex).
 *
 * `disabled` (default false) makes the whole group non-interactive - e.g. while an in-flight
 * operation elsewhere on the page depends on the current value staying put (the import wizard's
 * idle-step preview read, design review of issue #13). Each button gets `[disabled]` (removing it
 * from the tab order and blocking click/keyboard activation) and the group carries
 * `aria-disabled="true"`; the visual dimming uses `--opacity-disabled` only, never a hardcoded value.
 */
@Component({
  selector: 'app-segmented-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideCircle, LucideCircleDot],
  template: `
    <div
      class="seg"
      [class.list]="layout() === 'list'"
      [class.disabled]="disabled()"
      role="radiogroup"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-disabled]="disabled() ? true : null"
    >
      @for (opt of options(); track opt.value) {
        <button
          type="button"
          class="segment"
          role="radio"
          [class.active]="opt.value === value()"
          [attr.aria-checked]="opt.value === value()"
          [tabindex]="opt.value === value() ? 0 : -1"
          [disabled]="disabled()"
          (click)="select(opt.value)"
          (keydown)="onKeydown($event)"
        >
          @if (layout() === 'list') {
            <!-- Shape cue for the selected row, so selection never rests on colour alone. Decorative:
                 the state is already announced via aria-checked on the radio. -->
            <span class="seg-mark" aria-hidden="true">
              @if (opt.value === value()) {
                <svg lucideCircleDot [size]="20"></svg>
              } @else {
                <svg lucideCircle [size]="20"></svg>
              }
            </span>
            <span class="seg-text">
              <span class="seg-label">{{ opt.label }}</span>
              @if (opt.hint; as h) {
                <span class="seg-hint">{{ h }}</span>
              }
            </span>
          } @else {
            {{ opt.label }}
          }
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
  /**
   * Visual treatment. Defaults to `pill`; opt into `list` for a form answer (see the class doc).
   * Leave the default alone for filters and mode switches.
   */
  readonly layout = input<SegmentLayout>('pill');
  /** Makes the whole group non-interactive (see class doc). */
  readonly disabled = input(false);

  /** Index of the currently selected option (for arrow-key movement). */
  private readonly activeIndex = computed(() =>
    this.options().findIndex((o) => o.value === this.value()),
  );

  protected select(value: string): void {
    if (this.disabled()) return;
    this.value.set(value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.disabled()) return;
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
