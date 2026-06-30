import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { FormActions } from './form-actions';

@Component({
  imports: [FormActions],
  template: `<app-form-actions [loading]="loading" (save)="saved = saved + 1" />`,
})
class Host {
  loading = false;
  saved = 0;
}

describe('FormActions', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  it('renders a Save button and emits save on click', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.textContent).toContain('Save');
    button.click();
    expect(fixture.componentInstance.saved).toBe(1);
  });

  it('disables the button while loading', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.loading = true;
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.disabled).toBe(true);
    button.click();
    expect(fixture.componentInstance.saved).toBe(0);
  });
});
