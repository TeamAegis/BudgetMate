import { TestBed } from '@angular/core/testing';
import { MoneyPipe } from './money.pipe';
import { CurrencyService } from '../../core/money/currency.service';

describe('MoneyPipe', () => {
  let pipe: MoneyPipe;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MoneyPipe,
        {
          provide: CurrencyService,
          useValue: { fractionDigits: (c: string) => (c === 'JPY' ? 0 : 2) },
        },
      ],
    });
    pipe = TestBed.inject(MoneyPipe);
  });

  // Intl 'code' output inserts a non-breaking space (U+00A0); normalise before comparing.
  function norm(s: string): string {
    return s.replace(/\u00A0/g, ' ');
  }

  it('renders a whole MUR amount as "Rs" with no decimals', () => {
    const result = norm(pipe.transform({ amountMinor: 3000000, currency: 'MUR' }, false, 'en-US'));
    expect(result).toBe('Rs 30,000');
    expect(result).not.toContain('.00');
  });

  it('renders a fractional MUR amount as "Rs" with 2 decimals', () => {
    const result = norm(pipe.transform({ amountMinor: 3000050, currency: 'MUR' }, false, 'en-US'));
    expect(result).toBe('Rs 30,000.50');
  });

  it('renders a small fractional MUR amount', () => {
    const result = norm(pipe.transform({ amountMinor: 1550, currency: 'MUR' }, false, 'en-US'));
    expect(result).toBe('Rs 15.50');
  });

  it('renders a small whole MUR amount with no decimals', () => {
    const result = norm(pipe.transform({ amountMinor: 1500, currency: 'MUR' }, false, 'en-US'));
    expect(result).toBe('Rs 15');
  });

  it('preserves the leading sign for a negative (expense) amount', () => {
    const result = norm(pipe.transform({ amountMinor: -1550, currency: 'MUR' }, false, 'en-US'));
    expect(result).toBe('-Rs 15.50');
  });

  it('returns an empty string for a null value', () => {
    expect(pipe.transform(null, false, 'en-US')).toBe('');
  });

  it('returns an empty string for an undefined value', () => {
    expect(pipe.transform(undefined, false, 'en-US')).toBe('');
  });

  it('leaves a non-mapped currency on the narrowSymbol path unmangled', () => {
    const result = pipe.transform({ amountMinor: 1234, currency: 'JPY' }, false, 'en-US');
    expect(result).not.toContain('undefined');
    expect(result).toContain('1,234');
  });

  it('renders a whole USD amount (narrowSymbol, 2-decimal currency) with no decimals', () => {
    const result = norm(pipe.transform({ amountMinor: 3000000, currency: 'USD' }, false, 'en-US'));
    expect(result).toBe('$30,000');
    expect(result).not.toContain('.00');
  });

  it('renders a fractional USD amount (narrowSymbol, 2-decimal currency) with 2 decimals', () => {
    const result = norm(pipe.transform({ amountMinor: 3050, currency: 'USD' }, false, 'en-US'));
    expect(result).toBe('$30.50');
  });

  it('pins comma-thousands / period-decimal grouping for MUR when no locale is passed', () => {
    const result = norm(pipe.transform({ amountMinor: 3000050, currency: 'MUR' }));
    expect(result).toContain('30,000.50');
    expect(result).not.toContain('30 000');
  });
});
