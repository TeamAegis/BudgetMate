import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { ChartConfiguration, TooltipItem } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { chartColor, prefersReducedMotion } from '../../charts/chart-setup';
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
 * never colour-alone; the canvas `aria-label` carries the same label/amount pairs for screen
 * readers. Do NOT reintroduce a `visually-hidden` DOM list here - the release Android System
 * WebView has rendered such nodes visibly (the Home "Feb: Rs 0..." bug). Amounts are
 * scaled/labelled via `CurrencyService`/`MoneyPipe`, never a hand-rolled `/100`. The caller
 * must have run `registerCharts()` once (`shared/charts/chart-setup.ts`).
 */
@Component({
  selector: 'app-line-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseChartDirective],
  providers: [MoneyPipe],
  template: `
    <div class="chart-wrap">
      <canvas
        baseChart
        type="line"
        [data]="chartData()"
        [options]="chartOptions()"
        role="img"
        [attr.aria-label]="canvasAriaLabel()"
      ></canvas>
    </div>
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

  /** The canvas' full accessible name: region name + every label/amount pair. This replaces the
   *  old visually-hidden `<ul>` (which the release Android WebView rendered visibly). */
  protected readonly canvasAriaLabel = computed<string>(() => {
    const currency = this.currency();
    const parts = this.points().map(
      (p) => `${p.label} ${this.money.transform({ amountMinor: p.amountMinor, currency })}`,
    );
    return parts.length ? `${this.ariaLabel()}: ${parts.join(', ')}` : this.ariaLabel();
  });

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
    const tickColor = chartColor('--c-text-muted');
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: prefersReducedMotion() ? false : undefined,
      scales: {
        x: { grid: { display: false }, ticks: { color: tickColor } },
        y: { grid: { color: gridColor }, beginAtZero: true, ticks: { color: tickColor } },
      },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 12, color: tickColor } },
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
