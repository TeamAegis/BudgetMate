import { Injectable, signal } from '@angular/core';

/** The four bottom-nav tabs (design-system §7 / ux-blueprint §2 - one canonical label set). */
export type NavTab = 'home' | 'expenses' | 'goals' | 'analytics';

/** Tab roots, in the order the bottom nav shows them. */
const TAB_ROOTS: readonly NavTab[] = ['home', 'expenses', 'goals', 'analytics'];

/**
 * Which tab owns each routed area that is NOT itself a tab root (app.routes.ts calls these "nested
 * actions"). Keyed by first path segment, so it covers every child route in one entry and a new
 * `/settings/whatever` page inherits the right tab without touching this file.
 *
 * - `settings`, `budgets`, `allowances` -> **home**: Settings opens from the Home header gear, and
 *   budgets/allowances are money setup reachable from Settings and the Home quick-add.
 * - `import` -> **expenses**: scanning a receipt or importing a statement produces transactions.
 *
 * A route can override its entry with `data.tab` (checked first) when one page genuinely belongs
 * somewhere else.
 */
const AREA_OWNER: Readonly<Record<string, NavTab>> = {
  settings: 'home',
  budgets: 'home',
  allowances: 'home',
  import: 'expenses',
};

/**
 * Tracks which bottom-nav tab the current screen belongs to, so a pushed screen keeps its tab lit
 * instead of leaving the nav with nothing selected.
 *
 * Why this exists: the bottom nav used to derive "active" purely from `routerLinkActive`, i.e. from
 * the URL prefix. That works for `/expenses/5/edit` (still under `/expenses`) but fails for every
 * route that lives outside the four tab prefixes - `/settings/**`, `/budgets/**`, `/allowances/**`,
 * `/import/**` - where NO tab matched and the nav appeared to lose its place.
 *
 * Resolution order, applied by the shell on each `NavigationEnd`:
 * 1. the deepest active route's `data.tab`, when a route explicitly overrides its owner;
 * 2. otherwise the URL's first segment, when it is itself a tab root (`/expenses/5/edit` -> expenses);
 * 3. otherwise that segment's entry in `AREA_OWNER` (`/settings/rules/new` -> home);
 * 4. otherwise `null` (no tab lit - correct for the chromeless lock screens).
 *
 * This deliberately does NOT touch the back affordance. Back stays history-based
 * (`Location.back()`, ADR 0004) because a screen can be reached from several places; the owning tab
 * is about *where you are*, not *where you came from*. For "return to where you came from" after a
 * save, see `core/navigation/origin.ts`.
 */
@Injectable({ providedIn: 'root' })
export class NavTabService {
  /** The tab to render as active, or null when no tab owns the current screen. */
  readonly activeTab = signal<NavTab | null>(null);

  /**
   * Resolve and publish the owning tab.
   *
   * @param declaredTab the deepest active route's `data.tab`, if it declared one
   * @param url the current URL (query/fragment tolerated)
   */
  sync(declaredTab: unknown, url: string): void {
    this.activeTab.set(asNavTab(declaredTab) ?? tabFromUrl(url));
  }
}

/** Narrow an untyped `route.data` value to a NavTab, ignoring anything unrecognised. */
function asNavTab(value: unknown): NavTab | null {
  return typeof value === 'string' && (TAB_ROOTS as readonly string[]).includes(value)
    ? (value as NavTab)
    : null;
}

/**
 * Resolve the owning tab from the URL: a tab root matches itself, otherwise fall back to the
 * area-ownership map. Returns null for anything unowned (e.g. `/unlock`).
 */
function tabFromUrl(url: string): NavTab | null {
  const first = url.split(/[?#]/)[0]!.split('/').filter(Boolean)[0];
  if (!first) return null;
  return asNavTab(first) ?? AREA_OWNER[first] ?? null;
}
