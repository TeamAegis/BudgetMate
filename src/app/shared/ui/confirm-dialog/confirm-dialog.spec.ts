import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { ConfirmDialog } from './confirm-dialog';

@Component({
  imports: [ConfirmDialog],
  template: `<app-confirm-dialog
    title="Delete goal?"
    message="This permanently removes the goal."
    confirmLabel="Delete"
    [busy]="busy"
    (confirm)="confirmed = confirmed + 1"
    (cancelled)="cancelled = cancelled + 1"
  />`,
})
class Host {
  busy = false;
  confirmed = 0;
  cancelled = 0;
}

describe('ConfirmDialog', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  it('renders an alertdialog described by its message', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const dialog: HTMLElement = fixture.nativeElement.querySelector('.modal-dialog');
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    const message: HTMLElement = fixture.nativeElement.querySelector('.confirm-message');
    expect(message.textContent).toContain('This permanently removes the goal.');
    expect(dialog.getAttribute('aria-describedby')).toBe(message.id);
  });

  it('emits confirm on the danger action and cancelled on Cancel', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const host = fixture.componentInstance;

    fixture.nativeElement.querySelector('button.danger').click();
    expect(host.confirmed).toBe(1);

    fixture.nativeElement.querySelector('button.ghost').click();
    expect(host.cancelled).toBe(1);
  });
});
