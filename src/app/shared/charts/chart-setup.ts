// Tree-shaken Chart.js registration. Import ONLY the controllers/elements/scales actually used
// (FR-3.3 / frontend rules) so the bundle stays small. ng2-charts uses the global Chart
// registry, so calling registerCharts() once at startup is enough.
//
// Currently registered: pie (spend by category) and line (spend over time) - extend here as new
// report types are added, never by importing all of Chart.js.

import {
  Chart,
  ArcElement,
  LineElement,
  PointElement,
  LineController,
  PieController,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
  Title,
} from 'chart.js';

let registered = false;

export function registerCharts(): void {
  if (registered) {
    return;
  }
  Chart.register(
    PieController,
    ArcElement,
    LineController,
    LineElement,
    PointElement,
    CategoryScale,
    LinearScale,
    Legend,
    Tooltip,
    Title,
  );
  registered = true;
}
