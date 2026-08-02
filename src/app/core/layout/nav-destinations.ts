/**
 * The app's SECONDARY destinations - the money-setup and data screens that are not one of the four
 * bottom-nav tabs (`nav-tab.service.ts`).
 *
 * Why this file exists: these screens used to be reachable only by opening Settings and scrolling,
 * which read as "hidden" - Nielsen Norman Group measure a ~21% drop in task completion for
 * destinations a user cannot see, and Settings is where people look for *preferences*, not for
 * Allowances or Budgets. They are now surfaced by the NavDrawer (ADR 0013) as well, and BOTH
 * surfaces render from this one list so a new destination cannot appear in one and be forgotten in
 * the other.
 *
 * This list holds only NAVIGATION rows. Settings' control rows (base currency, duplicate-detection
 * window, auto-lock) are preference widgets, not destinations, and stay in `features/settings`.
 */

/** Glyph key for a destination. Rendered by a `@switch` in each host so only the icons actually
 *  used are imported (lucide icons are attribute directives and tree-shaken per component). The
 *  same destination uses the SAME glyph in the drawer and in Settings. */
export type NavDestinationIcon =
  | 'accounts'
  | 'transfer'
  | 'categories'
  | 'budgets'
  | 'allowances'
  | 'recurring'
  | 'rules'
  | 'import'
  | 'export'
  | 'backup'
  | 'settings';

/** One secondary destination: a label, a plain-language hint, a route, and a glyph. */
export interface NavDestination {
  /** Stable id, used as the `@for` track key. */
  readonly id: string;
  /** Plain-language label. Never a bare piece of jargon (`.claude/rules/design.md` glossary). */
  readonly label: string;
  /** One-line explanation of what the screen is for, in plain language. */
  readonly hint: string;
  readonly route: string;
  readonly icon: NavDestinationIcon;
}

/**
 * Money setup and data. Ordered by how often someone reaches for it, not alphabetically:
 * Allowances and Budgets lead because they are the two the user singled out as buried.
 */
export const MONEY_DESTINATIONS: readonly NavDestination[] = [
  {
    id: 'allowances',
    label: 'Allowances',
    hint: 'Set aside savings for spending you know is coming',
    route: '/allowances',
    icon: 'allowances',
  },
  {
    id: 'budgets',
    label: 'Budgets',
    hint: 'Set a monthly limit per category',
    route: '/budgets',
    icon: 'budgets',
  },
  {
    id: 'accounts',
    label: 'Accounts',
    hint: 'Cash, bank, card or wallet',
    route: '/settings/accounts',
    icon: 'accounts',
  },
  {
    id: 'transfer',
    label: 'Move money',
    hint: 'Shift money between your own accounts',
    route: '/transfers/new',
    icon: 'transfer',
  },
  {
    id: 'categories',
    label: 'Categories',
    hint: 'Group your spending and income',
    route: '/settings/categories',
    icon: 'categories',
  },
  {
    id: 'recurring',
    label: 'Recurring',
    hint: 'Bills and income that repeat',
    route: '/settings/recurring',
    icon: 'recurring',
  },
  {
    id: 'rules',
    label: 'Rules',
    hint: 'Auto-categorise by merchant',
    route: '/settings/rules',
    icon: 'rules',
  },
  {
    id: 'import',
    label: 'Import transactions',
    hint: 'Bring in a CSV bank statement',
    route: '/import/file',
    icon: 'import',
  },
];

/** Your data, plus the way into preferences. */
export const GENERAL_DESTINATIONS: readonly NavDestination[] = [
  {
    id: 'export',
    label: 'Export',
    hint: 'Save your transactions as a CSV or Excel file',
    route: '/settings/export',
    icon: 'export',
  },
  {
    id: 'backup',
    label: 'Backup',
    hint: 'Save an encrypted copy of your data',
    route: '/settings/backup',
    icon: 'backup',
  },
];

/**
 * Settings itself. Listed for the drawer only - Settings must not link to itself, so
 * `features/settings` renders `GENERAL_DESTINATIONS` without this row.
 */
export const SETTINGS_DESTINATION: NavDestination = {
  id: 'settings',
  label: 'Settings',
  hint: 'Currency, duplicate detection and auto-lock',
  route: '/settings',
  icon: 'settings',
};
