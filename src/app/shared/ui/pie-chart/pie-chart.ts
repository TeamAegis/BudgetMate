import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { ChartConfiguration, TooltipItem } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { categoricalChartPalette } from '../../charts/chart-setup';
import { MoneyPipe } from '../../pipes/money.pipe';
import { CurrencyService } from '../../../core/money/currency.service';

/** One pie slice: a category label + its already-aggregated total (Rust computes the sum). */
export interface PieSlice {
  label: string;
  amountMinor: number;
}

/**
 * Spend-by-category pie chart (FR-3.3, design-system §7 - bundled Chart.js/canvas, never a static
 * image). Dumb/presentational: the parent (Analytics) supplies pre-aggregated slices; this
 * component only renders them. The Chart.js legend gives every slice a text label so meaning is
 * never colour-alone (design.md a11y); a visually-hidden list mirrors the same label/amount pairs
 * for screen readers, since a `<canvas>` chart itself exposes nothing to assistive tech. Amounts are
 * scaled/labelled via `CurrencyService`/`MoneyPipe` - never a hand-rolled `/100`. The caller must
 * have run `registerCharts()` once (`shared/charts/chart-setup.ts`) before this renders.
 */
@Component({
  selector: 'app-pie-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseChartDirective, MoneyPipe],
  providers: [MoneyPipe],
  template: `
    <div class="chart-wrap">
      <canvas
        baseChart
        type="pie"
        [data]="chartData()"
        [options]="chartOptions()"
        role="img"
        [attr.aria-label]="ariaLabel()"
      ></canvas>
    </div>
    <ul class="visually-hidden">
      @for (s of slices(); track s.label) {
        <li>{{ s.label }}: {{ { amountMinor: s.amountMinor, currency: currency() } | money }}</li>
      }
    </ul>
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

  protected readonly chartData = computed<ChartConfiguration<'pie'>['data']>(() => {
    const palette = categoricalChartPalette();
    const slices = this.slices();
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
    const slices = this.slices();
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12 } },
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
