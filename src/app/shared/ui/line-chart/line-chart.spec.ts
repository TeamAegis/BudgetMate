import { TestBed } from '@angular/core/testing';
import { LineChart } from './line-chart';
import { registerCharts } from '../../charts/chart-setup';

describe('LineChart', () => {
  beforeEach(() => {
    // The consuming feature normally does this once (Reports); this spec exercises LineChart in
    // isolation, so it must register the controllers/scales itself (idempotent - see chart-setup.ts).
    registerCharts();
    TestBed.configureTestingModule({ imports: [LineChart] });
  });

  it('renders a canvas and a visually-hidden label/amount list for the series', () => {
    const fixture = TestBed.createComponent(LineChart);
    fixture.componentRef.setInput('points', [
      { label: '05 Jul', amountMinor: 3_000 },
      { label: '13 Jul', amountMinor: 2_000 },
    ]);
    fixture.componentRef.setInput('currency', 'MUR');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('canvas')).not.toBeNull();
    const items = Array.from(host.querySelectorAll('.visually-hidden li')).map((li) => li.textContent);
    expect(items.some((t) => t?.includes('05 Jul'))).toBe(true);
    expect(items.some((t) => t?.includes('13 Jul'))).toBe(true);
  });

  it('renders nothing catastrophic for an empty point list', () => {
    const fixture = TestBed.createComponent(LineChart);
    fixture.componentRef.setInput('points', []);
    fixture.componentRef.setInput('currency', 'MUR');
    expect(() => fixture.detectChanges()).not.toThrow();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.visually-hidden li').length).toBe(0);
  });
});
