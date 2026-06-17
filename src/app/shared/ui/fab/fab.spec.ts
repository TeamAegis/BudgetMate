import { TestBed } from '@angular/core/testing';
import { Fab } from './fab';

describe('Fab', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Fab] }).compileComponents();
  });

  function make(ariaLabel = 'Add transaction') {
    const fixture = TestBed.createComponent(Fab);
    fixture.componentRef.setInput('ariaLabel', ariaLabel);
    fixture.detectChanges();
    return fixture;
  }

  it('exposes the required aria-label on the button and hides the icon from a11y', () => {
    const el = make('Add goal').nativeElement as HTMLElement;
    const btn = el.querySelector('button')!;
    expect(btn.getAttribute('aria-label')).toBe('Add goal');
    expect(el.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('emits action when clicked', () => {
    const fixture = make();
    const spy = jasmine.createSpy('action');
    fixture.componentInstance.action.subscribe(spy);
    (fixture.nativeElement as HTMLElement).querySelector('button')!.click();
    expect(spy).toHaveBeenCalled();
  });
});
