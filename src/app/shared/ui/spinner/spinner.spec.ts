import { TestBed } from '@angular/core/testing';
import { Spinner } from './spinner';

describe('Spinner', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Spinner] }).compileComponents();
  });

  it('exposes a status role with an accessible label', () => {
    const fixture = TestBed.createComponent(Spinner);
    fixture.componentRef.setInput('label', 'Saving');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.getAttribute('role')).toBe('status');
    expect(host.getAttribute('aria-label')).toBe('Saving');
  });

  it('sizes the svg from the size input', () => {
    const fixture = TestBed.createComponent(Spinner);
    fixture.componentRef.setInput('size', 18);
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg.anim-spin');
    expect(svg.getAttribute('width')).toBe('18');
    expect(svg.getAttribute('height')).toBe('18');
  });
});
