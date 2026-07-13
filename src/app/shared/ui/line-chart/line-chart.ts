import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { ChartConfiguration, TooltipItem } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { chartColor } from '../../charts/chart-setup';
import { MoneyPipe } from '../../pipes/money.pipe';
import { CurrencyService } from '../../../core/money/currency.service';

/** One point on the spend-over-time line: a bucket label (Rust-formatted) + its total. */
export interface LinePoint {
  label: string;
  amountMinor: number;
}

/**
 * Spend-over-time line chart (FR-3.3, design-system §7 - bundled Chart.js/canvas). Dumb/
 * presentational: the parent supplies pre-bucketed points (Rust owns the date bucketing and
 * labels); this component only renders them. The single series carries an accessible
 * `seriesLabel` (Chart.js dataset label, read by the legend/tooltip) so the line's meaning is
 * never colour-alone; a visually-hidden list mirrors the same label/amount pairs for screen
 * readers. Amounts are scaled/labelled via `CurrencyService`/`MoneyPipe`, never a hand-rolled
 * `/100`. The caller must have run `registerCharts()` once (`shared/charts/chart-setup.ts`).
 */
@Component({
  selector: 'app-line-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseChartDirective, MoneyPipe],
  providers: [MoneyPipe],
  template: `
    <div class="chart-wrap">
      <canvas
        baseChart
        type="line"
        [data]="chartData()"
        [options]="chartOptions()"
        role="img"
        [attr.aria-label]="ariaLabel()"
      ></canvas>
    </div>
    <ul class="visually-hidden">
      @for (p of points(); track p.label) {
        <li>{{ p.label }}: {{ { amountMinor: p.amountMinor, currency: currency() } | money }}</li>
      }
    </ul>
  `,
  styleUrl: './line-chart.scss',
})
export class LineChart {
  private readonly currencyService = inject(CurrencyService);
  private readonly money = inject(MoneyPipe);

  readonly points = input.required<LinePoint[]>();
  readonly currency = input.required<string>();
  /** Accessible dataset/series name shown by the legend + tooltip (e.g. "Spend"). */
  readonly seriesLabel = input('Spend');
  /** Accessible name for the chart region (e.g. "Spend over time"). */
  readonly ariaLabel = input('Spend over time');

  protected readonly chartData = computed<ChartConfiguration<'line'>['data']>(() => {
    const points = this.points();
    const lineColor = chartColor('--chart-line');
    return {
      labels: points.map((p) => p.label),
      datasets: [
        {
          label: this.seriesLabel(),
          data: points.map((p) => this.currencyService.toMajor(p.amountMinor, this.currency())),
          borderColor: lineColor,
          backgroundColor: lineColor,
          pointBackgroundColor: lineColor,
          tension: 0.3,
          fill: false,
        },
      ],
    };
  });

  protected readonly chartOptions = computed<ChartConfiguration<'line'>['options']>(() => {
    const currency = this.currency();
    const points = this.points();
    const gridColor = chartColor('--chart-grid');
    return {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: gridColor }, beginAtZero: true },
      },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (item: TooltipItem<'line'>) => {
              const point = points[item.dataIndex];
              const amount = point ? this.money.transform({ amountMinor: point.amountMinor, currency }) : '';
              return `${this.seriesLabel()}: ${amount}`;
            },
          },
        },
      },
    };
  });
}
