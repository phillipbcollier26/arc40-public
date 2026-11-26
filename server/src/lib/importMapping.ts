/**
 * Column mapping for bank CSVs: "which column is the date, the amount, the
 * description". Pure functions. A mapping is saved once per account.
 */
import { isValidIsoDate, type IsoDate } from '../../../shared/dates.js';
import { parseMoneyToCents, type Cents } from './money.js';
import { cleanDescription } from './describe.js';
import { isBlankRow } from './csv.js';

export type DateFormat = 'MDY' | 'YMD' | 'DMY';
export type AmountMode = 'single' | 'debitCredit' | 'indicator';

export interface GenericMapping {
  /** Index (0-based) of the header row in the parsed file. */
  headerRow: number;
  dateColumn: string;
  dateFormat: DateFormat;
  /** First non-empty one is shown; all of them are kept for rule matching. */
  descriptionColumns: string[];
  amountMode: AmountMode;
  /** single: one signed amount column (flip with invertAmount if the bank shows spending as positive). */
  amountColumn?: string;
  invertAmount?: boolean;
  /** debitCredit: money out in one column, money in in another. */
  debitColumn?: string;
  creditColumn?: string;
  /** indicator: an unsigned amount plus a column that says "Credit" or "Debit". */
  indicatorColumn?: string;
  creditWord?: string;
  /** Optional running balance column: fills in balance history. */
  balanceColumn?: string;
}

export interface ParsedRow {
  line: number; // 1-based line in the file, for messages
  date: IsoDate;
  amountCents: Cents;
  description: string;
  rawDescription: string;
  balanceCents: Cents | null;
}

export interface SkippedRow {
  line: number;
  reason: string;
}

// ---------- dates ----------

/** Parses bank dates like 10/29/2026, 10/29/26, 2026-10-31, 31.10.2026. Returns null if not a date. */
export function parseBankDate(text: string, format: DateFormat): IsoDate | null {
  const s = text.trim().split(/[ T]/)[0] ?? '';
  const parts = s.split(/[/.-]/);
  if (parts.length !== 3 || parts.some((p) => p === '' || !/^\d+$/.test(p))) return null;
  let y: string, m: string, d: string;
  if (format === 'YMD') [y, m, d] = parts as [string, string, string];
  else if (format === 'MDY') [m, d, y] = parts as [string, string, string];
  else [d, m, y] = parts as [string, string, string];
  if (y.length === 2) y = `20${y}`;
  if (y.length !== 4 || m.length > 2 || d.length > 2) return null;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isValidIsoDate(iso) ? iso : null;
}

/** Guesses the date format from sample values. */
export function guessDateFormat(samples: string[]): DateFormat {
  const vals = samples.map((s) => s.trim()).filter(Boolean);
  if (vals.length && vals.every((v) => /^\d{4}[-/.]/.test(v))) return 'YMD';
  // If any first number is > 12 it must be a day (DMY).
  for (const v of vals) {
    const first = Number(v.split(/[/.-]/)[0]);
    if (first > 12) return 'DMY';
  }
  return 'MDY';
}

// ---------- header + suggestions ----------

/** Header = first row with 3+ filled cells where none looks like a date or amount. */
export function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i]!.map((c) => c.trim()).filter(Boolean);
    if (cells.length < 3) continue;
    const looksLikeData = cells.some((c) => /^[-+($]*\d[\d,]*(\.\d+)?\)?$/.test(c) || /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/.test(c));
    if (!looksLikeData) return i;
  }
  return 0;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Known bank layouts. Matched on exact header names; the mapping is still shown for confirmation. */
export const PRESETS: { name: string; headers: string[]; mapping: Omit<GenericMapping, 'headerRow'> }[] = [
  {
    name: 'Wright-Patt Credit Union',
    headers: ['Transaction Number', 'Date', 'Description', 'Memo', 'Amount Debit', 'Amount Credit', 'Balance', 'Check Number'],
    mapping: {
      dateColumn: 'Date',
      dateFormat: 'MDY',
      descriptionColumns: ['Memo', 'Description'],
      amountMode: 'debitCredit',
      debitColumn: 'Amount Debit',
      creditColumn: 'Amount Credit',
      balanceColumn: 'Balance',
    },
  },
  {
    name: 'Climate First Bank',
    headers: ['Account Name', 'Processed Date', 'Description', 'Check Number', 'Credit or Debit', 'Amount'],
    mapping: {
      dateColumn: 'Processed Date',
      dateFormat: 'YMD',
      descriptionColumns: ['Description'],
      amountMode: 'indicator',
      amountColumn: 'Amount',
      indicatorColumn: 'Credit or Debit',
      creditWord: 'Credit',
    },
  },
];

export function detectPreset(headers: string[]): (typeof PRESETS)[number] | null {
  const h = headers.map(norm).filter(Boolean).join('|');
  return PRESETS.find((p) => p.headers.map(norm).join('|') === h) ?? null;
}

/** Best guess at a mapping for an unknown bank. The user confirms it in the UI. */
export function suggestMapping(rows: string[][], headerRow: number): GenericMapping {
  const headers = (rows[headerRow] ?? []).map((h) => h.trim());
  const preset = detectPreset(headers);
  if (preset) return { headerRow, ...preset.mapping };

  const find = (...words: string[]) =>
    headers.find((h) => words.some((w) => norm(h) === w)) ?? headers.find((h) => words.some((w) => norm(h).includes(w)));

  const dateColumn = find('posteddate', 'postingdate', 'processeddate', 'transactiondate', 'date') ?? headers[0] ?? '';
  const debit = find('debit', 'withdrawal', 'amountdebit', 'moneyout');
  const credit = find('credit', 'deposit', 'amountcredit', 'moneyin');
  const indicator = headers.find((h) => /credit.*debit|debit.*credit|type/i.test(h) && norm(h) !== norm(debit ?? '') && norm(h) !== norm(credit ?? ''));
  const amount = find('amount');
  const descriptions = ['memo', 'payee', 'description', 'name', 'details', 'merchant']
    .map((w) => headers.find((h) => norm(h).includes(w)))
    .filter((h): h is string => !!h)
    .filter((h, i, a) => a.indexOf(h) === i);

  const dateIdx = headers.indexOf(dateColumn);
  const samples = rows.slice(headerRow + 1, headerRow + 30).map((r) => r[dateIdx] ?? '');

  const base = {
    headerRow,
    dateColumn,
    dateFormat: guessDateFormat(samples),
    descriptionColumns: descriptions.length ? descriptions : [headers[1] ?? ''],
    balanceColumn: find('balance', 'runningbalance'),
  };
  if (debit && credit && norm(debit) !== norm(credit)) {
    return { ...base, amountMode: 'debitCredit', debitColumn: debit, creditColumn: credit };
  }
  if (amount && indicator) {
    return { ...base, amountMode: 'indicator', amountColumn: amount, indicatorColumn: indicator, creditWord: 'Credit' };
  }
  return { ...base, amountMode: 'single', amountColumn: amount ?? headers[headers.length - 1] ?? '' };
}

/** Returns a plain-language problem with the mapping, or null if it is usable. */
export function validateMapping(m: GenericMapping, headers: string[]): string | null {
  const has = (c: string | undefined) => !!c && headers.includes(c);
  if (!has(m.dateColumn)) return 'Pick the column that holds the date.';
  if (!m.descriptionColumns.length || !m.descriptionColumns.every(has)) return 'Pick the column that describes each transaction.';
  if (m.amountMode === 'single' && !has(m.amountColumn)) return 'Pick the amount column.';
  if (m.amountMode === 'debitCredit' && (!has(m.debitColumn) || !has(m.creditColumn))) return 'Pick both the money-out and money-in columns.';
  if (m.amountMode === 'indicator' && (!has(m.amountColumn) || !has(m.indicatorColumn) || !m.creditWord)) return 'Pick the amount column and the credit/debit column.';
  if (m.balanceColumn && !has(m.balanceColumn)) return 'The balance column was not found.';
  return null;
}

// ---------- applying a mapping ----------

/** Words in a "Credit or Debit" column that mean money out (compared lower case, trimmed). */
export const DEBIT_WORDS: ReadonlySet<string> = new Set(['debit', 'dr', 'withdrawal']);

/** Empty cell = no amount (null). Throws MoneyParseError on garbage. */
const money = (text: string): Cents | null => (text.trim() === '' ? null : parseMoneyToCents(text));

export function applyMapping(rows: string[][], m: GenericMapping): { parsed: ParsedRow[]; skipped: SkippedRow[] } {
  const headers = (rows[m.headerRow] ?? []).map((h) => h.trim());
  const col = (name: string | undefined) => (name ? headers.indexOf(name) : -1);
  const iDate = col(m.dateColumn);
  const iDescs = m.descriptionColumns.map(col);
  const iAmount = col(m.amountColumn);
  const iDebit = col(m.debitColumn);
  const iCredit = col(m.creditColumn);
  const iInd = col(m.indicatorColumn);
  const iBal = col(m.balanceColumn);

  const parsed: ParsedRow[] = [];
  const skipped: SkippedRow[] = [];

  for (let r = m.headerRow + 1; r < rows.length; r++) {
    const row = rows[r]!;
    const line = r + 1;
    // Footer and spacer lines ("Date downloaded ...", empty rows) are ignored silently.
    if (isBlankRow(row) || row.filter((c) => c.trim()).length <= 1) continue;
    const cell = (i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');

    const date = parseBankDate(cell(iDate), m.dateFormat);
    if (!date) {
      skipped.push({ line, reason: `"${cell(iDate).slice(0, 30)}" is not a date` });
      continue;
    }

    let amount: Cents | null;
    try {
      if (m.amountMode === 'single') {
        amount = money(cell(iAmount));
        if (amount !== null && m.invertAmount) amount = -amount;
      } else if (m.amountMode === 'debitCredit') {
        const out = money(cell(iDebit));
        const inn = money(cell(iCredit));
        if (out !== null && out !== 0 && inn !== null && inn !== 0) {
          skipped.push({ line, reason: 'Both money-out and money-in are filled in' });
          continue;
        }
        amount = inn !== null && inn !== 0 ? Math.abs(inn) : out !== null ? -Math.abs(out) : inn;
      } else {
        const raw = money(cell(iAmount));
        const word = cell(iInd).toLowerCase();
        // Audit F-05: money in only for the credit word, money out only for a known debit word.
        // Anything else (blank, "Deposit", a typo) is reported, never guessed.
        const isCredit = word === (m.creditWord ?? 'credit').trim().toLowerCase();
        if (!isCredit && !DEBIT_WORDS.has(word)) {
          skipped.push({ line, reason: 'Credit or Debit is not clear' });
          continue;
        }
        amount = raw === null ? null : isCredit ? Math.abs(raw) : -Math.abs(raw);
      }
    } catch {
      skipped.push({ line, reason: 'The amount is not a valid number' });
      continue;
    }
    if (amount === null) {
      skipped.push({ line, reason: 'No amount (a note or comment line)' });
      continue;
    }
    if (amount === 0) {
      // A $0.00 row moves no money (statement notes, holds released): report it, never save a $0 transaction.
      skipped.push({ line, reason: 'The amount is $0.00' });
      continue;
    }

    const texts = iDescs.map(cell).filter(Boolean);
    const shown = texts[0] ?? '(no description)';
    let balance: Cents | null = null;
    try {
      balance = iBal >= 0 ? money(cell(iBal)) : null;
    } catch {
      balance = null;
    }

    parsed.push({
      line,
      date,
      amountCents: amount,
      description: cleanDescription(shown),
      rawDescription: texts.join(' | ').slice(0, 500),
      balanceCents: balance,
    });
  }
  return { parsed, skipped };
}

/**
 * End-of-day balances from a running-balance column. Works whether the file
 * is newest-first or oldest-first.
 */
export function endOfDayBalances(rows: readonly ParsedRow[]): Map<IsoDate, Cents> {
  const withBal = rows.filter((r) => r.balanceCents !== null);
  const out = new Map<IsoDate, Cents>();
  if (!withBal.length) return out;
  const newestFirst = withBal[0]!.date >= withBal[withBal.length - 1]!.date;
  for (const r of withBal) {
    if (newestFirst) {
      if (!out.has(r.date)) out.set(r.date, r.balanceCents!);
    } else {
      out.set(r.date, r.balanceCents!);
    }
  }
  return out;
}
