import { Injectable, signal } from '@angular/core';

/**
 * A primary action shown on the right of the global app header (e.g. the **Save** of a full-screen
 * form page). Put in the header - not a bottom bar - so the Android soft keyboard can never hide it
 * (the WebView doesn't resize for the keyboard; see `core/layout/viewport-insets.service.ts`).
 */
export interface HeaderAction {
  /** Button label, e.g. "Save". */
  readonly label: string;
  /** Invoked on tap. The page owns validation - a no-op-on-invalid `run` is fine. */
  readonly run: () => void;
  /** In-flight: disables the button and marks it busy. */
  readonly loading?: boolean;
  /** Statically disabled (rare - prefer letting `run` reveal validation errors). */
  readonly disabled?: boolean;
}

/**
 * Bridges a routed page to the global `AppHeader`'s trailing action slot. A full-screen form page
 * publishes its Save action on init and clears it on destroy:
 *
 *   private readonly headerAction = inject(HeaderActionService);
 *   constructor() {
 *     effect(() => this.headerAction.set({ label: 'Save', loading: this.busy(), run: () => this.save() }));
 *     inject(DestroyRef).onDestroy(() => this.headerAction.clear());
 *   }
 *
 * The shell (`App`) reads `action()` and feeds it to `<app-header [action]>`. Root-provided so the
 * page and the shell share one instance.
 */
@Injectable({ providedIn: 'root' })
export class HeaderActionService {
  readonly action = signal<HeaderAction | null>(null);

  set(action: HeaderAction): void {
    this.action.set(action);
  }

  clear(): void {
    this.action.set(null);
  }
}
