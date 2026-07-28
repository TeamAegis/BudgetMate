import { TestBed } from '@angular/core/testing';
import { AllowanceCard } from './allowance-card';

describe('AllowanceCard', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AllowanceCard] }).compileComponents();
  });

  function make(overrides: {
    targetMinor?: number;
    balanceMinor?: number;
    reservedMinor?: number;
    active?: boolean;
    overspent?: boolean;
    underfunded?: boolean;
    kind?: 'recurring' | 'one_time';
    period?: 'weekly' | 'monthly' | null;
    nextRefreshDate?: string | null;
  }) {
    const fixture = TestBed.createComponent(AllowanceCard);
    fixture.componentRef.setInput('name', 'Personal');
    fixture.componentRef.setInput('kind', overrides.kind ?? 'recurring');
    fixture.componentRef.setInput('period', overrides.period ?? 'weekly');
    fixture.componentRef.setInput('nextRefreshDate', overrides.nextRefreshDate ?? '2026-08-03');
    fixture.componentRef.setInput('targetMinor', overrides.targetMinor ?? 150_000);
    fixture.componentRef.setInput('balanceMinor', overrides.balanceMinor ?? 150_000);
    fixture.componentRef.setInput('reservedMinor', overrides.reservedMinor ?? 150_000);
    fixture.componentRef.setInput('currency', 'MUR');
    fixture.componentRef.setInput('active', overrides.active ?? true);
    fixture.componentRef.setInput('overspent', overrides.overspent ?? false);
    fixture.componentRef.setInput('underfunded', overrides.underfunded ?? false);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the funded state with no status line', () => {
    const fixture = make({});
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.status-line')).toBeNull();
    expect(el.querySelector('.fill')!.classList).toContain('funded');
  });

  it('renders the underfunded state with an info icon + informational note (not a warning)', () => {
    const fixture = make({ reservedMinor: 40_000, underfunded: true });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('svg')).toBeTruthy();
    expect(el.querySelector('.status-line')!.textContent).toContain('Tops back up');
    expect(el.querySelector('.status-line')!.textContent).toContain('2026-08-03');
    expect(el.querySelector('.fill')!.classList).toContain('underfunded');
  });

  it('renders the overspent state gently, as an amount over (icon + label, not colour alone)', () => {
    const fixture = make({ balanceMinor: -20_000, reservedMinor: 0, overspent: true });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('svg')).toBeTruthy();
    const text = el.querySelector('.status-line')!.textContent!;
    expect(text).toContain('over');
    expect(text).not.toContain('-');
    expect(el.querySelector('.fill')!.classList).toContain('overspent');
  });

  it('renders the paused state with a muted label, regardless of overspent/underfunded flags', () => {
    const fixture = make({ active: false, overspent: true, reservedMinor: 0 });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.status-line')!.textContent).toContain('Paused');
    expect(el.querySelector('.fill')!.classList).toContain('paused');
  });

  it('shows "One-time" for a one-time allowance and no next-refresh date', () => {
    const fixture = make({ kind: 'one_time', period: null, nextRefreshDate: null });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.kind')!.textContent).toContain('One-time');
  });

  it('suppresses the stale next-refresh date on a paused allowance (it would contradict "Paused")', () => {
    const fixture = make({ active: false, reservedMinor: 0 });
    const el = fixture.nativeElement as HTMLElement;
    const kindText = el.querySelector('.kind')!.textContent!;
    expect(kindText).toContain('Weekly');
    expect(kindText).not.toContain('next');
    expect(kindText).not.toContain('2026-08-03');
  });

  it('shows a distinct "Done" state for an auto-closed one-time allowance (fully used, not user-paused)', () => {
    const fixture = make({
      kind: 'one_time',
      period: null,
      nextRefreshDate: null,
      active: false,
      balanceMinor: 0,
      reservedMinor: 0,
    });
    const el = fixture.nativeElement as HTMLElement;
    const text = el.querySelector('.status-line')!.textContent!;
    expect(text).toContain('Done');
    expect(text).not.toContain('Paused');
    expect(el.querySelector('.fill')!.classList).toContain('closed');
  });

  it('keeps the "Paused" copy for a user-paused one-time allowance with leftover balance', () => {
    const fixture = make({
      kind: 'one_time',
      period: null,
      nextRefreshDate: null,
      active: false,
      balanceMinor: 50_000,
      reservedMinor: 0,
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.status-line')!.textContent).toContain('Paused');
    expect(el.querySelector('.fill')!.classList).toContain('paused');
  });

  it('clamps the fill width to 100% even if reserved exceeds target (a temporary refund)', () => {
    const fixture = make({ reservedMinor: 200_000, targetMinor: 150_000 });
    expect(fixture.componentInstance['barWidth']()).toBe(100);
  });

  it('guards against a zero/invalid target without dividing by zero', () => {
    const fixture = make({ targetMinor: 0, reservedMinor: 0 });
    expect(fixture.componentInstance['barWidth']()).toBe(0);
  });

  it('emits open when the card is activated', () => {
    const fixture = make({});
    const spy = jasmine.createSpy('open');
    fixture.componentInstance.open.subscribe(spy);
    (fixture.nativeElement as HTMLElement).querySelector('button')!.click();
    expect(spy).toHaveBeenCalled();
  });

  it('folds the reserved/target amounts and status into the aria-label (screen-reader detail)', () => {
    const fixture = make({ reservedMinor: 40_000, underfunded: true });
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    const label = btn.getAttribute('aria-label')!;
    expect(label).toContain('Personal');
    expect(label).toContain('400'); // Rs 400.00 reserved
    expect(label).toContain('1,500'); // Rs 1,500.00 target
    expect(label).toContain('Tops back up');
  });

  it('describes the paused state (amounts + status) in the aria-label, not just a bare word', () => {
    const fixture = make({ active: false, reservedMinor: 0 });
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    const label = btn.getAttribute('aria-label')!;
    expect(label).toContain('Personal');
    expect(label).toContain('set aside of');
    expect(label).toContain('Paused');
  });
});
