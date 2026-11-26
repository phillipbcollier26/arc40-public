/**
 * Money helpers. RULE: money is always an integer number of cents.
 * Never do floating point arithmetic on money and never parse money with
 * parseFloat. Strings are parsed digit-by-digit straight into cents.
 */

export type Cents = number;

export class MoneyParseError extends Error {}

export function assertCents(value: number, label = 'amount'): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyParseError(`${label} must be a whole number of cents`);
  }
  return value;
}

/**
 * Parses bank-style money text into cents.
 * Accepts: "1234", "1,234.5", "$1,234.56", "-12.34", "-$12.34", "$-12.34",
 *          "(12.34)", "+5", "12.34-", " $ 0.99 ", "USD 3.00", ".5".
 * Rejects: more than 2 decimal places, letters, empty text, bad thousands commas.
 */
export function parseMoneyToCents(input: string): Cents {
  if (typeof input !== 'string') throw new MoneyParseError('Amount is not text');
  let s = input.trim().replace(/^USD\s*/i, '').replace(/\s*USD$/i, '');
  if (s === '') throw new MoneyParseError('Amount is empty');

  let negative = false;
  let signs = 0;
  const flip = () => {
    negative = true;
    signs += 1;
    if (signs > 1) throw new MoneyParseError(`"${input}" has more than one minus sign`);
  };
  if (/^\(.*\)$/.test(s)) {
    flip();
    s = s.slice(1, -1).trim();
  }
  if (s.endsWith('-')) {
    flip();
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith('-')) {
    flip();
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    signs += 1;
    if (signs > 1) throw new MoneyParseError(`"${input}" has conflicting signs`);
    s = s.slice(1).trim();
  }
  if (s.startsWith('$')) s = s.slice(1).trim();
  if (s.startsWith('-')) {
    flip();
    s = s.slice(1).trim();
  }

  const m = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[1] === undefined && !m[2])) {
    throw new MoneyParseError(`"${input}" is not a valid amount`);
  }
  const whole = (m[1] ?? '0').replace(/,/g, '');
  if (whole.length > 13) throw new MoneyParseError(`"${input}" is too large`);
  const frac = (m[2] ?? '').padEnd(2, '0');
  const cents = Number(whole) * 100 + Number(frac);
  assertCents(cents);
  return negative && cents !== 0 ? -cents : cents;
}

/** Formats cents as "$1,234.56" or "-$1,234.56" (display only). */
export function formatCents(cents: Cents, opts: { sign?: boolean } = {}): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const rest = String(abs % 100).padStart(2, '0');
  const prefix = cents < 0 ? '-' : opts.sign && cents > 0 ? '+' : '';
  return `${prefix}$${dollars}.${rest}`;
}

/** Sums cents exactly, throwing if anything is not an integer. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += assertCents(v);
  return assertCents(total);
}
