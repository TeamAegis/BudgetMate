import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Button } from '../button/button';

/**
 * The primary action bar for a full-screen form page: a full-width Save pinned to the bottom as the
 * main focus (the back arrow is Cancel; a destructive Delete/Archive lives top-right in the header).
 * Fixed and lifted by `--keyboard-inset` so the Android soft keyboard never hides it (the WebView
 * does not resize for the keyboard - see `.claude/rules/android.md`). The form page reserves bottom
 * padding so the last field clears this bar. Dumb component: the page owns `save`.
 *
 *   <app-form-actions [loading]="busy()" (save)="save()" />
 */
@Component({
  selector: 'app-form-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  template: `
    <div class="form-actions">
      <app-button
        variant="primary"
        [block]="true"
        [loading]="loading()"
        [disabled]="disabled()"
        (click)="save.emit()"
      >
        {{ label() }}
      </app-button>
    </div>
  `,
  styleUrl: './form-actions.scss',
})
export class FormActions {
  readonly label = input('Save');
  /** In-flight save: shows the button spinner and disables it. */
  readonly loading = input(false);
  readonly disabled = input(false);
  readonly save = output<void>();
}
