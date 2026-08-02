import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { ChartConfiguration, TooltipItem } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { categoricalChartPalette, chartColor, prefersReducedMotion } from '../../charts/chart-setup';
import { MoneyPipe } from '../../pipes/money.pipe';
import { CurrencyService } from '../../../core/money/currency.service';

/** One pie slice: a category label + its already-aggregated total (Rust computes the sum). */
export interface PieSlice {
  label: string;
  amountMinor: number;
}

/** Rollup label for categories beyond the palette (design-system §2.5 `--chart-cat-8`). */
const OTHER_LABEL = 'Other';

/**
 * Spend-by-category pie chart (FR-3.3, design-system §7 - bundled Chart.js/canvas, never a static
 * image). Dumb/presentational: the parent (Analytics) supplies pre-aggregated slices (already
 * sorted highest-spend-first by Rust); this component only renders them. The Chart.js legend gives
 * every slice a text label so meaning is never colour-alone (design.md a11y); the canvas
 * `aria-label` carries the same label/amount pairs for screen readers, since a `<canvas>` chart
 * itself exposes nothing to assistive tech. Do NOT reintroduce a `visually-hidden` DOM list here -
 * the release Android System WebView has rendered such nodes visibly. Amounts are scaled/labelled
 * via `CurrencyService`/`MoneyPipe` - never a hand-rolled `/100`. The caller must have run
 * `registerCharts()` once (`shared/charts/chart-setup.ts`) before this renders.
 *
 * **"Other" rollup:** when there are more categories than distinct palette hues
 * (`--chart-cat-1`..`--chart-cat-8`), the top `palette.length - 1` slices by amount are kept as-is
 * and every remaining category is summed into one trailing "Other" slice, rendered with the last
 * palette colour (`--chart-cat-8`, the documented overflow bucket) - a 9th+ category never silently
 * reuses an earlier slice's hue.
 */
@Component({
  selector: 'app-pie-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseChartDirective],
  providers: [MoneyPipe],
  template: `
    <div class="chart-wrap">
      <canvas
        baseChart
        type="pie"
        [data]="chartData()"
        [options]="chartOptions()"
        role="img"
        [attr.aria-label]="canvasAriaLabel()"
      ></canvas>
    </div>
  `,
  styleUrl: './pie-chart.scss',
})
export class PieChart {
  private readonly currencyService = inject(CurrencyService);
  private readonly money = inject(MoneyPipe);

  readonly slices = input.required<PieSlice[]>();
  readonly currency = input.required<string>();
  /** Accessible name for the chart region (e.g. "Spend by category"). */
  readonly ariaLabel = input('Spend by category');

  /** The canvas' full accessible name: region name + every slice's label/amount pair. Replaces
   *  the old visually-hidden `<ul>` (which the release Android WebView rendered visibly). */
  protected readonly canvasAriaLabel = computed<string>(() => {
    const currency = this.currency();
    const parts = this.displaySlices().map(
      (s) => `${s.label} ${this.money.transform({ amountMinor: s.amountMinor, currency })}`,
    );
    return parts.length ? `${this.ariaLabel()}: ${parts.join(', ')}` : this.ariaLabel();
  });

  /** `slices()` with any categories beyond the palette collapsed into one "Other" slice. */
  protected readonly displaySlices = computed<PieSlice[]>(() => {
    const slices = this.slices();
    const paletteSize = categoricalChartPalette().length;
    if (slices.length <= paletteSize) {
      return slices;
    }
    const kept = slices.slice(0, paletteSize - 1);
    const rolledUp = slices.slice(paletteSize - 1);
    const otherTotal = rolledUp.reduce((sum, s) => sum + s.amountMinor, 0);
    return [...kept, { label: OTHER_LABEL, amountMinor: otherTotal }];
  });

  protected readonly chartData = computed<ChartConfiguration<'pie'>['data']>(() => {
    const palette = categoricalChartPalette();
    const slices = this.displaySlices();
    return {
      labels: slices.map((s) => s.label),
      datasets: [
        {
          data: slices.map((s) => this.currencyService.toMajor(s.amountMinor, this.currency())),
          backgroundColor: slices.map((_, i) => palette[i % palette.length]),
          borderWidth: 0,
        },
      ],
    };
  });

  protected readonly chartOptions = computed<ChartConfiguration<'pie'>['options']>(() => {
    const currency = this.currency();
    const slices = this.displaySlices();
    const legendColor = chartColor('--c-text-muted');
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: prefersReducedMotion() ? false : undefined,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, color: legendColor } },
        tooltip: {
          callbacks: {
            label: (item: TooltipItem<'pie'>) => {
              const slice = slices[item.dataIndex];
              const amount = slice ? this.money.transform({ amountMinor: slice.amountMinor, currency }) : '';
              return `${item.label}: ${amount}`;
            },
          },
        },
      },
    };
  });
}
