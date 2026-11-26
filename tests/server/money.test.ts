import { describe, expect, it } from 'vitest';
import { formatCents, MoneyParseError, parseMoneyToCents, sumCents } from '../../server/src/lib/money.js';

describe('parseMoneyToCents', () => {
  it.each([
    ['0', 0],
    ['12', 1200],
    ['12.3', 1230],
    ['12.34', 1234],
    ['.5', 50],
    ['$1,234.56', 123456],
    ['-12.34', -1234],
    ['-$12.34', -1234],
    ['$-12.34', -1234],
    ['(12.34)', -1234],
    ['($12.34)', -1234],
    ['12.34-', -1234],
    ['+5.00', 500],
    ['  $ 0.99 ', 99],
    ['USD 3.00', 300],
    ['1,000,000.00', 100000000],
    ['-0.00', 0],
  ])('parses %j as %d cents', (input, cents) => {
    expect(parseMoneyToCents(input)).toBe(cents);
  });

  it.each(['', '   ', 'abc', '12.345', '1,23.00', '12..3', '$', '--5', '(-5)', '-5-', '+-5', '1e5', 'NaN', '12 34', '=SUM(A1)'])(
    'rejects %j',
    (input) => {
      expect(() => parseMoneyToCents(input)).toThrow(MoneyParseError);
    },
  );

  it('never produces floating point drift (0.1 + 0.2 problem)', () => {
    const total = sumCents([parseMoneyToCents('0.10'), parseMoneyToCents('0.20')]);
    expect(total).toBe(30);
    expect(Number.isInteger(total)).toBe(true);
  });

  it('every two-decimal value round-trips exactly', () => {
    for (let c = -100_000; c <= 100_000; c += 7) {
      expect(parseMoneyToCents(formatCents(c))).toBe(c);
    }
  });
});

describe('formatCents', () => {
  it('formats with separators and sign', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-5)).toBe('-$0.05');
    expect(formatCents(500, { sign: true })).toBe('+$5.00');
    expect(formatCents(0)).toBe('$0.00');
  });

  it('refuses non-integer cents', () => {
    expect(() => formatCents(1.5)).toThrow();
  });
});

describe('sumCents', () => {
  it('refuses floats', () => {
    expect(() => sumCents([100, 0.5])).toThrow();
  });
});
