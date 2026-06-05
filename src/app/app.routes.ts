import { Routes } from '@angular/router';

// Canonical IA (docs/design/ux-blueprint.md §2): bottom nav = Home · Expenses · Goals ·
// Analytics; Settings via the header icon. Budgets (Envelopes) and Import/Scan are nested
// actions reachable from Settings/Expenses — routed, but not in the bottom nav.
// Lazy-load `analytics` (charts) and `import` (OCR) so they don't block first paint (NFR-Perf2).
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: 'home',
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
  },
  {
    path: 'expenses',
    loadComponent: () =>
      import('./features/transactions/transactions').then((m) => m.Transactions),
  },
  {
    path: 'goals',
    loadComponent: () => import('./features/goals/goals').then((m) => m.Goals),
  },
  {
    path: 'analytics',
    loadComponent: () => import('./features/reports/reports').then((m) => m.Reports),
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
  },
  // Nested actions (not in the bottom nav).
  {
    path: 'budgets',
    loadComponent: () => import('./features/budgets/budgets').then((m) => m.Budgets),
  },
  {
    path: 'import',
    loadComponent: () => import('./features/import/import').then((m) => m.Import),
  },
  { path: '**', redirectTo: 'home' },
];
