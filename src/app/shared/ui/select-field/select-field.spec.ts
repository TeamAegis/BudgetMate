import { TestBed } from '@angular/core/testing';
import { SelectField } from './select-field';

describe('SelectField', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SelectField] }).compileComponents();
  });

  function make(value: number | string | null = 1) {
    const fixture = TestBed.createComponent(SelectField);
    fixture.componentRef.setInput('ariaLabel', 'Account');
    fixture.componentRef.setInput('options', [
      { value: 1, label: 'Cash (MUR)' },
      { value: 2, label: 'Bank (MUR)' },
    ]);
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the selected option label on the trigger', () => {
    const fixture = make(2);
    const trigger = fixture.nativeElement.querySelector('.trigger') as HTMLButtonElement;
    expect(trigger.textContent).toContain('Bank (MUR)');
  });

  it('opens the listbox and emits valueChange when an option is chosen', () => {
    const fixture = make(1);
    const el = fixture.nativeElement as HTMLElement;
    const trigger = el.querySelector('.trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const options = el.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(options.length).toBe(2);

    let emitted: number | string | undefined;
    fixture.componentInstance.valueChange.subscribe((v: number | string) => (emitted = v));
    options[1].click();
    fixture.detectChanges();
    expect(emitted).toBe(2);
  });

  it('is non-interactive and marked aria-disabled when disabled', () => {
    const fixture = make(1);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector('.trigger') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.getAttribute('aria-disabled')).toBe('true');

    // Clicking (or opening via keyboard) a disabled trigger must never open the listbox.
    trigger.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="listbox"]')).toBeNull();
  });
});
