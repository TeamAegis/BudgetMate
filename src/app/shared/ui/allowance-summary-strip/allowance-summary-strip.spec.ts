import { TestBed } from '@angular/core/testing';
import { AllowanceSummaryStrip } from './allowance-summary-strip';

describe('AllowanceSummaryStrip', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AllowanceSummaryStrip] }).compileComponents();
  });

  it('renders the three stats formatted via the money pipe', () => {
    const fixture = TestBed.createComponent(AllowanceSummaryStrip);
    fixture.componentRef.setInput('totalMinor', 1_000_000);
    fixture.componentRef.setInput('reservedMinor', 230_000);
    fixture.componentRef.setInput('availableMinor', 770_000);
    fixture.componentRef.setInput('currency', 'MUR');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const stats = el.querySelectorAll('.stat');
    expect(stats.length).toBe(3);
    expect(stats[0].textContent).toContain('Total savings');
    expect(stats[0].textContent).toContain('10,000');
    expect(stats[1].textContent).toContain('Set aside');
    expect(stats[1].textContent).toContain('2,300');
    expect(stats[2].textContent).toContain('Free to spend');
    expect(stats[2].textContent).toContain('7,700');
  });
});
