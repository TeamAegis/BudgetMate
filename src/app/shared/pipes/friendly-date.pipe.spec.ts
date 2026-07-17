import { FriendlyDatePipe } from './friendly-date.pipe';

describe('FriendlyDatePipe', () => {
  const pipe = new FriendlyDatePipe();
  // A fixed "today" so the relative labels are deterministic.
  const today = new Date(2026, 6, 17); // 17 Jul 2026 (month is 0-based)

  it('labels the current day "Today"', () => {
    expect(pipe.transform('2026-07-17', today)).toBe('Today');
  });

  it('labels the previous day "Yesterday"', () => {
    expect(pipe.transform('2026-07-16', today)).toBe('Yesterday');
  });

  it('formats other days day-first with a short month ("30 Jun 2026")', () => {
    expect(pipe.transform('2026-06-30', today)).toBe('30 Jun 2026');
  });

  it('drops the leading zero from the day', () => {
    expect(pipe.transform('2026-06-05', today)).toBe('5 Jun 2026');
  });

  it('handles a month boundary for "Yesterday"', () => {
    expect(pipe.transform('2026-06-30', new Date(2026, 6, 1))).toBe('Yesterday');
  });

  it('returns empty for null/undefined and passes through non-ISO strings', () => {
    expect(pipe.transform(null, today)).toBe('');
    expect(pipe.transform(undefined, today)).toBe('');
    expect(pipe.transform('not-a-date', today)).toBe('not-a-date');
  });

  it('tolerates a full ISO datetime by reading the date part', () => {
    expect(pipe.transform('2026-06-30T12:34:56', today)).toBe('30 Jun 2026');
  });
});
