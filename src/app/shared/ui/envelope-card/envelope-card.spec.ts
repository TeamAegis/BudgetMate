import { TestBed } from '@angular/core/testing';
import { EnvelopeCard } from './envelope-card';
import type { EnvelopeStatus } from '../../../core/models';

describe('EnvelopeCard', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EnvelopeCard] }).compileComponents();
  });

  function make(spentMinor: number, capMinor: number, status: EnvelopeStatus) {
    const fixture = TestBed.createComponent(EnvelopeCard);
    fixture.componentRef.setInput('categoryName', 'Groceries');
    fixture.componentRef.setInput('capMinor', capMinor);
    fixture.componentRef.setInput('spentMinor', spentMinor);
    fixture.componentRef.setInput('remainingMinor', capMinor - spentMinor);
    fixture.componentRef.setInput('currency', 'MUR');
    fixture.componentRef.setInput('status', status);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the under state with no icon and a muted "left" line', () => {
    const fixture = make(5_000, 10_000, 'under');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('svg')).toBeNull();
    expect(el.querySelector('.status-line')!.textContent).toContain('left');
    expect(el.querySelector('.fill')!.classList).toContain('under');
  });

  it('renders the approaching state with an icon + label (not colour alone)', () => {
    const fixture = make(8_000, 10_000, 'approaching');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('svg')).toBeTruthy();
    expect(el.querySelector('.status-line')!.textContent).toContain('left');
    expect(el.querySelector('.fill')!.classList).toContain('approaching');
  });

  it('renders the over state with an icon + "over" label, gently phrased as an amount', () => {
    const fixture = make(12_000, 10_000, 'over');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('svg')).toBeTruthy();
    const text = el.querySelector('.status-line')!.textContent!;
    expect(text).toContain('over');
    expect(text).not.toContain('-'); // the negative remainder is shown as a positive "over" amount
    expect(el.querySelector('.fill')!.classList).toContain('over');
  });

  it('clamps the fill width to 100% even when over budget', () => {
    const fixture = make(15_000, 10_000, 'over');
    expect(fixture.componentInstance['barWidth']()).toBe(100);
  });

  it('shows a percentage label that is NOT clamped (can exceed 100%)', () => {
    const fixture = make(15_000, 10_000, 'over');
    expect(fixture.componentInstance['percentLabel']()).toBe(150);
  });

  it('guards against a zero/invalid cap without dividing by zero', () => {
    const fixture = make(100, 0, 'over');
    expect(fixture.componentInstance['percentLabel']()).toBe(0);
    expect(fixture.componentInstance['barWidth']()).toBe(0);
  });

  it('emits open when the card is activated', () => {
    const fixture = make(5_000, 10_000, 'under');
    const spy = jasmine.createSpy('open');
    fixture.componentInstance.open.subscribe(spy);
    (fixture.nativeElement as HTMLElement).querySelector('button')!.click();
    expect(spy).toHaveBeenCalled();
  });
});
