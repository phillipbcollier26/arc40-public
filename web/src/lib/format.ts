/**
 * Display formatting. Money arrives from the server as integer cents and is
 * only turned into text here, using integer math (no float rounding).
 */
export { formatCents } from '../../../shared/money';

/** Short labels for chart axes: 950 -> "$950", 12,400 -> "$12.4k", 1.25M -> "$1.3M". */
export function formatCompactCents(cents: number): string {
  const neg = cents < 0;
  const dollars = Math.floor(Math.abs(Math.round(cents)) / 100);
  let out: string;
  if (dollars >= 1_000_000) out = `${tenths(dollars, 1_000_000)}M`;
  else if (dollars >= 10_000) out = `${Math.round(dollars / 1000)}k`;
  else if (dollars >= 1_000) out = `${tenths(dollars, 1000)}k`;
  else out = String(dollars);
  return `${neg ? '-' : ''}$${out}`;
}

function tenths(value: number, unit: number): string {
  const t = Math.round((value * 10) / unit);
  const whole = Math.floor(t / 10);
  const frac = t % 10;
  return frac === 0 ? String(whole) : `${whole}.${frac}`;
}

/** Dollars and cents as separate strings, for the big headline numbers. */
export function splitCents(cents: number): { sign: string; dollars: string; cents: string } {
  const abs = Math.abs(cents);
  return {
    sign: cents < 0 ? '-' : '',
    dollars: Math.floor(abs / 100).toLocaleString('en-US'),
    cents: String(abs % 100).padStart(2, '0'),
  };
}

/** Basis points (1% = 100) to "+4.25%". null -> "". */
export function formatBasisPoints(bp: number | null, opts: { sign?: boolean } = { sign: true }): string {
  if (bp === null) return '';
  const abs = Math.abs(bp);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}%`;
  if (bp < 0) return `-${s}`;
  return opts.sign && bp > 0 ? `+${s}` : s;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-01" -> "Nov 1, 2026" (no time zone shifts: parsed by hand). */
export function formatDate(iso: string, opts: { year?: boolean } = { year: true }): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return opts.year ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${d}`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Micro-shares -> "178.195" (up to 6 decimals, trailing zeros trimmed). Integer math only. */
export function formatShares(micro: number): string {
  const neg = micro < 0;
  const abs = Math.abs(micro);
  const whole = Math.floor(abs / 1_000_000).toLocaleString('en-US');
  const frac = String(abs % 1_000_000).padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Price in ten-thousandths -> "$268.32" or "$19.8215" (at least 2 decimals). */
export function formatPriceE4(e4: number): string {
  const whole = Math.floor(e4 / 10_000).toLocaleString('en-US');
  let frac = String(e4 % 10_000).padStart(4, '0');
  while (frac.length > 2 && frac.endsWith('0')) frac = frac.slice(0, -1);
  return `$${whole}.${frac}`;
}

/** Price e4 -> editable text "268.32". */
export const priceE4ToInput = (e4: number) => formatPriceE4(e4).slice(1).replace(/,/g, '');

/**
 * Escapes text for the HTML strings that chart tooltips are built from. Names
 * (accounts, categories, payers, fund symbols) can come from CSV files or typing,
 * so they are always shown as text, never read as HTML.
 */
export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
