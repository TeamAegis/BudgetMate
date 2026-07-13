import { toUserMessage } from './error-message';

describe('toUserMessage', () => {
  it('translates the too-precise money error (MoneyParseError::TooPrecise) to plain language', () => {
    const err = { kind: 'validation', message: 'amount has more decimal places than the currency allows' };
    expect(toUserMessage(err)).toBe(
      'That amount has too many decimal places for its currency. Remove the extra digits and try again.',
    );
  });

  it('falls back to the generic message for an unrelated validation error', () => {
    const err = { kind: 'validation', message: 'something entirely unrecognised happened' };
    expect(toUserMessage(err)).toBe('Something went wrong - please try again.');
  });
});
