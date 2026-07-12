import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Banner, BannerTone } from './banner';

@Component({
  imports: [Banner],
  template: `<app-banner [tone]="tone">{{ message }}</app-banner>`,
})
class Host {
  tone: BannerTone = 'error';
  message = 'Something went wrong.';
}

describe('Banner', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  it('uses an assertive alert for the error tone (no aria-live needed)', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.tone = 'error';
    fixture.detectChanges();
    const p = fixture.nativeElement.querySelector('.banner');
    expect(p.getAttribute('role')).toBe('alert');
    expect(p.getAttribute('aria-live')).toBeNull();
  });

  it('uses a polite status for the warning tone', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.tone = 'warning';
    fixture.detectChanges();
    const p = fixture.nativeElement.querySelector('.banner');
    expect(p.getAttribute('role')).toBe('status');
    expect(p.getAttribute('aria-live')).toBe('polite');
  });

  it('uses a polite status for the success tone', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.tone = 'success';
    fixture.detectChanges();
    const p = fixture.nativeElement.querySelector('.banner');
    expect(p.getAttribute('role')).toBe('status');
    expect(p.getAttribute('aria-live')).toBe('polite');
  });

  it('uses a polite status for the info tone', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.tone = 'info';
    fixture.detectChanges();
    const p = fixture.nativeElement.querySelector('.banner');
    expect(p.getAttribute('role')).toBe('status');
    expect(p.getAttribute('aria-live')).toBe('polite');
  });
});
