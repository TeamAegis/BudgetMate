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
    const items = Array.from(host.querySelectorAll('.visually-hidden li')).map((li) => li.textContent ?? '');
    // 7 kept categories + 1 "Other" = 8 rows, never a bare 10.
    expect(items.length).toBe(8);
    expect(items.some((t) => t.includes('Cat 7'))).toBe(true);
    expect(items.some((t) => t.includes('Cat 8'))).toBe(false, 'Cat 8 must be rolled into Other');
    const other = items.find((t) => t.startsWith('Other:'));
    expect(other).toBeDefined();
    // Cat 8 (305) + Cat 9 (204) + Cat 10 (101) = 610 minor = Rs 6.10.
    expect(other).toContain('6.10');

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
