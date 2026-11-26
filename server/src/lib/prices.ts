/**
 * Fund prices: the ONE place that reads and writes them.
 *
 * Every source keeps its own row (table price_points). The price used for a fund on a day is the
 * best source that has one (the user's rule: prices from files beat prices typed in by hand):
 *   history (price history file) > positions (Fidelity positions file) > trade (Fidelity history
 *   buy/reinvest price) > manual (the emergency "Edit price")
 * So an emergency edit never erases a file price, and deleting it brings the file price back.
 */
import type { DB } from '../db/database.js';
import type { IsoDate } from '../../../shared/dates.js';
import type { Price } from './investments.js';

export const PRICE_SOURCES = ['history', 'positions', 'trade', 'manual'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];
const RANK: Record<PriceSource, number> = { history: 4, positions: 3, trade: 2, manual: 1 };

export interface PricePoint extends Price {
  source: PriceSource;
}

/** Pure: one price per (symbol, day), the best source wins. */
export function bestPrices(points: readonly PricePoint[]): PricePoint[] {
  const best = new Map<string, PricePoint>();
  for (const p of points) {
    const k = `${p.symbol}|${p.asOf}`;
    const cur = best.get(k);
    if (!cur || RANK[p.source] > RANK[cur.source]) best.set(k, p);
  }
  return [...best.values()].sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0));
}

export function loadPricePoints(db: DB): PricePoint[] {
  return (
    db.prepare('SELECT symbol, as_of, source, price_e4 FROM price_points').all() as { symbol: string; as_of: string; source: PriceSource; price_e4: number }[]
  ).map((r) => ({ symbol: r.symbol, asOf: r.as_of, source: r.source, priceE4: r.price_e4 }));
}

/** The prices every screen uses (best source per fund per day). */
export function loadPrices(db: DB): PricePoint[] {
  return bestPrices(loadPricePoints(db));
}

/** Saves (or replaces) one source's price for a fund on a day. Creates the fund if needed. */
export function savePrice(db: DB, p: { symbol: string; asOf: IsoDate; priceE4: number; source: PriceSource; name?: string }, now: number): void {
  db.prepare('INSERT INTO securities (symbol, name) VALUES (?, ?) ON CONFLICT (symbol) DO NOTHING').run(p.symbol, p.name ?? '');
  if (p.name) db.prepare("UPDATE securities SET name = ? WHERE symbol = ? AND name = ''").run(p.name, p.symbol);
  db.prepare(
    `INSERT INTO price_points (symbol, as_of, source, price_e4, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (symbol, as_of, source) DO UPDATE SET price_e4 = excluded.price_e4, created_at = excluded.created_at`,
  ).run(p.symbol, p.asOf, p.source, p.priceE4, now);
}

/** Saves a price only if that source has none for that day yet (Fidelity history imports). */
export function savePriceIfMissing(db: DB, p: { symbol: string; asOf: IsoDate; priceE4: number; source: PriceSource }, now: number): void {
  db.prepare('INSERT OR IGNORE INTO price_points (symbol, as_of, source, price_e4, created_at) VALUES (?, ?, ?, ?, ?)').run(
    p.symbol,
    p.asOf,
    p.source,
    p.priceE4,
    now,
  );
}

export function deletePrice(db: DB, symbol: string, asOf: IsoDate, source: PriceSource): boolean {
  return db.prepare('DELETE FROM price_points WHERE symbol = ? AND as_of = ? AND source = ?').run(symbol, asOf, source).changes > 0;
}
