import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { AllowanceSummaryCard } from './allowance-summary-card';

@Component({
  imports: [AllowanceSummaryCard],
  template: `<app-allowance-summary-card
    [usedMinor]="used()"
    [targetTotalMinor]="target()"
    [count]="count()"
    currency="MUR"
    (open)="opened = opened + 1"
  />`,
})
class Host {
  used = signal(10_000);
  target = signal(30_000);
  count = signal(2);
  opened = 0;
}

describe('AllowanceSummaryCard', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  it('shows used-of-set-aside and what is left, in plain language', () => {
    const fixture = render();
    const text: string = fixture.nativeElement.textContent;

    // Asserted on the numerals and the surrounding words separately: the money pipe joins the
    // symbol and the amount with a non-breaking space, so 'Rs 100' as plain text never matches.
    expect(text).toContain('100'); // used
    expect(text).toContain('300'); // total set aside
    expect(text).toContain('used of');
    expect(text).toContain('left across 2 allowances');
  });

  it('says "1 allowance" for a single allowance', () => {
    const fixture = render();
    fixture.componentInstance.count.set(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('1 allowance');
  });

  it('states the over amount with an icon, not colour alone', () => {
    const fixture = render();
    fixture.componentInstance.used.set(35_000); // 50.00 past the 300.00 set aside
    fixture.detectChanges();

    const status: HTMLElement = fixture.nativeElement.querySelector('.asc-status');
    expect(status.textContent).toContain('over what you set aside');
    expect(status.textContent).toContain('50');
    // The label is paired with an icon, so the state survives without colour perception.
    expect(status.querySelector('svg')).not.toBeNull();
  });

  it('clamps the progress fill to 100% when over, instead of overflowing', () => {
    const fixture = render();
    fixture.componentInstance.used.set(60_000); // 200% of target
    fixture.detectChanges();

    const fill: HTMLElement = fixture.nativeElement.querySelector('.asc-fill');
    expect(fill.style.width).toBe('100%');
    expect(fill.classList).toContain('over');
  });

  it('renders a 0% fill for a zero target rather than dividing by zero', () => {
    const fixture = render();
    fixture.componentInstance.target.set(0);
    fixture.componentInstance.used.set(0);
    fixture.detectChanges();

    const fill: HTMLElement = fixture.nativeElement.querySelector('.asc-fill');
    expect(fill.style.width).toBe('0%');
  });

  it('is one tappable target that emits open', () => {
    const fixture = render();
    const button: HTMLElement = fixture.nativeElement.querySelector('button.asc');

    expect(button.getAttribute('aria-label')).toContain('Allowances');
    button.click();
    expect(fixture.componentInstance.opened).toBe(1);
  });
});
