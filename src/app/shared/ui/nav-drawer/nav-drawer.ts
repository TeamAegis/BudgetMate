import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  input,
  output,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideChevronRight,
  LucideWallet,
  LucideArrowLeftRight,
  LucideTags,
  LucidePiggyBank,
  LucideHandCoins,
  LucideRepeat,
  LucideFunnel,
  LucideFileUp,
  LucideDownload,
  LucideDatabaseBackup,
  LucideSettings,
} from '@lucide/angular';
import type { NavDestination } from '../../../core/layout/nav-destinations';

/** A titled group of destinations in the drawer (e.g. "Your money"). */
export interface NavDrawerGroup {
  readonly title: string;
  readonly items: readonly NavDestination[];
}

/** Unique-per-instance id so the sheet's `aria-labelledby` points at its own heading. */
let nextDrawerId = 0;

/**
 * The navigation drawer (ADR 0013): a modal sheet that slides in from the leading edge and lists the
 * app's SECONDARY destinations - Allowances, Budgets, Accounts, Categories, Recurring, Rules,
 * Import, Export, Backup - each of which was previously reachable only by opening Settings and
 * scrolling.
 *
 * Why a drawer, given the research: hidden navigation measurably hurts discoverability (Nielsen
 * Norman Group put the task-completion cost at ~21%), which is exactly why the four PRIMARY
 * destinations stay in the always-visible BottomNav and are deliberately NOT repeated here. The
 * documented pattern for an app with more destinations than tabs is precisely this pairing - a
 * bottom bar for the 3-5 primary sections plus a drawer for secondary items - and against the
 * baseline these screens are moving FROM (buried inside a preferences screen) a labelled drawer one
 * tap from every top-level tab is strictly more discoverable.
 *
 * Geometry follows Material's modal-drawer rule for phones: `--layout-drawer-w` is the screen width
 * minus 56px capped at 280px, so a strip of the dimmed page always stays visible and the sheet never
 * reads as a full page. Rows are `--tap-target-min` tall.
 *
 * Existence IS open: the host renders `<app-nav-drawer>` only while the drawer is open (same
 * contract as `app-modal`), which is what lets the focus trap, scroll lock, and focus restore hang
 * off the component lifecycle. Dumb/presentational - the host supplies `groups` and reacts to
 * `(dismiss)`; this component owns dialog behaviour only (focus trap + restore, body scroll lock,
 * Escape and scrim dismiss).
 */
@Component({
  selector: 'app-nav-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterLinkActive,
    LucideChevronRight,
    LucideWallet,
    LucideArrowLeftRight,
    LucideTags,
    LucidePiggyBank,
    LucideHandCoins,
    LucideRepeat,
    LucideFunnel,
    LucideFileUp,
    LucideDownload,
    LucideDatabaseBackup,
    LucideSettings,
  ],
  template: `
    <!-- Scrim click dismisses; keyboard users dismiss with Escape (handled on the sheet), so the
         scrim itself needs no key handler / focus. -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <div class="drawer-scrim" (click)="onScrimClick($event)">
      <nav
        #sheet
        class="drawer-sheet"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
        (keydown)="onKeydown($event)"
        tabindex="-1"
      >
        <h2 [id]="titleId" class="drawer-title">{{ title() }}</h2>

        @for (group of groups(); track group.title) {
          <p class="drawer-group-title">{{ group.title }}</p>
          <ul class="drawer-rows">
            @for (item of group.items; track item.id) {
              <li>
                <a
                  class="drawer-row"
                  [routerLink]="item.route"
                  routerLinkActive="active"
                  [routerLinkActiveOptions]="activeOptions(item)"
                  #rla="routerLinkActive"
                  [attr.aria-current]="rla.isActive ? 'page' : null"
                >
                  <span class="drawer-row-icon">
                    @switch (item.icon) {
                      @case ('allowances') { <svg lucideHandCoins [size]="24" aria-hidden="true"></svg> }
                      @case ('budgets') { <svg lucidePiggyBank [size]="24" aria-hidden="true"></svg> }
                      @case ('accounts') { <svg lucideWallet [size]="24" aria-hidden="true"></svg> }
                      @case ('transfer') { <svg lucideArrowLeftRight [size]="24" aria-hidden="true"></svg> }
                      @case ('categories') { <svg lucideTags [size]="24" aria-hidden="true"></svg> }
                      @case ('recurring') { <svg lucideRepeat [size]="24" aria-hidden="true"></svg> }
                      @case ('rules') { <svg lucideFunnel [size]="24" aria-hidden="true"></svg> }
                      @case ('import') { <svg lucideFileUp [size]="24" aria-hidden="true"></svg> }
                      @case ('export') { <svg lucideDownload [size]="24" aria-hidden="true"></svg> }
                      @case ('backup') { <svg lucideDatabaseBackup [size]="24" aria-hidden="true"></svg> }
                      @case ('settings') { <svg lucideSettings [size]="24" aria-hidden="true"></svg> }
                    }
                  </span>
                  <span class="drawer-row-text">
                    <span class="drawer-row-label">{{ item.label }}</span>
                    <span class="drawer-row-hint">{{ item.hint }}</span>
                  </span>
                  <svg lucideChevronRight [size]="18" class="drawer-row-chevron" aria-hidden="true"></svg>
                </a>
              </li>
            }
          </ul>
        }
      </nav>
    </div>
  `,
  styleUrl: './nav-drawer.scss',
})
export class NavDrawer implements AfterViewInit, OnDestroy {
  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;

  readonly groups = input.required<readonly NavDrawerGroup[]>();
  /** Accessible name for the sheet, also rendered as its visible heading. */
  readonly title = input('Go to');
  /** Named `dismiss` (not `close`) to avoid clashing with the native `close` DOM event. */
  readonly dismiss = output<void>();

  protected readonly titleId = `drawer-title-${nextDrawerId++}`;

  /** Element focused before the drawer opened (the header's menu button), restored on close. */
  private previouslyFocused: HTMLElement | null = null;

  ngAfterViewInit(): void {
    this.previouslyFocused = document.activeElement as HTMLElement | null;
    // Lock background scroll while the sheet is open.
    document.body.style.overflow = 'hidden';
    this.focusFirst();
  }

  ngOnDestroy(): void {
    document.body.style.overflow = '';
    this.previouslyFocused?.focus?.();
  }

  /**
   * `/settings` must match EXACTLY, or every `/settings/*` child would light the Settings row as
   * well as its own. Every other destination matches by prefix on purpose, so `/allowances/3/edit`
   * keeps Allowances marked as the current page.
   */
  protected activeOptions(item: NavDestination): { exact: boolean } {
    return { exact: item.route === '/settings' };
  }

  protected onScrimClick(event: MouseEvent): void {
    // Only a click on the scrim itself (not the sheet inside it) dismisses.
    if (event.target === event.currentTarget) this.dismiss.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.dismiss.emit();
      return;
    }
    if (event.key === 'Tab') this.trapTab(event);
  }

  /** Keep Tab focus inside the sheet (wrap from last → first and first ← last). */
  private trapTab(event: KeyboardEvent): void {
    const focusable = this.focusableElements();
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusFirst(): void {
    const focusable = this.focusableElements();
    (focusable[0] ?? this.sheetEl())?.focus();
  }

  private sheetEl(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('.drawer-sheet');
  }

  private focusableElements(): HTMLElement[] {
    const sheet = this.sheetEl();
    if (!sheet) return [];
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
      'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(sheet.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
  }
}
