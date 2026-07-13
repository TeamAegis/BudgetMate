import { TestBed } from '@angular/core/testing';
import { PieChart } from './pie-chart';
import { registerCharts } from '../../charts/chart-setup';

describe('PieChart', () => {
  beforeEach(() => {
    // The consuming feature normally does this once (Reports); this spec exercises PieChart in
    // isolation, so it must register the controller/elements itself (idempotent - chart-setup.ts).
    registerCharts();
    TestBed.configureTestingModule({ imports: [PieChart] });
  });

  it('renders a canvas and a visually-hidden label/amount list (legend text, never colour alone)', () => {
    const fixture = TestBed.createComponent(PieChart);
    fixture.componentRef.setInput('slices', [
      { label: 'Groceries', amountMinor: 3_000 },
      { label: 'Dining', amountMinor: 2_000 },
    ]);
    fixture.componentRef.setInput('currency', 'MUR');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('canvas')).not.toBeNull();
    const items = Array.from(host.querySelectorAll('.visually-hidden li')).map((li) => li.textContent);
    expect(items.some((t) => t?.includes('Groceries'))).toBe(true);
    expect(items.some((t) => t?.includes('Dining'))).toBe(true);
  });

  it('renders nothing catastrophic for an empty slice list', () => {
    const fixture = TestBed.createComponent(PieChart);
    fixture.componentRef.setInput('slices', []);
    fixture.componentRef.setInput('currency', 'MUR');
    expect(() => fixture.detectChanges()).not.toThrow();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.visually-hidden li').length).toBe(0);
  });
});
