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

/**
 * Resolve a CSS custom property (design token) to its computed colour string. Chart.js draws to a
 * `<canvas>` 2D context, which (unlike CSS box properties) does NOT resolve `var(--x)` itself, so
 * chart colours must be read from the live computed style once rather than passed as raw `var(...)`
 * strings. Still token-driven - this is the one place that resolves a token to a literal value for
 * the canvas API, never a hardcoded hex in a component.
 */
export function chartColor(varName: string, fallback = '#000000'): string {
  if (typeof document === 'undefined') {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || fallback;
}

/** The categorical palette for per-category chart slices (`--chart-cat-1`..`--chart-cat-8`). */
export function categoricalChartPalette(): string[] {
  return Array.from({ length: 8 }, (_, i) => chartColor(`--chart-cat-${i + 1}`));
}
