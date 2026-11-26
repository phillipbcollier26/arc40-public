/**
 * Daily price history CSV for ONE fund: pure parsing. No database here.
 *
 * The user downloads a free daily history file per fund from a finance website. Layouts differ, so:
 *  - the date column is the one named "Date";
 *  - the price column is a CLOSING price: "Close", "Close/Last", "Close*", "Closing Price", "Price" or
 *    "NAV". "Adj Close" is never used: it already includes dividends, which Arc40 adds as reinvested
 *    shares, so using it would count them twice;
 *  - if Arc40 does not recognize the columns, the user picks them once and it is remembered per fund.
 * Which FUND the file is for is never read from the file or its name: the import starts from that
 * fund's row on the Investments page.
 * Rows are untrusted: anything that is not a valid date and a positive price is reported, never guessed.
 */
import { DecimalParseError, parsePriceToE4 } from '../../../shared/decimal.js';
import { isValidIsoDate, type IsoDate } from '../../../shared/dates.js';
import { isBlankRow } from './csv.js';
import type { SkippedRow } from './importMapping.js';

export interface HistoryColumns {
  dateColumn: string;
  priceColumn: string;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[*\s]+/g, '');
const PRICE_NAMES = ['close', 'close/last', 'closingprice', 'closeprice', 'price', 'nav'];

/** The header row: the first of the first 20 rows that has a "Date" column (else the first non-empty row). */
export function findHistoryHeader(rows: string[][]): number | null {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) if (rows[i]!.some((c) => norm(c) === 'date')) return i;
  for (let i = 0; i < limit; i++) if (!isBlankRow(rows[i]!)) return i;
  return null;
}

/** Recognized date and closing-price columns, or null for what is not recognized. */
export function suggestColumns(headers: readonly string[]): { dateColumn: string | null; priceColumn: string | null } {
  const date = headers.find((h) => norm(h) === 'date') ?? null;
  const price = PRICE_NAMES.map((n) => headers.find((h) => norm(h) === n)).find((h) => h !== undefined) ?? null;
  return { dateColumn: date, priceColumn: price };
}

export const isAdjusted = (column: string) => /adj/i.test(column);

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "2026-11-12", "11/12/2026" (US order) or "Nov 12, 2026" / "November 12, 2026". */
export function parseHistoryDate(text: string): IsoDate | null {
  const s = text.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let iso: string | null = null;
  if (m) iso = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) iso = `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) {
    const month = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1;
    if (month > 0) iso = `${m[3]}-${String(month).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  }
  return iso && isValidIsoDate(iso) ? iso : null;
}

/**
 * Some sites give closes like "258.700012". Prices are stored to 4 decimals, so longer decimals are
 * rounded half up with integer math (never through a float). Anything else is returned unchanged.
 */
export function toFourDecimals(text: string): string {
  const m = /^(\d[\d,]*)\.(\d{5,12})$/.exec(text.trim());
  if (!m) return text;
  const whole = m[1]!.replace(/,/g, '');
  const scaled = BigInt(whole + m[2]!.slice(0, 4)) + (Number(m[2]![4]) >= 5 ? 1n : 0n);
  const str = scaled.toString().padStart(5, '0');
  return `${str.slice(0, -4)}.${str.slice(-4)}`;
}

export interface ParsedHistory {
  prices: { date: IsoDate; priceE4: number }[]; // oldest first
  skipped: SkippedRow[];
}

export function parseHistory(rows: string[][], headerRow: number, cols: HistoryColumns, today: IsoDate): ParsedHistory {
  const headers = rows[headerRow]!.map((h) => h.trim());
  const iDate = headers.indexOf(cols.dateColumn);
  const iPrice = headers.indexOf(cols.priceColumn);
  const seen = new Set<string>();
  const prices: ParsedHistory['prices'] = [];
  const skipped: SkippedRow[] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (isBlankRow(row)) continue;
    const line = r + 1;
    const dateText = (row[iDate] ?? '').trim();
    const priceText = (row[iPrice] ?? '').trim();
    const date = parseHistoryDate(dateText);
    if (!date) {
      skipped.push({ line, reason: `"${dateText.slice(0, 30)}" is not a date` });
      continue;
    }
    if (date > today) {
      skipped.push({ line, reason: `${date} is in the future` });
      continue;
    }
    let priceE4: number;
    try {
      priceE4 = parsePriceToE4(toFourDecimals(priceText.replace(/\$/g, '')));
    } catch (e) {
      if (!(e instanceof DecimalParseError)) throw e;
      skipped.push({ line, reason: `"${priceText.slice(0, 30)}" is not a price (for ${date})` });
      continue;
    }
    if (priceE4 <= 0) {
      skipped.push({ line, reason: `The price for ${date} is not above $0` });
      continue;
    }
    if (seen.has(date)) {
      skipped.push({ line, reason: `${date} appears more than once (the first one is used)` });
      continue;
    }
    seen.add(date);
    prices.push({ date, priceE4 });
  }
  prices.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { prices, skipped };
}
