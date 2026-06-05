import { Component, OnInit, signal } from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import type { ChartConfiguration, ChartData } from 'chart.js';
import { registerCharts } from '../../shared/charts/chart-setup';

@Component({
  selector: 'app-reports',
  imports: [BaseChartDirective],
  template: `
    <section class="feature-page">
      <p class="muted">
        Pie (spend by category) and line (spend over time) from Rust-side aggregations (FR-3.3).
        Chart.js is bundled locally and tree-shaken; data below is placeholder until the
        aggregation commands land.
      </p>
      <div class="chart-card">
        <canvas baseChart type="pie" [data]="pieData()" [options]="pieOptions"></canvas>
      </div>
    </section>
  `,
  styles: `
    .feature-page {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .muted {
      color: var(--c-text-muted);
    }
    .chart-card {
      max-width: 360px;
      padding: var(--space-5);
      background: var(--c-surface);
      border: 1px solid var(--c-border);
      border-radius: var(--radius-md);
      box-shadow: var(--elev-card);
    }
  `,
})
export class Reports implements OnInit {
  protected readonly pieOptions: ChartConfiguration<'pie'>['options'] = {
    responsive: true,
    plugins: { legend: { position: 'bottom' } },
  };

  protected readonly pieData = signal<ChartData<'pie'>>({
    labels: ['Groceries', 'Transport', 'Rent'],
    datasets: [{ data: [0, 0, 0] }],
  });

  ngOnInit(): void {
    registerCharts();
  }
}
