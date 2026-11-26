/**
 * Fidelity "Portfolio Positions" CSV: pure parsing. No database here.
 *
 * Layout (from the header the user shared, Nov 2026; values in fixtures are invented):
 *   Account number,Account name,Symbol,Description,Quantity,Last price,Last price change,Current value,
 *   Today's gain/loss dollar,Today's gain/loss percent,Total gain/loss dollar,Total gain/loss percent,
 *   Percent of account,Cost basis total,Average cost basis,Type,
 * then a blank line, disclaimer paragraphs (one filled cell each) and "Date downloaded Nov-12-2026 8:34 p.m ET".
 *
 * Privacy: the "Account number" column is never read. Rows are matched to Arc40 accounts by
 * Account NAME only, and any long digit run in a name is masked like Fidelity actions are.
 *
 * Lines:
 *   fund     a share count and a price: the price is saved, the share count is compared with Arc40's
 *   cash     a money market / core position (symbol ending in "**", "MONEY MARKET", or no share count):
 *            never a fund price; its value is shown next to Arc40's uninvested cash
 *   pending  "Pending Activity": shown, ignored
 * Anything else with an account name and symbol is reported as a skipped line, never guessed.
 * The cash and pending formats were not in the sample the user shared, so they are matched loosely.
 */
import { parsePriceToE4, parseSharesToMicro } from '../../../shared/decimal.js';
import { addDays, isValidIsoDate, type IsoDate } from '../../../shared/dates.js';
import { MoneyParseError, parseMoneyToCents, type Cents } from './money.js';
import { maskAccountNumbers } from './fidelity.js';
import { isBlankRow } from './csv.js';
import type { SkippedRow } from './importMapping.js';

const REQUIRED = ['account name', 'symbol', 'quantity', 'last price'];

export interface PositionLine {
  line: number;
  accountName: string;
  symbol: string;
  description: string;
}
export interface FundLine extends PositionLine {
  kind: 'fund';
  quantityMicro: number;
  priceE4: number;
  valueCents: Cents | null;
}
export interface CashLine extends PositionLine {
  kind: 'cash' | 'pending';
  valueCents: Cents | null;
}

export interface ParsedPositions {
  funds: FundLine[];
  cash: CashLine[];
  skipped: SkippedRow[];
  /** From "Date downloaded Nov-12-2026 8:34 p.m ET". null when the file has no such line. */
  downloaded: { date: IsoDate; minutes: number | null; text: string } | null;
}

/** The row holding the column names, or null when this is not a positions file. */
export function findPositionsHeader(rows: string[][]): number | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i]!.map((c) => c.trim().toLowerCase());
    if (REQUIRED.every((h) => cells.includes(h))) return i;
  }
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Date downloaded Nov-12-2026 8:34 p.m ET" -> 2026-11-12 at 20:34. */
export function parseDownloaded(text: string): ParsedPositions['downloaded'] {
  const m = /Date downloaded\s+([A-Za-z]{3})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([ap])\.?\s*m)?/i.exec(text);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!.toLowerCase()) + 1;
  const date = `${m[3]}-${String(month).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  if (month < 1 || !isValidIsoDate(date)) return null;
  let minutes: number | null = null;
  if (m[4]) {
    const h = Number(m[4]) % 12;
    minutes = (m[6]!.toLowerCase() === 'p' ? h + 12 : h) * 60 + Number(m[5]);
  }
  return { date, minutes, text: m[0].slice(0, 60) };
}

const weekday = (d: IsoDate) => new Date(`${d}T12:00:00Z`).getUTCDay(); // 0 Sun .. 6 Sat
function previousWeekday(d: IsoDate): IsoDate {
  let x = addDays(d, -1);
  while (weekday(x) === 0 || weekday(x) === 6) x = addDays(x, -1);
  return x;
}

/**
 * Which day the "Last price" belongs to. Mutual fund prices are set once a day and
 * reach Fidelity in the evening, so: downloaded on a weekday at or after 6 p.m. ET -> that day;
 * earlier in the day -> the previous weekday; on a weekend -> Friday. Holidays cannot be known from
 * the file, which is why the preview lets the user change the date before saving.
 */
export function inferPriceDate(downloaded: NonNullable<ParsedPositions['downloaded']>): { date: IsoDate; reason: string } {
  const d = downloaded.date;
  const wd = weekday(d);
  if (wd === 0 || wd === 6) return { date: previousWeekday(d), reason: 'Downloaded on a weekend, so the prices are from the Friday before.' };
  if (downloaded.minutes !== null && downloaded.minutes < 18 * 60) {
    return { date: previousWeekday(d), reason: 'Downloaded before 6 p.m. ET, when fund prices for the day are not out yet, so they are from the weekday before.' };
  }
  return { date: d, reason: 'Downloaded in the evening, after fund prices for the day came out.' };
}

const clean = (s: string) => s.replace(/[$,\s]/g, '');

function money(text: string): Cents | null {
  const t = text.trim();
  if (!t || t === '--' || t.toLowerCase() === 'n/a') return null;
  try {
    return parseMoneyToCents(t.replace(/\$/g, ''));
  } catch (e) {
    if (e instanceof MoneyParseError) return null;
    throw e;
  }
}

export function parsePositions(rows: string[][], headerRow: number): ParsedPositions {
  const headers = rows[headerRow]!.map((h) => h.trim().toLowerCase());
  const col = (name: string) => headers.indexOf(name);
  // NOTE: the 'account number' column is deliberately never looked up.
  const iName = col('account name');
  const iSym = col('symbol');
  const iDesc = col('description');
  const iQty = col('quantity');
  const iPrice = col('last price');
  const iValue = col('current value');
  const funds: FundLine[] = [];
  const cash: CashLine[] = [];
  const skipped: SkippedRow[] = [];
  let downloaded: ParsedPositions['downloaded'] = null;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (isBlankRow(row)) continue;
    const cell = (i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');
    const filled = row.filter((c) => c.trim()).length;
    if (filled === 1) {
      // Disclaimers and the download line sit in the first cell on their own.
      const text = row.find((c) => c.trim())!;
      downloaded = parseDownloaded(text) ?? downloaded;
      continue;
    }
    const line = r + 1;
    const accountName = maskAccountNumbers(cell(iName)).replace(/\s+/g, ' ').slice(0, 60);
    const symbolRaw = cell(iSym).toUpperCase();
    if (!accountName || !symbolRaw) {
      skipped.push({ line, reason: 'No account name or symbol on this line' });
      continue;
    }
    const description = cell(iDesc).slice(0, 120);
    const base = { line, accountName, symbol: symbolRaw.slice(0, 20), description };
    if (symbolRaw.includes('PENDING')) {
      cash.push({ ...base, kind: 'pending', valueCents: money(cell(iValue)) });
      continue;
    }
    if (symbolRaw.endsWith('**') || /MONEY MARKET/i.test(description) || !cell(iQty)) {
      cash.push({ ...base, kind: 'cash', symbol: symbolRaw.replace(/\*+$/, '').slice(0, 12), valueCents: money(cell(iValue)) });
      continue;
    }
    if (!/^[A-Z0-9.]{1,12}$/.test(symbolRaw)) {
      skipped.push({ line, reason: `"${symbolRaw.slice(0, 20)}" is not a fund symbol Arc40 can use` });
      continue;
    }
    let quantityMicro: number;
    let priceE4: number;
    try {
      quantityMicro = parseSharesToMicro(clean(cell(iQty)));
      priceE4 = parsePriceToE4(clean(cell(iPrice)));
    } catch {
      skipped.push({ line, reason: `Could not read the share count or price for ${symbolRaw}` });
      continue;
    }
    if (priceE4 <= 0 || quantityMicro < 0) {
      skipped.push({ line, reason: `The share count or price for ${symbolRaw} is not usable` });
      continue;
    }
    funds.push({ ...base, kind: 'fund', quantityMicro, priceE4, valueCents: money(cell(iValue)) });
  }
  return { funds, cash, skipped, downloaded };
}

/** Key a Fidelity account name is remembered by. */
export const accountNameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 80);
