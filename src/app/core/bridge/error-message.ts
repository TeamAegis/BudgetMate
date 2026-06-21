import { asAppError } from '../models';

/**
 * Maps an error thrown by a bridge `invoke<T>()` call into a short, plain-language message safe to
 * show in an `<app-banner>`. The Rust core rejects with a tagged `AppError` whose `Display` text is
 * serialised across IPC; dumping that raw string into the UI leaks jargon ("ValidationError: …",
 * SQL/SQLCipher internals) that a low-financial-literacy user can't act on (ui-ux-principles §2.9).
 *
 * Presentation-only: this does NOT change the IPC protocol or the bridge wrappers - it just
 * translates known patterns at the catch site and falls back to a friendly generic message.
 * Feature components call this in their `catch (e)` blocks instead of `String(e)`.
 */
export function toUserMessage(e: unknown): string {
  const err = asAppError(e);
  // Typed kinds map directly, no string-matching needed.
  if (err.kind === 'locked') return 'The app is locked. Unlock it and try again.';
  if (err.kind === 'keyVerificationFailed') return 'Incorrect passphrase. Check it and try again.';

  // Validation/database/internal: fall back to the message-text heuristics (the message carries the
  // specific reason from the Rust domain layer).
  const raw = (err.message || rawText(e)).trim();
  if (!raw) return GENERIC;

  const lower = raw.toLowerCase();

  // The DB is locked / passphrase not yet supplied - the user should unlock and retry.
  if (lower.includes('locked') || lower.includes('not unlocked') || lower.includes('no key')) {
    return 'The app is locked. Unlock it and try again.';
  }
  // Split amounts that don't add up to the parent total (FR-1.2 invariant).
  if (lower.includes('split') && (lower.includes('sum') || lower.includes('total') || lower.includes('balance'))) {
    return "The split amounts don't add up to the total. Adjust them and try again.";
  }
  // A duplicate / uniqueness conflict (e.g. a name already in use).
  if (lower.includes('unique') || lower.includes('duplicate') || lower.includes('already exists')) {
    return 'That already exists. Use a different name.';
  }
  // Foreign-key / referenced-row failures (e.g. archiving something still in use).
  if (lower.includes('foreign key') || lower.includes('still in use') || lower.includes('in use')) {
    return "This is still in use, so it can't be changed right now.";
  }
  // Not-found (a row was removed in another view before this action ran).
  if (lower.includes('not found') || lower.includes('no such') || lower.includes('missing')) {
    return "We couldn't find that - it may have been removed. Refresh and try again.";
  }
  // Generic validation failures from the domain layer.
  if (lower.includes('invalid') || lower.includes('validation') || lower.includes('must ')) {
    return 'Some of the details look off. Check the form and try again.';
  }

  return GENERIC;
}

const GENERIC = 'Something went wrong - please try again.';

/** Best-effort extraction of a string from whatever a rejected `invoke` produced. */
function rawText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>;
    if (typeof obj['message'] === 'string') return obj['message'];
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}
