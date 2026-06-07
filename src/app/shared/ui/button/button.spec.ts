import { TestBed } from '@angular/core/testing';
import { Button } from './button';

describe('Button', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Button] }).compileComponents();
  });

  it('shows a spinner and disables itself while loading', () => {
    const fixture = TestBed.createComponent(Button);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button');
    expect(fixture.nativeElement.querySelector('app-spinner')).toBeTruthy();
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('is enabled with no spinner when idle', () => {
    const fixture = TestBed.createComponent(Button);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button');
    expect(fixture.nativeElement.querySelector('app-spinner')).toBeNull();
    expect(btn.disabled).toBe(false);
  });
});
