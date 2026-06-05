import { Routes } from '@angular/router';

// Lazy-load `import` (OCR) and `reports` (charts) so they don't block first paint / cold start
// (NFR-Perf2, frontend rules). The lighter CRUD features are eagerly available.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'transactions' },
  {
    path: 'transactions',
    loadComponent: () =>
      import('./features/transactions/transactions').then((m) => m.Transactions),
  },
  {
    path: 'budgets',
    loadComponent: () => import('./features/budgets/budgets').then((m) => m.Budgets),
  },
  {
    path: 'goals',
    loadComponent: () => import('./features/goals/goals').then((m) => m.Goals),
  },
  {
    path: 'reports',
    loadComponent: () => import('./features/reports/reports').then((m) => m.Reports),
  },
  {
    path: 'import',
    loadComponent: () => import('./features/import/import').then((m) => m.Import),
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
  },
  { path: '**', redirectTo: 'transactions' },
];
