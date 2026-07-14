import { Routes } from '@angular/router';
import { unlockGuard } from './core/lock/unlock.guard';

// Canonical IA (docs/design/ux-blueprint.md §2): bottom nav = Home · Expenses · Goals ·
// Analytics; Settings via the header icon. Budgets (Envelopes) and Import/Scan are nested
// actions reachable from Settings/Expenses - routed, but not in the bottom nav.
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
    // Step 1a: choose what to record (expense / income). The category, picked next, carries the
    // type, so the form needs no type toggle. See ADR 0004 (two-step add) and screens.md 8.0.
    path: 'expenses/new',
    canActivate: [unlockGuard],
    data: { title: 'Add', back: true, hideNav: true },
    loadComponent: () =>
      import('./features/transactions/transaction-kind').then((m) => m.TransactionKind),
  },
  {
    // Step 1b: pick a category within the chosen kind. Title reflects the branch.
    path: 'expenses/new/:kind',
    canActivate: [unlockGuard],
    data: {
      title: (p: { kind?: string }) => (p.kind === 'income' ? 'Income' : 'Expense'),
      back: true,
      hideNav: true,
    },
    loadComponent: () =>
      import('./features/transactions/category-picker').then((m) => m.CategoryPicker),
  },
  {
    // Step 2: the entry form, category preset from the URL (categoryId `0` = not yet chosen, e.g.
    // the scan path). The picked category is shown, not re-picked - tapping it reopens the picker.
    path: 'expenses/new/:kind/:categoryId',
    canActivate: [unlockGuard],
    data: {
      title: (p: { kind?: string }) => (p.kind === 'income' ? 'New income' : 'New expense'),
      back: true,
      hideNav: true,
    },
    loadComponent: () =>
      import('./features/transactions/transaction-form').then((m) => m.TransactionForm),
  },
  {
    path: 'expenses/:id/edit',
    canActivate: [unlockGuard],
    data: { title: 'Edit expense', back: true, hideNav: true },
    loadComponent: () =>
      import('./features/transactions/transaction-form').then((m) => m.TransactionForm),
  },
  {
    // Read-only detail (issue I5): the list card taps here; Edit -> :id/edit, Delete = header icon.
    // Declared AFTER expenses/new* so the literal add routes still win over this :id param route.
    path: 'expenses/:id',
    canActivate: [unlockGuard],
    data: { title: 'Transaction', back: true, hideNav: true },
    loadComponent: () =>
      import('./features/transactions/transaction-detail').then((m) => m.TransactionDetail),
  },
  {
    path: 'goals',
    canActivate: [unlockGuard],
    data: { title: 'Goals' },
    loadComponent: () => import('./features/goals/goals').then((m) => m.Goals),
  },
  {
    path: 'goals/new',
    canActivate: [unlockGuard],
    data: { title: 'Add goal', back: true, hideNav: true },
    loadComponent: () => import('./features/goals/goal-form').then((m) => m.GoalForm),
  },
  {
    path: 'goals/:id/edit',
    canActivate: [unlockGuard],
    data: { title: 'Edit goal', back: true, hideNav: true },
    loadComponent: () => import('./features/goals/goal-form').then((m) => m.GoalForm),
  },
  {
    // Read-only detail (issue I5); declared after goals/new so the literal add route still wins.
    path: 'goals/:id',
    canActivate: [unlockGuard],
    data: { title: 'Goal', back: true, hideNav: true },
    loadComponent: () => import('./features/goals/goal-detail').then((m) => m.GoalDetail),
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
    path: 'settings/accounts/new',
    canActivate: [unlockGuard],
    data: { title: 'Add account', back: true, hideNav: true },
    loadComponent: () => import('./features/accounts/account-form').then((m) => m.AccountForm),
  },
  {
    path: 'settings/accounts/:id/edit',
    canActivate: [unlockGuard],
    data: { title: 'Edit account', back: true, hideNav: true },
    loadComponent: () => import('./features/accounts/account-form').then((m) => m.AccountForm),
  },
  {
    path: 'settings/categories',
    canActivate: [unlockGuard],
    data: { title: 'Categories', back: true },
    loadComponent: () => import('./features/categories/categories').then((m) => m.Categories),
  },
  {
    path: 'settings/categories/new',
    canActivate: [unlockGuard],
    data: { title: 'Add category', back: true, hideNav: true },
    loadComponent: () => import('./features/categories/category-form').then((m) => m.CategoryForm),
  },
  {
    path: 'settings/categories/:id/edit',
    canActivate: [unlockGuard],
    data: { title: 'Edit category', back: true, hideNav: true },
    loadComponent: () => import('./features/categories/category-form').then((m) => m.CategoryForm),
  },
  {
    path: 'settings/recurring',
    canActivate: [unlockGuard],
    data: { title: 'Recurring', back: true },
    loadComponent: () => import('./features/recurring/recurring').then((m) => m.Recurring),
  },
  {
    path: 'settings/recurring/new',
    canActivate: [unlockGuard],
    data: { title: 'Add recurring', back: true, hideNav: true },
    loadComponent: () => import('./features/recurring/recurring-form').then((m) => m.RecurringForm),
  },
  {
    path: 'settings/recurring/:id/edit',
    canActivate: [unlockGuard],
    data: { title: 'Edit recurring', back: true, hideNav: true },
    loadComponent: () => import('./features/recurring/recurring-form').then((m) => m.RecurringForm),
  },
  {
    path: 'settings/rules',
    canActivate: [unlockGuard],
    data: { title: 'Rules', back: true },
    loadComponent: () => import('./features/rules/rules').then((m) => m.Rules),
  },
  {
    path: 'settings/rules/new',
    canActivate: [unlockGuard],
    data: { title: 'Add rule', back: true, hideNav: true },
    loadComponent: () => import('./features/rules/rule-form').then((m) => m.RuleForm),
  },
  {
    path: 'settings/rules/:id/edit',
    canActivate: [unlockGuard],
    data: { title: 'Edit rule', back: true, hideNav: true },
    loadComponent: () => import('./features/rules/rule-form').then((m) => m.RuleForm),
  },
  {
    path: 'settings/export',
    canActivate: [unlockGuard],
    data: { title: 'Export', back: true, hideNav: true },
    loadComponent: () => import('./features/settings/export/export').then((m) => m.Export),
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
