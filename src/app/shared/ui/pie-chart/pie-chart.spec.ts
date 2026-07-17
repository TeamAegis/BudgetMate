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

  it('renders a canvas whose aria-label carries every slice label/amount (no hidden DOM list)', () => {
    const fixture = TestBed.createComponent(PieChart);
    fixture.componentRef.setInput('slices', [
      { label: 'Groceries', amountMinor: 3_000 },
      { label: 'Dining', amountMinor: 2_000 },
    ]);
    fixture.componentRef.setInput('currency', 'MUR');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const canvas = host.querySelector('canvas');
    expect(canvas).not.toBeNull();
    const label = canvas?.getAttribute('aria-label') ?? '';
    expect(label).toContain('Groceries');
    expect(label).toContain('Dining');
    // The old visually-hidden list rendered VISIBLY on the release Android WebView - it must not
    // come back (ux-blueprint.md section 7 WebView caveat).
    expect(host.querySelector('.visually-hidden')).toBeNull();
  });

  it('renders nothing catastrophic for an empty slice list', () => {
    const fixture = TestBed.createComponent(PieChart);
    fixture.componentRef.setInput('slices', []);
    fixture.componentRef.setInput('currency', 'MUR');
    expect(() => fixture.detectChanges()).not.toThrow();
    const host = fixture.nativeElement as HTMLElement;
    // Falls back to the plain region name when there is no data.
    expect(host.querySelector('canvas')?.getAttribute('aria-label')).toBe('Spend by category');
  });

  it('more than 8 categories: rolls the overflow up into a single "Other" slice, not a reused hue', () => {
    const fixture = TestBed.createComponent(PieChart);
    // 10 categories, descending amount (as Rust's spend_by_category already sorts them) - only the
    // palette's 8 hues are distinct, so categories 8-10 (300/200/100) must collapse into "Other".
    fixture.componentRef.setInput('slices', [
      { label: 'Cat 1', amountMinor: 1_000 },
      { label: 'Cat 2', amountMinor: 900 },
      { label: 'Cat 3', amountMinor: 800 },
      { label: 'Cat 4', amountMinor: 700 },
      { label: 'Cat 5', amountMinor: 600 },
      { label: 'Cat 6', amountMinor: 500 },
      { label: 'Cat 7', amountMinor: 400 },
      { label: 'Cat 8', amountMinor: 305 },
      { label: 'Cat 9', amountMinor: 204 },
      { label: 'Cat 10', amountMinor: 101 },
    ]);
    fixture.componentRef.setInput('currency', 'MUR');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const label = host.querySelector('canvas')?.getAttribute('aria-label') ?? '';
    // 7 kept categories + 1 "Other" - never a bare 10.
    expect(label).toContain('Cat 7');
    expect(label).not.toContain('Cat 8');
    expect(label).toContain('Other');
    // Cat 8 (305) + Cat 9 (204) + Cat 10 (101) = 610 minor = Rs 6.10.
    expect(label).toContain('6.10');

    const component = fixture.componentInstance as unknown as {
      displaySlices: { (): { label: string; amountMinor: number }[] };
    };
    expect(component.displaySlices().length).toBe(8);
    expect(component.displaySlices()[7]).toEqual({ label: 'Other', amountMinor: 610 });
  });

  it('exactly 8 categories: no rollup, every category keeps its own slice', () => {
    const fixture = TestBed.createComponent(PieChart);
    const slices = Array.from({ length: 8 }, (_, i) => ({ label: `Cat ${i + 1}`, amountMinor: 100 * (8 - i) }));
    fixture.componentRef.setInput('slices', slices);
    fixture.componentRef.setInput('currency', 'MUR');
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      displaySlices: { (): { label: string; amountMinor: number }[] };
    };
    expect(component.displaySlices()).toEqual(slices);
  });
});
