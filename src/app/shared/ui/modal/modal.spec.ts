import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Modal } from './modal';

@Component({
  imports: [Modal],
  template: `<app-modal [title]="'Add a Thing'" [busy]="busy" (dismiss)="closed = closed + 1">
    <form class="modal-form"><div class="modal-body"><input /></div></form>
  </app-modal>`,
})
class Host {
  closed = 0;
  busy = false;
}

describe('Modal', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  it('renders a labelled dialog and locks body scroll while open', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('.modal-dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = fixture.nativeElement.querySelector('.modal-title');
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    expect(document.body.style.overflow).toBe('hidden');

    fixture.destroy();
    expect(document.body.style.overflow).toBe('');
  });

  it('emits close on Escape and on a scrim click, not on a dialog click', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const host = fixture.componentInstance;
    const dialog: HTMLElement = fixture.nativeElement.querySelector('.modal-dialog');
    const scrim: HTMLElement = fixture.nativeElement.querySelector('.modal-scrim');

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.closed).toBe(1);

    dialog.click(); // click inside the dialog must NOT dismiss
    expect(host.closed).toBe(1);

    scrim.click(); // click on the backdrop dismisses
    expect(host.closed).toBe(2);
  });

  it('does not dismiss while busy', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.busy = true;
    fixture.detectChanges();
    const scrim: HTMLElement = fixture.nativeElement.querySelector('.modal-scrim');
    scrim.click();
    fixture.nativeElement
      .querySelector('.modal-dialog')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fixture.componentInstance.closed).toBe(0);
  });
});
