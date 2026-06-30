import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { BalanceCard } from './balance-card';

@Component({
  imports: [BalanceCard],
  template: `<app-balance-card
    [label]="label"
    [amountMinor]="amountMinor"
    [currency]="currency"
    [caption]="caption"
  />`,
})
class Host {
  label = 'This month';
  amountMinor: number | null = null;
  currency = 'MUR';
  caption: string | null = 'No transactions yet this month.';
}

describe('BalanceCard', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  it('shows the label and caption, and no figure, when amountMinor is null', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.bc-label').textContent).toContain('This month');
    expect(fixture.nativeElement.querySelector('.bc-caption').textContent).toContain('No transactions');
    expect(fixture.nativeElement.querySelector('.bc-figure')).toBeNull();
  });

  it('shows the money figure when amountMinor is set', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.amountMinor = 1234;
    fixture.detectChanges();
    const figure = fixture.nativeElement.querySelector('.bc-figure');
    expect(figure).not.toBeNull();
    expect(figure.textContent.trim().length).toBeGreaterThan(0);
  });
});
