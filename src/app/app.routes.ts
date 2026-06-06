import { Routes } from '@angular/router';
import { unlockGuard } from './core/lock/unlock.guard';

// Canonical IA (docs/design/ux-blueprint.md §2): bottom nav = Home · Expenses · Goals ·
// Analytics; Settings via the header icon. Budgets (Envelopes) and Import/Scan are nested
// actions reachable from Settings/Expenses — routed, but not in the bottom nav.
// Lazy-load `analytics` (charts) and `import` (OCR) so they don't block first paint (NFR-Perf2).
//
// `data.title` drives the AppHeader's titled variant; Home omits it so the header falls back to
// the "BudgetMate" brand wordmark. `data.back` shows the header's back affordance (pushed screens).
//
// `/setup` and `/unlock` are the only UNGUARDED routes (FR-5.1/5.2). Every feature route is gated
// by `unlockGuard`, so no DB-backed command runs before the vault is unlocked.
export const routes: Routes = [
  {
    path: 'setup',
    data: { chromeless: true },
    loadComponent: () => import('./features/lock/lock').then((m) => m.Lock),
  },
  {
    path: 'unlock',
    data: { chromeless: true },
    loadComponent: () => import('./features/lock/lock').then((m) => m.Lock),
  },
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: 'home',
    canActivate: [unlockGuard],
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
  },
  {
    path: 'expenses',
    canActivate: [unlockGuard],
    data: { title: 'Expenses' },
    loadComponent: () =>
      import('./features/transactions/transactions').then((m) => m.Transactions),
  },
  {
    path: 'goals',
    canActivate: [unlockGuard],
    data: { title: 'Goals' },
    loadComponent: () => import('./features/goals/goals').then((m) => m.Goals),
  },
  {
    path: 'analytics',
    canActivate: [unlockGuard],
    data: { title: 'Analytics' },
    loadComponent: () => import('./features/reports/reports').then((m) => m.Reports),
  },
  {
    path: 'settings',
    canActivate: [unlockGuard],
    data: { title: 'Settings', back: true },
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
  },
  {
    path: 'settings/accounts',
    canActivate: [unlockGuard],
    data: { title: 'Accounts', back: true },
    loadComponent: () => import('./features/accounts/accounts').then((m) => m.Accounts),
  },
  {
    path: 'settings/categories',
    canActivate: [unlockGuard],
    data: { title: 'Categories', back: true },
    loadComponent: () => import('./features/categories/categories').then((m) => m.Categories),
  },
  {
    path: 'settings/recurring',
    canActivate: [unlockGuard],
    data: { title: 'Recurring', back: true },
    loadComponent: () => import('./features/recurring/recurring').then((m) => m.Recurring),
  },
  {
    path: 'settings/rules',
    canActivate: [unlockGuard],
    data: { title: 'Rules', back: true },
    loadComponent: () => import('./features/rules/rules').then((m) => m.Rules),
  },
  // Nested actions (not in the bottom nav).
  {
    path: 'budgets',
    canActivate: [unlockGuard],
    data: { title: 'Budgets / Envelopes', back: true },
    loadComponent: () => import('./features/budgets/budgets').then((m) => m.Budgets),
  },
  {
    path: 'import',
    canActivate: [unlockGuard],
    data: { title: 'Import', back: true },
    loadComponent: () => import('./features/import/import').then((m) => m.Import),
  },
  { path: '**', redirectTo: 'home' },
];
