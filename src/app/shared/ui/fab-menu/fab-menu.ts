import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LucidePlus, LucideScanLine, LucideFileDown, LucideTarget } from '@lucide/angular';

/** The small set of glyphs the FAB menu can render (lucide icons are attribute directives). */
export type FabMenuIcon = 'plus' | 'scan' | 'import' | 'goal';

export interface FabMenuItem {
  /** Stable id emitted by `(select)`. */
  readonly id: string;
  /** Plain-language label, always shown (never an icon alone - low-literacy rule). */
  readonly label: string;
  readonly icon: FabMenuIcon;
}

/**
 * Tap-to-open floating action menu (a labelled speed dial). Replaces the undiscoverable long-press
 * on the Expenses FAB: tapping the `+` reveals labelled actions (Add expense, Scan receipt, ...).
 * Dumb/presentational - the feature supplies `items` and reacts to `(select)`; navigation lives
 * there. Pinned bottom-right in the thumb zone, above the bottom nav. Tap the backdrop or press
 * Escape to dismiss; the `+` rotates to suggest close. Tokens only; honours reduced motion.
 */
@Component({
  selector: 'app-fab-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucidePlus, LucideScanLine, LucideFileDown, LucideTarget],
  host: { '(keydown.escape)': 'close()' },
  template: `
    @if (open()) {
      <!-- Backdrop: tap anywhere to dismiss. Decorative; the items + trigger sit above it. -->
      <div class="fab-scrim" (click)="close()" aria-hidden="true"></div>
      <ul class="fab-items" role="menu" [attr.aria-label]="ariaLabel()">
        @for (item of items(); track item.id) {
          <li role="none">
            <button type="button" role="menuitem" class="fab-item" (click)="choose(item.id)">
              <span class="fab-item-label">{{ item.label }}</span>
              <span class="fab-item-glyph" aria-hidden="true">
                @switch (item.icon) {
                  @case ('plus') { <svg lucidePlus [size]="22"></svg> }
                  @case ('scan') { <svg lucideScanLine [size]="22"></svg> }
                  @case ('import') { <svg lucideFileDown [size]="22"></svg> }
                  @case ('goal') { <svg lucideTarget [size]="22"></svg> }
                }
              </span>
            </button>
          </li>
        }
      </ul>
    }
    <button
      #trigger
      type="button"
      class="fab"
      [class.open]="open()"
      [attr.aria-label]="ariaLabel()"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      (click)="toggle()"
    >
      <svg lucidePlus [size]="28" aria-hidden="true"></svg>
    </button>
  `,
  styleUrl: './fab-menu.scss',
})
export class FabMenu {
  readonly items = input.required<FabMenuItem[]>();
  /** Accessible name for the closed FAB and the open menu. */
  readonly ariaLabel = input('Actions');
  /** Named `selected` (not `select`) to avoid clashing with the native `select` DOM event. */
  readonly selected = output<string>();

  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  protected readonly open = signal(false);

  protected toggle(): void {
    const next = !this.open();
    this.open.set(next);
    // Move focus into the menu once it renders (role="menu" keyboard expectation).
    if (next) {
      setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('.fab-item')?.focus());
    }
  }

  protected close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.trigger()?.nativeElement.focus();
  }

  protected choose(id: string): void {
    this.selected.emit(id);
    this.open.set(false);
  }
}
