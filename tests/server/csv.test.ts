import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CsvError, CSV_LIMITS, parseCsv } from '../../server/src/lib/csv.js';
import {
  applyMapping,
  detectPreset,
  endOfDayBalances,
  findHeaderRow,
  guessDateFormat,
  parseBankDate,
  suggestMapping,
  validateMapping,
} from '../../server/src/lib/importMapping.js';
import { classifyAction, findFidelityHeader, parseFidelity } from '../../server/src/lib/fidelity.js';
import { cleanDescription } from '../../server/src/lib/describe.js';
import { parsePriceToE4, parseSharesToMicro } from '../../shared/decimal.js';
import { fingerprint, planDedupe } from '../../server/src/lib/dedupe.js';

const fixture = (name: string) => fs.readFileSync(path.resolve('tests/fixtures/csv', name), 'utf8');

describe('parseCsv (untrusted input)', () => {
  it('handles quotes, escaped quotes, commas in quotes, CRLF and a BOM', () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""",3\r\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', '3'],
    ]);
  });

  it('keeps blank lines as rows (callers skip them) and the last line without a newline', () => {
    expect(parseCsv('a,b\n\nc,d')).toEqual([['a', 'b'], [''], ['c', 'd']]);
  });

  it('rejects binary files', () => {
    expect(() => parseCsv('PK\u0003\u0004\u0000\u0000junk')).toThrow(CsvError);
  });

  it('rejects a file cut off inside a quote', () => {
    expect(() => parseCsv('a,b\n"unterminated,1\n')).toThrow(/cut off/);
  });

  it('rejects too many rows', () => {
    const big = 'a\n'.repeat(CSV_LIMITS.maxRows + 2);
    expect(() => parseCsv(big)).toThrow(/rows/);
  });

  it('rejects absurdly long cells and too many columns', () => {
    expect(() => parseCsv(`a,${'x'.repeat(CSV_LIMITS.maxCellLength + 1)}`)).toThrow(/too long/);
    expect(() => parseCsv(Array.from({ length: CSV_LIMITS.maxColumns + 2 }, () => 'x').join(','))).toThrow(/columns/);
  });

  it('treats spreadsheet formulas as plain text (never evaluated)', () => {
    expect(parseCsv('=HYPERLINK("http://x"),@SUM(1)')[0]).toEqual(['=HYPERLINK("http://x")', '@SUM(1)']);
  });
});

describe('bank dates', () => {
  it.each([
    ['10/29/2026', 'MDY', '2026-10-29'],
    ['1/5/26', 'MDY', '2026-01-05'],
    ['2026-10-31', 'YMD', '2026-10-31'],
    ['31.10.2026', 'DMY', '2026-10-31'],
    ['10/29/2026 07:41 am', 'MDY', '2026-10-29'],
  ] as const)('%s (%s) -> %s', (text, fmt, iso) => {
    expect(parseBankDate(text, fmt)).toBe(iso);
  });

  it.each(['Date downloaded', '13/45/2026', '', '2026/02/30', 'abc'])('rejects %j', (t) => {
    expect(parseBankDate(t, 'MDY')).toBeNull();
  });

  it('guesses the format', () => {
    expect(guessDateFormat(['2026-10-01'])).toBe('YMD');
    expect(guessDateFormat(['10/29/2026'])).toBe('MDY');
    expect(guessDateFormat(['29/10/2026'])).toBe('DMY');
  });
});

describe('Wright-Patt layout', () => {
  const rows = parseCsv(fixture('wpcu-checking.csv'));

  it('finds the header under the account info lines and recognizes the bank', () => {
    const h = findHeaderRow(rows);
    expect(h).toBe(3);
    expect(detectPreset(rows[h]!)?.name).toBe('Wright-Patt Credit Union');
  });

  it('reads money out and in from separate columns, skips comment lines, keeps balances', () => {
    const m = suggestMapping(rows, 3);
    expect(validateMapping(m, rows[3]!)).toBeNull();
    const { parsed, skipped } = applyMapping(rows, m);
    expect(parsed).toHaveLength(7);
    expect(skipped).toEqual([{ line: 9, reason: 'No amount (a note or comment line)' }]);
    expect(parsed.map((p) => p.amountCents)).toEqual([-1199, -645, 8500, -1000, -2340, -25000, 10000]);
    expect(parsed[0]!.description).toBe('Spotify USA NY');
    expect(parsed[1]!.description).toBe('EXAMPLE COFFEE CO ANYTOWN US');
    expect(parsed[1]!.rawDescription).toContain('Withdrawal DEBIT CHIP');
    expect(parsed.every((p) => Number.isInteger(p.amountCents))).toBe(true);
  });

  it('end-of-day balances from a newest-first file', () => {
    const { parsed } = applyMapping(rows, suggestMapping(rows, 3));
    const bal = endOfDayBalances(parsed);
    expect(bal.get('2026-10-29')).toBe(41025);
    expect(bal.get('2026-08-03')).toBe(62709);
    expect(bal.size).toBe(7);
  });

  it('end-of-day balance takes the LAST row of the day in an oldest-first file', () => {
    const asc = endOfDayBalances([
      { line: 1, date: '2026-01-01', amountCents: -1, description: '', rawDescription: '', balanceCents: 100 },
      { line: 2, date: '2026-01-01', amountCents: -1, description: '', rawDescription: '', balanceCents: 99 },
      { line: 3, date: '2026-01-02', amountCents: -1, description: '', rawDescription: '', balanceCents: 98 },
    ]);
    expect(asc.get('2026-01-01')).toBe(99);
  });

  it('handles a quoted memo with commas inside (savings file)', () => {
    const r = parseCsv(fixture('wpcu-savings.csv'));
    const { parsed } = applyMapping(r, suggestMapping(r, findHeaderRow(r)));
    expect(parsed.find((p) => p.amountCents === 200000)?.rawDescription).toContain('2,000.00');
  });
});

describe('Climate First layout', () => {
  const rows = parseCsv(fixture('climatefirst-checking.csv'));
  it('recognizes the bank and uses the Credit/Debit column for the sign', () => {
    expect(detectPreset(rows[0]!)?.name).toBe('Climate First Bank');
    const { parsed } = applyMapping(rows, suggestMapping(rows, 0));
    expect(parsed.map((p) => [p.date, p.amountCents])).toEqual([
      ['2026-10-31', 12],
      ['2026-10-20', -425],
      ['2026-10-20', -425],
      ['2026-09-30', 5500],
    ]);
  });
});

describe('unknown bank layouts', () => {
  it('suggests a sensible mapping for a simple file', () => {
    const rows = parseCsv('Posted Date,Payee,Amount,Running Balance\n2026-01-02,COFFEE,-4.50,95.50\n');
    const m = suggestMapping(rows, findHeaderRow(rows));
    expect(m).toMatchObject({ dateColumn: 'Posted Date', dateFormat: 'YMD', amountMode: 'single', amountColumn: 'Amount', balanceColumn: 'Running Balance' });
    expect(m.descriptionColumns).toEqual(['Payee']);
  });

  it('can flip signs for banks that show spending as positive', () => {
    const rows = parseCsv('Date,Description,Amount\n01/02/2026,COFFEE,4.50\n');
    const { parsed } = applyMapping(rows, { ...suggestMapping(rows, 0), invertAmount: true });
    expect(parsed[0]!.amountCents).toBe(-450);
  });

  it('explains a broken mapping in plain language', () => {
    expect(validateMapping({ headerRow: 0, dateColumn: 'Nope', dateFormat: 'MDY', descriptionColumns: ['A'], amountMode: 'single', amountColumn: 'A' }, ['A'])).toMatch(/date/);
  });

  it('reports bad rows instead of guessing', () => {
    const rows = parseCsv('Date,Description,Amount\nnot a date,X,1\n01/02/2026,Y,abc\n01/03/2026,Z,1.005\n');
    const { parsed, skipped } = applyMapping(rows, suggestMapping(rows, 0));
    expect(parsed).toHaveLength(0);
    expect(skipped.map((s) => s.reason)).toEqual(['"not a date" is not a date', 'The amount is not a valid number', 'The amount is not a valid number']);
  });
});

describe('Fidelity layout', () => {
  it('finds the header after blank lines, ignores the footer, and reads shares and prices exactly', () => {
    const rows = parseCsv(fixture('fidelity-brokerage.csv'));
    const h = findFidelityHeader(rows)!;
    expect(h).toBe(2);
    const { parsed, skipped } = parseFidelity(rows, h);
    expect(skipped).toEqual([]);
    expect(parsed.map((p) => p.kind)).toEqual(['buy', 'buy', 'transfer_in']);
    expect(parsed[0]).toMatchObject({ symbol: 'FTIHX', quantityMicro: 19_672_000, priceE4: 152_500, amountCents: -30000 });
    expect(parsed[2]).toMatchObject({ amountCents: 150000, quantityMicro: 0 });
  });

  it('knows contribution tax years, dividends and reinvestments', () => {
    const rows = parseCsv(fixture('fidelity-roth.csv'));
    const { parsed } = parseFidelity(rows, findFidelityHeader(rows)!);
    expect(parsed.map((p) => [p.kind, p.taxYear])).toEqual([
      ['reinvest', null],
      ['dividend', null],
      ['buy', null],
      ['contribution', 2026],
      ['contribution', 2025],
    ]);
    expect(parsed[0]!.quantityMicro).toBe(21_500);
  });

  it.each([
    ['YOU SOLD FOO', 'sell'],
    ['Electronic Funds Transfer Paid (Cash)', 'transfer_out'],
    ['FEE CHARGED', 'fee'],
    ['SOMETHING NEW', 'other'],
  ])('classifies %s as %s', (a, k) => {
    expect(classifyAction(a)).toBe(k);
  });

  it('share and price parsing is exact and strict', () => {
    expect(parseSharesToMicro('178.195')).toBe(178_195_000);
    expect(parseSharesToMicro('-0.025')).toBe(-25_000);
    expect(parsePriceToE4('258.7')).toBe(2_587_000);
    expect(() => parseSharesToMicro('1.1234567')).toThrow();
    expect(() => parsePriceToE4('abc')).toThrow();
  });
});

describe('descriptions and duplicates', () => {
  it('cleans card and reference noise but keeps the merchant', () => {
    expect(cleanDescription('EXAMPLEFLIX* VIDEO SUB EXAMPLEFLIX.COM CA Date 10/29/26 24000000000000000000099')).toBe(
      'EXAMPLEFLIX* VIDEO SUB EXAMPLEFLIX.COM CA',
    );
    expect(cleanDescription('#600000000123  Streamly USA 800-5550100 NY')).toBe('Streamly USA NY');
    expect(cleanDescription('   ')).toBe('');
    expect(cleanDescription('TYPE: MONEYLINE ID: 0000000000 CO: FID BKG SVC LLC NAME: SAMPLE PERSON Entry Class Code: WEB ACH')).toBe('FID BKG SVC LLC');
  });

  it('counts repeats so real identical charges are kept but re-imports are skipped', () => {
    const k = fingerprint(['2026-01-01', -425, 'MART']);
    expect(planDedupe([k, k], () => 0)).toEqual([true, true]); // first import: both are real
    expect(planDedupe([k, k], () => 2)).toEqual([false, false]); // re-import: both already there
    expect(planDedupe([k, k, k], () => 2)).toEqual([false, false, true]); // a third one appeared
  });
});
