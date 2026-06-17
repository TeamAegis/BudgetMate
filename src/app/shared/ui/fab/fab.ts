import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucidePlus } from '@lucide/angular';

/**
 * Floating action button (design-system §7) — a coral circle pinned in the bottom-right thumb
 * zone, above the bottom nav. Dumb/presentational: it emits `action` on click; the feature owns
 * what that does (e.g. open the add modal). The plus icon is decorative (`aria-hidden`); the
 * button's accessible name comes from the required `ariaLabel` input.
 *
 *   <app-fab ariaLabel="Add transaction" (action)="startCreate()" />
 *
 * v1 only ever uses the add `+`. If a future FAB needs a different glyph, project it into an
 * `[icon]` slot (matching app-button) rather than passing a string — the directive-based icon set
 * has no string lookup in this app's setup.
 */
@Component({
  selector: 'app-fab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucidePlus],
  template: `
    <button class="fab" type="button" [attr.aria-label]="ariaLabel()" (click)="action.emit()">
      <svg lucidePlus [size]="28" aria-hidden="true"></svg>
    </button>
  `,
  styleUrl: './fab.scss',
})
export class Fab {
  readonly ariaLabel = input.required<string>();
  readonly action = output<void>();
}
