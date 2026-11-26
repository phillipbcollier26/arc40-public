/**
 * Fund price history import, for ONE fund chosen on the Investments page (never guessed from the file).
 * Preview never writes. Saving stores each close as a 'history' price (the best source, lib/prices.ts)
 * and remembers the file's columns for that fund. "Remove price history" deletes only that fund's
 * 'history' prices. Parsing is in lib/priceHistory.ts.
 *
 * A safety check (not a guess): when Arc40 already has other prices for some of the same days (Fidelity
 * purchases, positions files), the file's closes are compared with them. If they are far apart the
 * preview warns that the file may be for a different fund. It never changes which fund is used.
 */
import type { DB } from '../db/database.js';
import { transaction } from '../db/database.js';
import { addDays, type IsoDate } from '../../../shared/dates.js';
import { parseCsv } from './csv.js';
import { loadPricePoints, loadPrices, savePrice } from './prices.js';
import { PriceLine } from './valuation.js';
import { findHistoryHeader, isAdjusted, parseHistory, suggestColumns, type HistoryColumns } from './priceHistory.js';

export class PriceHistoryError extends Error {}

/** A file's prices are "far apart" from Arc40's when the typical difference is more than 10%. */
export const MISMATCH_BP = 1000;

function fund(db: DB, symbol: string): { symbol: string; name: string } {
  const r = db.prepare('SELECT symbol, name FROM securities WHERE symbol = ?').get(symbol) as { symbol: string; name: string } | undefined;
  if (!r) throw new PriceHistoryError(`Arc40 does not know a fund called ${symbol}. Import its Fidelity history first.`);
  return r;
}

function savedColumns(db: DB, symbol: string): HistoryColumns | null {
  const r = db.prepare('SELECT date_column, price_column FROM price_history_columns WHERE symbol = ?').get(symbol) as
    | { date_column: string; price_column: string }
    | undefined;
  return r ? { dateColumn: r.date_column, priceColumn: r.price_column } : null;
}

/** Each fund's imported history: how many closes and from when to when. */
export function historySummary(db: DB): Map<string, { count: number; first: IsoDate; last: IsoDate }> {
  const rows = db
    .prepare("SELECT symbol, COUNT(*) AS n, MIN(as_of) AS a, MAX(as_of) AS b FROM price_points WHERE source = 'history' GROUP BY symbol")
    .all() as { symbol: string; n: number; a: string; b: string }[];
  return new Map(rows.map((r) => [r.symbol, { count: r.n, first: r.a, last: r.b }]));
}

export function analyzePriceHistory(db: DB, input: { symbol: string; text: string; columns?: HistoryColumns }, today: IsoDate) {
  const f = fund(db, input.symbol);
  const rows = parseCsv(input.text);
  const headerRow = findHistoryHeader(rows);
  if (headerRow === null) throw new PriceHistoryError('That file is empty.');
  const headers = rows[headerRow]!.map((h) => h.trim()).filter(Boolean);
  const suggested = suggestColumns(headers);
  const saved = savedColumns(db, f.symbol);
  const valid = (c: HistoryColumns | null | undefined) => !!c && headers.includes(c.dateColumn) && headers.includes(c.priceColumn);
  let columns: HistoryColumns | null = null;
  let columnsSource: 'provided' | 'saved' | 'recognized' | null = null;
  if (input.columns) {
    if (!valid(input.columns)) throw new PriceHistoryError('Pick the date column and the closing price column from the file.');
    if (input.columns.dateColumn === input.columns.priceColumn) throw new PriceHistoryError('The date and the price have to be different columns.');
    columns = input.columns;
    columnsSource = 'provided';
  } else if (valid(saved)) {
    columns = saved;
    columnsSource = 'saved';
  } else if (suggested.dateColumn && suggested.priceColumn) {
    columns = { dateColumn: suggested.dateColumn, priceColumn: suggested.priceColumn };
    columnsSource = 'recognized';
  }
  const base = {
    symbol: f.symbol,
    name: f.name,
    headers,
    sampleRows: rows.slice(headerRow + 1, headerRow + 6),
    columns,
    columnsSource,
    existing: historySummary(db).get(f.symbol) ?? null,
  };
  if (!columns) return { ...base, needsColumns: true as const, prices: [], skipped: [], count: 0, first: null, last: null, adjustedWarning: false, mismatch: null };

  const parsed = parseHistory(rows, headerRow, columns, today);
  if (!parsed.prices.length) throw new PriceHistoryError('No usable prices were found in that file. Check the columns.');

  // Safety check against prices Arc40 already has from other sources on the same days.
  const others = new Map(
    loadPricePoints(db)
      .filter((p) => p.symbol === f.symbol && p.source !== 'history')
      .map((p) => [p.asOf, p.priceE4]),
  );
  const ratios = parsed.prices.filter((p) => others.has(p.date)).map((p) => Math.round((Math.abs(p.priceE4 - others.get(p.date)!) * 10_000) / others.get(p.date)!));
  ratios.sort((a, b) => a - b);
  const typical = ratios.length ? ratios[Math.floor((ratios.length - 1) / 2)]! : null;
  const mismatch = typical !== null && typical > MISMATCH_BP ? { comparedDays: ratios.length, typicalDiffBp: typical } : null;

  return {
    ...base,
    needsColumns: false as const,
    prices: parsed.prices,
    skipped: parsed.skipped.slice(0, 200),
    skippedCount: parsed.skipped.length,
    count: parsed.prices.length,
    first: parsed.prices[0]!.date,
    last: parsed.prices.at(-1)!.date,
    adjustedWarning: isAdjusted(columns.priceColumn),
    mismatch,
  };
}

export function commitPriceHistory(db: DB, input: { symbol: string; text: string; columns?: HistoryColumns }, today: IsoDate, now: number) {
  const a = analyzePriceHistory(db, input, today);
  if (a.needsColumns || !a.columns) throw new PriceHistoryError('Pick the date column and the closing price column first.');
  transaction(db, () => {
    for (const p of a.prices) savePrice(db, { symbol: a.symbol, asOf: p.date, priceE4: p.priceE4, source: 'history' }, now);
    db.prepare(
      `INSERT INTO price_history_columns (symbol, date_column, price_column, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (symbol) DO UPDATE SET date_column = excluded.date_column, price_column = excluded.price_column, updated_at = excluded.updated_at`,
    ).run(a.symbol, a.columns!.dateColumn, a.columns!.priceColumn, now);
  });
  return { symbol: a.symbol, saved: a.count, first: a.first, last: a.last, skipped: a.skippedCount };
}

export function deletePriceHistory(db: DB, symbol: string): number {
  return Number(db.prepare("DELETE FROM price_points WHERE symbol = ? AND source = 'history'").run(symbol).changes);
}

/**
 * Demo mode only: a FAKE daily history file for one fund, in a common website layout (with an
 * "Adj Close" column Arc40 must ignore), built from the demo's own prices for the last 180 days.
 */
export function samplePriceHistory(db: DB, symbol: string, today: IsoDate): string {
  fund(db, symbol);
  const line = new PriceLine(loadPrices(db).filter((p) => p.symbol === symbol));
  const out: string[] = [];
  let step = 0;
  for (let d = addDays(today, -180); d <= today; d = addDays(d, 1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const at = line.at(d);
    if (at.priceE4 === null) continue;
    // After the demo's last real close, the FAKE file keeps going with a small made-up wobble
    // (instead of repeating an old price), so importing it brings the demo prices up to date.
    const p = at.state === 'stale' ? Math.round((at.priceE4 * (10_000 + Math.round(40 * Math.sin(++step)))) / 10_000) : at.priceE4;
    const close = `${Math.floor(p / 10_000)}.${String(p % 10_000).padStart(4, '0').slice(0, 2)}`;
    out.push([d, close, close, close, close, close, '0'].join(','));
  }
  return ['Date,Open,High,Low,Close,Adj Close,Volume', ...out.reverse()].join('\n'); // newest first, like most sites
}
