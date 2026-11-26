/** Plain-language formatting for trophy sentences and progress (display only). */
import { formatCents } from '../money.js';
import type { IsoDate } from '../../../../shared/dates.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "$50,000" for whole dollars, "$43,100.25" otherwise. */
export function money(cents: number): string {
  const s = formatCents(cents);
  return s.endsWith('.00') ? s.slice(0, -3) : s;
}

/** "Nov 1, 2025" */
export function longDate(d: IsoDate): string {
  return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
}

/** "Nov 1" */
export function shortDate(d: IsoDate): string {
  return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
}

/** "March 2026" for 'YYYY-MM' or a date. */
export function monthName(d: string): string {
  return `${LONG_MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
}

/** "from Nov 1 to Nov 30, 2025" (years on both ends when they differ). */
export function fromTo(a: IsoDate, b: IsoDate): string {
  return a.slice(0, 4) === b.slice(0, 4) ? `from ${shortDate(a)} to ${longDate(b)}` : `from ${longDate(a)} to ${longDate(b)}`;
}

/** "November" for a date or 'YYYY-MM'. */
export function monthOnly(d: string): string {
  return LONG_MONTHS[Number(d.slice(5, 7)) - 1]!;
}

/**
 * A trophy that judges a month or year still running can already be ahead without being earned yet. The bar then stops
 * visibly short of full (only an earned trophy shows a full bar; 99% looked full) and the line says when it counts.
 */
export const WAITING_FRACTION = 0.95;

export const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
