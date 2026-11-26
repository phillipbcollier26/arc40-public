/**
 * Exact decimal-text to scaled-integer parsing, used for share quantities
 * (scale 6 = micro-shares) and fund prices (scale 4). Same idea as money:
 * digits are read straight into an integer, never through a float.
 */
export class DecimalParseError extends Error {}

export function parseScaled(input: string, scale: number, label = 'number'): number {
  let s = input.trim().replace(/,/g, '').replace(/^\$/, '');
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  const dot = s.indexOf('.');
  const whole = dot === -1 ? s : s.slice(0, dot);
  const frac = dot === -1 ? '' : s.slice(dot + 1);
  const isDigits = (x: string) => x.length === 0 || [...x].every((c) => c >= '0' && c <= '9');
  if ((whole === '' && frac === '') || !isDigits(whole) || !isDigits(frac)) {
    throw new DecimalParseError(`"${input}" is not a valid ${label}`);
  }
  if (frac.length > scale) throw new DecimalParseError(`"${input}" has too many decimal places for a ${label}`);
  if (whole.length > 12) throw new DecimalParseError(`"${input}" is too large`);
  const value = Number(whole || '0') * 10 ** scale + Number(frac.padEnd(scale, '0') || '0');
  if (!Number.isSafeInteger(value)) throw new DecimalParseError(`"${input}" is too large`);
  return negative && value !== 0 ? -value : value;
}

/** "178.195" shares -> 178195000 micro-shares. */
export const parseSharesToMicro = (s: string) => parseScaled(s, 6, 'share quantity');
/** "268.32" dollars per share -> 2683200 (ten-thousandths of a dollar). */
export const parsePriceToE4 = (s: string) => parseScaled(s, 4, 'price');
