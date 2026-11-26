/**
 * Calendar-date helpers. Calendar dates are always 'YYYY-MM-DD' strings in the
 * Mac's local time zone. Comparing two such strings with < or > is correct.
 */

export type IsoDate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(s: unknown): s is IsoDate {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** Local calendar date for an epoch-ms timestamp. */
export function toIsoDate(epochMs: number): IsoDate {
  const d = new Date(epochMs);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function parts(date: IsoDate): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return [y, m, d];
}

function fromParts(y: number, m: number, d: number): IsoDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Adds days (negative allowed). Uses UTC math so daylight saving never shifts a day. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return fromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Adds months, clamping the day (Mar 31 minus 1 month = Feb 28/29). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fromParts(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function startOfMonth(date: IsoDate): IsoDate {
  const [y, m] = parts(date);
  return fromParts(y, m, 1);
}

export function endOfMonth(date: IsoDate): IsoDate {
  const [y, m] = parts(date);
  return fromParts(y, m, daysInMonth(y, m));
}

export function startOfYear(date: IsoDate): IsoDate {
  return fromParts(parts(date)[0], 1, 1);
}
