import { TestBed } from '@angular/core/testing';
import { AllowanceRow } from './allowance-row';
import type { AllowanceKind, AllowancePeriod } from '../../../core/models';

describe('AllowanceRow', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AllowanceRow] }).compileComponents();
  });

  function make(opts: {
    balanceMinor: number;
    targetMinor: number;
    kind?: AllowanceKind;
    period?: AllowancePeriod | null;
    active?: boolean;
    overspent?: boolean;
    underfunded?: boolean;
  }) {
    const fixture = TestBed.createComponent(AllowanceRow);
    fixture.componentRef.setInput('name', 'Personal');
    fixture.componentRef.setInput('targetMinor', opts.targetMinor);
    fixture.componentRef.setInput('balanceMinor', opts.balanceMinor);
    fixture.componentRef.setInput('currency', 'MUR');
    fixture.componentRef.setInput('kind', opts.kind ?? 'recurring');
    fixture.componentRef.setInput('period', opts.period ?? 'weekly');
    fixture.componentRef.setInput('active', opts.active ?? true);
    fixture.componentRef.setInput('overspent', opts.overspent ?? false);
    fixture.componentRef.setInput('underfunded', opts.underfunded ?? false);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the normal (fully set-aside) state with no icon', () => {
    const fixture = make({ balanceMinor: 150_000, targetMinor: 150_000 });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('svg')).toBeNull();
    expect(el.querySelector('.status-line')!.textContent).toContain('Fully set aside');
  });

  it('renders the underfunded state with the plain-language top-up hint (no icon - not alarming)', () => {
    const fixture = make({ balanceMinor: 30_000, targetMinor: 150_000, underfunded: true });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('svg')).toBeNull();
    expect(el.querySelector('.status-line')!.textContent).toContain('Tops back up to your weekly amount');
  });

  it('renders the one-time cadence badge and copy', () => {
    const fixture = make({ balanceMinor: 50_000, targetMinor: 50_000, kind: 'one_time', period: null });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.cadence-badge')!.textContent).toContain('One-time');
    expect(el.querySelector('.status-line')!.textContent).toContain('Set aside to spend');
  });

  it('renders the over-allowance state with an icon + "over" label (never colour alone)', () => {
    const fixture = make({ balanceMinor: -20_000, targetMinor: 150_000, overspent: true });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('svg')).toBeTruthy();
    const text = el.querySelector('.status-line')!.textContent!;
    expect(text).toContain('over');
    expect(text).not.toContain('-200.00'); // the negative balance is shown as a positive "over" amount
  });

  it('never shows a negative amount in the "of target" line even when overspent', () => {
    const fixture = make({ balanceMinor: -20_000, targetMinor: 150_000, overspent: true });
    expect(fixture.componentInstance['balanceForDisplay']()).toBe(0);
  });

  it('renders the paused state with an icon + label, not just a colour change', () => {
    const fixture = make({ balanceMinor: 50_000, targetMinor: 150_000, active: false });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('svg')).toBeTruthy();
    expect(el.querySelector('.status-line')!.textContent).toContain('Paused');
  });

  it('clamps the fill width to 0-100 and guards a zero/invalid target', () => {
    const over = make({ balanceMinor: -1, targetMinor: 100 });
    expect(over.componentInstance['barWidth']()).toBe(0);
    const zeroTarget = make({ balanceMinor: 100, targetMinor: 0 });
    expect(zeroTarget.componentInstance['barWidth']()).toBe(0);
  });

  it('emits open when the row is activated', () => {
    const fixture = make({ balanceMinor: 100_000, targetMinor: 150_000 });
    const spy = jasmine.createSpy('open');
    fixture.componentInstance.open.subscribe(spy);
    (fixture.nativeElement as HTMLElement).querySelector('button')!.click();
    expect(spy).toHaveBeenCalled();
  });
});
