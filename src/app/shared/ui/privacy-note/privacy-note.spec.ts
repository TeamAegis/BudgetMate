import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { PrivacyNote } from './privacy-note';

@Component({
  imports: [PrivacyNote],
  template: `<app-privacy-note />`,
})
class Host {}

describe('PrivacyNote', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  it('renders the plain-language privacy copy', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const msg = fixture.nativeElement.querySelector('.msg');
    expect(msg.textContent.trim()).toBe(
      'Your data is encrypted on this device. Nothing leaves your phone. No analytics.',
    );
  });

  it('marks the leading icon as decorative (aria-hidden)', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector('svg.icon');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });

  it('is a static note, not a live region or alert', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const note = fixture.nativeElement.querySelector('.privacy-note');
    expect(note.hasAttribute('role')).toBe(false);
    expect(note.hasAttribute('aria-live')).toBe(false);
  });
});
