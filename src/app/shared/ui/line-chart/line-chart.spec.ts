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

  it('renders a canvas whose aria-label carries every label/amount pair (no hidden DOM list)', () => {
    const fixture = TestBed.createComponent(LineChart);
    fixture.componentRef.setInput('points', [
      { label: '05 Jul', amountMinor: 3_000 },
      { label: '13 Jul', amountMinor: 2_000 },
    ]);
    fixture.componentRef.setInput('currency', 'MUR');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const canvas = host.querySelector('canvas');
    expect(canvas).not.toBeNull();
    const label = canvas?.getAttribute('aria-label') ?? '';
    expect(label).toContain('05 Jul');
    expect(label).toContain('13 Jul');
    // The old visually-hidden list rendered VISIBLY on the release Android WebView - it must not
    // come back (ux-blueprint.md section 7 WebView caveat).
    expect(host.querySelector('.visually-hidden')).toBeNull();
  });

  it('renders nothing catastrophic for an empty point list', () => {
    const fixture = TestBed.createComponent(LineChart);
    fixture.componentRef.setInput('points', []);
    fixture.componentRef.setInput('currency', 'MUR');
    expect(() => fixture.detectChanges()).not.toThrow();
    const host = fixture.nativeElement as HTMLElement;
    // Falls back to the plain region name when there is no data.
    expect(host.querySelector('canvas')?.getAttribute('aria-label')).toBe('Spend over time');
  });
});
