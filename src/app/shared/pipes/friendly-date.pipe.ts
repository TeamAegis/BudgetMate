import { Pipe, PipeTransform } from '@angular/core';

/** Deterministic month abbreviations - not Intl, whose ICU data is stripped/unreliable on some
 *  Android System WebViews (same reason the money pipe pins its own symbols). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Formats an ISO `YYYY-MM-DD` date (Rust's wire format) for display: "Today", "Yesterday", or
 * "30 Jun 2026" (day-first, per Mauritius convention - docs/financial-knowledge.md section 8;
 * raw ISO strings in the UI are a defect, ux-blueprint.md section 10). PRESENTATION ONLY - a
 * string re-rendering plus a calendar comparison; no business logic, no time-zone math beyond
 * the device's local calendar day.
 */
@Pipe({ name: 'friendlyDate' })
export class FriendlyDatePipe implements PipeTransform {
  /** `today` is injectable for tests; defaults to the device's current local day. */
  transform(iso: string | null | undefined, today: Date = new Date()): string {
    if (!iso) return '';
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!match) return iso;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (this.sameDay(year, month, day, today)) return 'Today';
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (this.sameDay(year, month, day, yesterday)) return 'Yesterday';

    const monthName = MONTHS[month - 1] ?? String(month);
    return `${day} ${monthName} ${year}`;
  }

  private sameDay(year: number, month: number, day: number, d: Date): boolean {
    return d.getFullYear() === year && d.getMonth() + 1 === month && d.getDate() === day;
  }
}
