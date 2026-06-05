import { Routes } from '@angular/router';

// Canonical IA (docs/design/ux-blueprint.md §2): bottom nav = Home · Expenses · Goals ·
// Analytics; Settings via the header icon. Budgets (Envelopes) and Import/Scan are nested
// actions reachable from Settings/Expenses — routed, but not in the bottom nav.
// Lazy-load `analytics` (charts) and `import` (OCR) so they don't block first paint (NFR-Perf2).
//
// `data.title` drives the AppHeader's titled variant; Home omits it so the header falls back to
// the "BudgetMate" brand wordmark. `data.back` shows the header's back affordance (pushed screens).
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: 'home',
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
  },
  {
    path: 'expenses',
    data: { title: 'Expenses' },
    loadComponent: () =>
      import('./features/transactions/transactions').then((m) => m.Transactions),
  },
  {
    path: 'goals',
    data: { title: 'Goals' },
    loadComponent: () => import('./features/goals/goals').then((m) => m.Goals),
  },
  {
    path: 'analytics',
    data: { title: 'Analytics' },
    loadComponent: () => import('./features/reports/reports').then((m) => m.Reports),
  },
  {
    path: 'settings',
    data: { title: 'Settings', back: true },
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
  },
  {
    path: 'settings/accounts',
    data: { title: 'Accounts', back: true },
    loadComponent: () => import('./features/accounts/accounts').then((m) => m.Accounts),
  },
  {
    path: 'settings/categories',
    data: { title: 'Categories', back: true },
    loadComponent: () => import('./features/categories/categories').then((m) => m.Categories),
  },
  // Nested actions (not in the bottom nav).
  {
    path: 'budgets',
    data: { title: 'Budgets / Envelopes', back: true },
    loadComponent: () => import('./features/budgets/budgets').then((m) => m.Budgets),
  },
  {
    path: 'import',
    data: { title: 'Import', back: true },
    loadComponent: () => import('./features/import/import').then((m) => m.Import),
  },
  { path: '**', redirectTo: 'home' },
];
