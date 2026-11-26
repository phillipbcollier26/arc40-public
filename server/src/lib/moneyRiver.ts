/**
 * Money river, database side (read-only). Income, spending and gifts come ONLY from the shared money
 * lines (lib/totals.ts, split pieces included); transfers come from loadTransferLegs. The math is in
 * lib/river.ts. Nothing here ever writes.
 */
import type { DB } from '../db/database.js';
import type { IsoDate } from '../../../shared/dates.js';
import { listAccounts } from './accounts.js';
import { listCategories } from './transactions.js';
import { loadMoneyLines, loadTransferLegs } from './totals.js';
import { buildRiver, classifyTransfers, legWindow, riverDates, type RiverRange } from './river.js';
import { pairKey } from './transfers.js';

export function blockedPairs(db: DB): Set<string> {
  return new Set(
    (db.prepare('SELECT low_id, high_id FROM transfer_link_blocks').all() as { low_id: number; high_id: number }[]).map((r) =>
      pairKey(r.low_id, r.high_id),
    ),
  );
}

/** The river between two dates (inclusive). */
export function riverBetween(db: DB, from: IsoDate, to: IsoDate) {
  const accounts = listAccounts(db, { includeArchived: true }).map((a) => ({
    id: a.id,
    name: a.name,
    institution: a.institution,
    isInvestment: a.isInvestment,
    sortOrder: a.sortOrder,
  }));
  const categories = listCategories(db).map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    earned: c.role === 'refereeing' || c.role === 'other_income',
  }));
  const lines = loadMoneyLines(db, { from, to });
  const legs = classifyTransfers(loadTransferLegs(db, legWindow(from, to)), accounts, from, to, blockedPairs(db));
  return buildRiver(lines, legs, accounts, categories);
}

export function moneyRiver(db: DB, range: RiverRange, today: IsoDate) {
  const { from, to } = riverDates(range, today);
  return { range, from, to, ...riverBetween(db, from, to) };
}
