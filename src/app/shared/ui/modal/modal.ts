import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewEncapsulation,
  inject,
  input,
  output,
} from '@angular/core';

/** Unique-per-instance id so the dialog's `aria-labelledby` always points at its own title. */
let nextModalId = 0;

/**
 * A small centred dialog card over a blurred, dimmed scrim. This is the app's ONLY remaining
 * overlay: add/edit forms are now full-screen routed pages (see the form-page pattern and
 * `.claude/rules/design.md`), so do NOT reach for this to host a form. Its single intended consumer
 * is `ConfirmDialog` (a short, keyboard-free destructive confirmation - the one genre-correct use of
 * a centred dialog). Pass `role="alertdialog"` for those.
 *
 *   <app-modal [title]="title()" role="alertdialog" [describedById]="messageId" (dismiss)="cancel()">
 *     <p [id]="messageId">…</p>
 *     <div class="modal-footer">…Cancel / Confirm…</div>
 *   </app-modal>
 *
 * Dumb component: no data, no business logic. It owns dialog behaviour only - focus trap + restore,
 * body scroll-lock, Escape and click-outside dismiss. `busy` blocks dismissal while an action is in
 * flight. Styling uses `ViewEncapsulation.None` scoped under `.app-modal` so the projected
 * `.modal-footer` can be laid out without leaking global rules. It sizes to its content.
 */
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="app-modal">
      <!-- Backdrop click dismisses; keyboard users dismiss with Escape (handled on the dialog),
           so the scrim itself needs no key handler / focus. -->
      <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
      <div class="modal-scrim" (click)="onScrimClick($event)">
        <div
          #dialog
          class="modal-dialog"
          [attr.role]="role()"
          aria-modal="true"
          [attr.aria-labelledby]="titleId"
          [attr.aria-describedby]="describedById()"
          (keydown)="onKeydown($event)"
          tabindex="-1"
        >
          <h2 [id]="titleId" class="modal-title">{{ title() }}</h2>
          <ng-content></ng-content>
        </div>
      </div>
    </div>
  `,
  styleUrl: './modal.scss',
})
export class Modal implements AfterViewInit, OnDestroy {
  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;

  readonly title = input.required<string>();
  /** While true, the modal won't dismiss on Escape / backdrop (e.g. an action is in flight). */
  readonly busy = input(false);
  /** ARIA role - use `alertdialog` for destructive confirmations (ConfirmDialog), else `dialog`. */
  readonly role = input<'dialog' | 'alertdialog'>('dialog');
  /** Optional id of the element describing the dialog (e.g. the confirm message), for screen readers. */
  readonly describedById = input<string | null>(null);
  /** Named `dismiss` (not `close`) to avoid clashing with the native `close` DOM event. */
  readonly dismiss = output<void>();

  protected readonly titleId = `modal-title-${nextModalId++}`;

  /** Element focused before the modal opened, restored on close so focus never gets lost. */
  private previouslyFocused: HTMLElement | null = null;

  ngAfterViewInit(): void {
    this.previouslyFocused = document.activeElement as HTMLElement | null;
    // Lock background scroll while the modal is open.
    document.body.style.overflow = 'hidden';
    this.focusFirst();
  }

  ngOnDestroy(): void {
    document.body.style.overflow = '';
    this.previouslyFocused?.focus?.();
  }

  protected onScrimClick(event: MouseEvent): void {
    // Only a click on the scrim itself (not a child) dismisses; never while busy.
    if (event.target === event.currentTarget && !this.busy()) this.dismiss.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && !this.busy()) {
      event.preventDefault();
      this.dismiss.emit();
      return;
    }
    if (event.key === 'Tab') this.trapTab(event);
  }

  /** Keep Tab focus inside the dialog (wrap from last → first and first ← last). */
  private trapTab(event: KeyboardEvent): void {
    const focusable = this.focusableElements();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
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
    (focusable[0] ?? this.dialogEl())?.focus();
  }

  private dialogEl(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('.modal-dialog');
  }

  private focusableElements(): HTMLElement[] {
    const dialog = this.dialogEl();
    if (!dialog) return [];
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
      'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
  }
}
