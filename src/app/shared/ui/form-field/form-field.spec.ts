import { TestBed } from '@angular/core/testing';
import { FormField } from './form-field';

describe('FormField', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FormField] }).compileComponents();
  });

  it('renders no flag by default (backward compatible with existing usages)', () => {
    const fixture = TestBed.createComponent(FormField);
    fixture.componentRef.setInput('label', 'Merchant');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.flag-msg')).toBeNull();
  });

  it('renders an advisory flag beneath the field, distinct from an error', () => {
    const fixture = TestBed.createComponent(FormField);
    fixture.componentRef.setInput('label', 'Merchant');
    fixture.componentRef.setInput('flag', 'Not detected - please enter');
    fixture.detectChanges();
    const flag = fixture.nativeElement.querySelector('.flag-msg');
    expect(flag).toBeTruthy();
    expect(flag.textContent).toContain('Not detected - please enter');
    expect(flag.getAttribute('role')).not.toBe('alert');
    expect(fixture.nativeElement.classList.contains('has-error')).toBe(false);
  });
});
