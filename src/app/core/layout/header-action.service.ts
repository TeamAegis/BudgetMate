import { Injectable, signal } from '@angular/core';

/**
 * The trailing action on the right of the global app header. On a full-screen form page this is the
 * destructive action (Delete / Archive) shown as a danger icon-button on the EDIT page; the primary
 * Save is a bottom action bar (see FormActions), and the back arrow is Cancel. Without an `icon` it
 * renders as a text button.
 */
export interface HeaderAction {
  /** Accessible name (and text label when no icon), e.g. "Delete transaction". */
  readonly label: string;
  /** Invoked on tap. */
  readonly run: () => void;
  /** When set, render as a danger icon-button with this glyph (else a text button). */
  readonly icon?: 'trash' | 'archive';
  /** In-flight: disables the button and marks it busy. */
  readonly loading?: boolean;
  /** Statically disabled. */
  readonly disabled?: boolean;
}

/**
 * Bridges a routed page to the global `AppHeader`'s trailing action slot. A full-screen form page
 * publishes its Save action on init and clears it on destroy:
 *
 *   private readonly headerAction = inject(HeaderActionService);
 *   constructor() {
 *     effect(() => this.headerAction.set(
 *       this.editing() ? { label: 'Delete goal', icon: 'trash', run: () => this.confirmingDelete.set(true) } : null,
 *     ));
 *     inject(DestroyRef).onDestroy(() => this.headerAction.clear());
 *   }
 *
 * The shell (`App`) reads `action()` and feeds it to `<app-header [action]>`. Root-provided so the
 * page and the shell share one instance.
 */
@Injectable({ providedIn: 'root' })
export class HeaderActionService {
  readonly action = signal<HeaderAction | null>(null);

  set(action: HeaderAction | null): void {
    this.action.set(action);
  }

  clear(): void {
    this.action.set(null);
  }
}
