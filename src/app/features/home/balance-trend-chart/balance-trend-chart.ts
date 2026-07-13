import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LineChart, type LinePoint } from '../../../shared/ui/line-chart/line-chart';
import { registerCharts } from '../../../shared/charts/chart-setup';

/**
 * Home's balance-trend chart, split into its OWN standalone component so Chart.js never enters
 * Home's initial chunk (Home is the eager landing route - cold-start budget, `.claude/rules/
 * frontend.md`). The route template references this component ONLY inside an `@defer (on
 * viewport)` block, so Angular code-splits it (and `LineChart` + Chart.js) into a lazy chunk loaded
 * when the chart scrolls into view - never imported/referenced anywhere else in `home.ts`.
 * `registerCharts()` runs here (not in `home.ts`) for the same reason.
 */
@Component({
  selector: 'app-balance-trend-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LineChart],
  template: `
    <app-line-chart
      [points]="points()"
      [currency]="currency()"
      seriesLabel="Balance"
      ariaLabel="Your balance, end of each month"
    />
  `,
})
export class BalanceTrendChart {
  readonly points = input.required<LinePoint[]>();
  readonly currency = input.required<string>();

  constructor() {
    registerCharts();
  }
}
