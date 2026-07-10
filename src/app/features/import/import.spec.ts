import { receiptTotalToBaseMinor } from './import';

describe('receiptTotalToBaseMinor', () => {
  it('is the identity for a 2-decimal base currency (MUR/USD)', () => {
    expect(receiptTotalToBaseMinor(13800, 2)).toBe(13800);
  });

  it('scales down for a 0-decimal base currency (JPY) instead of the 100x regression', () => {
    // A printed total of "2000.00" extracts as 200000 (fixed 2-dp scale); the base-currency
    // (JPY, 0 decimals) minor-unit total must be 2000, not 200000.
    expect(receiptTotalToBaseMinor(200000, 0)).toBe(2000);
  });

  it('scales up for a 3-decimal base currency (BHD)', () => {
    expect(receiptTotalToBaseMinor(2000, 3)).toBe(20000);
  });
});
