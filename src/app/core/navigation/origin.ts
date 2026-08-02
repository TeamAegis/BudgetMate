import type { Router } from '@angular/router';

/** Router nav-state key carrying the URL a form was opened from. */
const ORIGIN_KEY = 'origin';

/**
 * "Return where you came from" for the add/edit form pages.
 *
 * Every list -> form hand-off already passes the entity through router nav `state` (so the form does
 * not refetch a row the list already has). This piggybacks on that same mechanism: the opener also
 * stamps the URL it is on, and on save/delete the form returns *there* instead of always bouncing to
 * its own feature list.
 *
 * The problem it solves: the Home quick-add and the allowance/goal previews can open a form that
 * belongs to another feature. Saving used to land you on that feature's list (`/allowances`), losing
 * your place, even though you started on Home.
 *
 * This is only for the post-save/delete destination. The back arrow stays history-based
 * (`Location.back()`, ADR 0004) - Cancel should unwind the way the user actually came, which history
 * already does correctly. Compare `core/layout/nav-tab.service.ts`, which answers the different
 * question of which tab owns the screen you are on.
 */

/** Nav-state fragment to spread into a `router.navigate` call when opening a form. */
export function withOrigin(router: Router, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...extra, [ORIGIN_KEY]: router.url };
}

/**
 * Read the origin URL stamped by the opener, if any.
 *
 * MUST be called during construction/field initialisation, while `getCurrentNavigation()` is still
 * the navigation that created the component - the same constraint the existing entity hand-offs
 * work under (see transaction-form's `passedTx`).
 */
export function readOrigin(router: Router): string | null {
  const value = router.getCurrentNavigation()?.extras.state?.[ORIGIN_KEY];
  // Only accept an in-app absolute path. Anything else (absent, wrong type, or an off-app URL) falls
  // back to the caller's own list, so a malformed value can never navigate somewhere unexpected.
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : null;
}

/**
 * Where a form should go after a successful save/delete: the stamped origin, else its own list.
 *
 * @param origin the value captured by `readOrigin` at construction time
 * @param fallback the feature's own list route (e.g. `/allowances`)
 */
export function returnTo(origin: string | null, fallback: string): string {
  return origin ?? fallback;
}
