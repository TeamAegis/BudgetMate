import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Modal } from '../modal/modal';
import { Button } from '../button/button';

/** Unique-per-instance id so the dialog's `aria-describedby` always points at its own message. */
let nextConfirmId = 0;

/**
 * Two-button destructive-confirm dialog (design-system §8.2): used before delete, archive,
 * restore-replace. This is the single sanctioned overlay in the app (forms are full-screen pages) -
 * a short, keyboard-free, blocking confirmation whose gravity is the point. Built on app-modal with
 * `role="alertdialog"` and the message wired as `aria-describedby`. Dumb component - the parent owns
 * the entity being acted on and reacts to `confirm`/`cancelled`:
 *
 *   @if (confirmingDelete()) {
 *     <app-confirm-dialog
 *       title="Delete transaction?"
 *       message="This can't be undone."
 *       confirmLabel="Delete"
 *       [busy]="busy()"
 *       (confirm)="deleteConfirmed()"
 *       (cancelled)="confirmingDelete.set(false)"
 *     />
 *   }
 */
@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Modal, Button],
  template: `
    <app-modal
      [title]="title()"
      role="alertdialog"
      [describedById]="messageId"
      [busy]="busy()"
      (dismiss)="cancelled.emit()"
    >
      <div class="confirm">
        <p class="confirm-message" [id]="messageId">{{ message() }}</p>
        <div class="modal-footer">
          <span class="modal-footer-spacer"></span>
          <app-button variant="ghost" (click)="cancelled.emit()" [disabled]="busy()">Cancel</app-button>
          <app-button variant="danger" (click)="confirm.emit()" [loading]="busy()">
            {{ confirmLabel() }}
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
  styles: `
    .confirm-message {
      margin: 0;
      color: var(--c-text-muted);
      font-size: var(--t-body);
    }
  `,
})
export class ConfirmDialog {
  protected readonly messageId = `confirm-msg-${nextConfirmId++}`;
  readonly title = input.required<string>();
  readonly message = input.required<string>();
  readonly confirmLabel = input('Delete');
  readonly busy = input(false);
  readonly confirm = output<void>();
  /** Named `cancelled` (not `cancel`) to avoid clashing with the native `cancel` DOM event. */
  readonly cancelled = output<void>();
}
