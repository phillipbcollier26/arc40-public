import { loadActivity } from './activity.js';
import { loadPrices } from './prices.js';
import { priceLines, valueAccountDaily, type DayValue } from './valuation.js';
import type { DB } from '../db/database.js';
import { transaction } from '../db/database.js';
import { ACCOUNT_TYPES, type AccountClass, type AccountType } from '../../../shared/accounts.js';
import type { IsoDate } from '../../../shared/dates.js';
import type { Cents } from './money.js';
import type { NwAccount, NwFlow, NwSnapshot } from './networth.js';
import { repairTransferLinks } from './transactions.js';

/** Database access for accounts and balance snapshots. */

export interface AccountRow {
  id: number;
  name: string;
  institution: string;
  type: AccountType;
  class: AccountClass;
  isInvestment: boolean;
  sortOrder: number;
  archived: boolean;
  notes: string;
  createdAt: number;
}

export interface SnapshotRow {
  id: number;
  accountId: number;
  asOf: IsoDate;
  balanceCents: Cents;
  source: string;
  note: string;
}

type RawAccount = {
  id: number;
  name: string;
  institution: string;
  type: AccountType;
  class: AccountClass;
  is_investment: number;
  sort_order: number;
  archived: number;
  notes: string;
  created_at: number;
};

const mapAccount = (r: RawAccount): AccountRow => ({
  id: r.id,
  name: r.name,
  institution: r.institution,
  type: r.type,
  class: r.class,
  isInvestment: r.is_investment === 1,
  sortOrder: r.sort_order,
  archived: r.archived === 1,
  notes: r.notes,
  createdAt: r.created_at,
});

export function listAccounts(db: DB, opts: { includeArchived?: boolean } = {}): AccountRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM accounts ${opts.includeArchived ? '' : 'WHERE archived = 0'} ORDER BY sort_order, id`,
    )
    .all() as RawAccount[];
  return rows.map(mapAccount);
}

export function getAccount(db: DB, id: number): AccountRow | null {
  const r = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as RawAccount | undefined;
  return r ? mapAccount(r) : null;
}

export function createAccount(
  db: DB,
  input: { name: string; institution: string; type: AccountType; notes?: string },
  now: number,
): AccountRow {
  const info = ACCOUNT_TYPES[input.type];
  const nextOrder =
    (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM accounts').get() as { n: number }).n;
  const res = db
    .prepare(
      `INSERT INTO accounts (name, institution, type, class, is_investment, sort_order, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      input.institution,
      input.type,
      info.class,
      info.isInvestment ? 1 : 0,
      nextOrder,
      input.notes ?? '',
      now,
      now,
    );
  return getAccount(db, Number(res.lastInsertRowid))!;
}

export function updateAccount(
  db: DB,
  id: number,
  patch: Partial<{ name: string; institution: string; type: AccountType; archived: boolean; notes: string }>,
  now: number,
): AccountRow | null {
  const existing = getAccount(db, id);
  if (!existing) return null;
  const type = patch.type ?? existing.type;
  const info = ACCOUNT_TYPES[type];
  db.prepare(
    `UPDATE accounts SET name = ?, institution = ?, type = ?, class = ?, is_investment = ?,
       archived = ?, notes = ?, updated_at = ? WHERE id = ?`,
  ).run(
    patch.name ?? existing.name,
    patch.institution ?? existing.institution,
    type,
    info.class,
    info.isInvestment ? 1 : 0,
    (patch.archived ?? existing.archived) ? 1 : 0,
    patch.notes ?? existing.notes,
    now,
    id,
  );
  return getAccount(db, id);
}

/**
 * Deletes an account with everything in it (transactions, imports, balances, activity).
 * Transfers into or out of it in OTHER accounts lose their partner, so their links are
 * cleared and their original type restored (same repair as undoing an import).
 */
export function deleteAccount(db: DB, id: number): boolean {
  return transaction(db, () => {
    const ok = db.prepare('DELETE FROM accounts WHERE id = ?').run(id).changes > 0;
    if (ok) repairTransferLinks(db);
    return ok;
  });
}

/** Insert or replace the balance for an account on a given day. */
export function upsertSnapshot(
  db: DB,
  accountId: number,
  asOf: IsoDate,
  balanceCents: Cents,
  now: number,
  opts: { source?: string; note?: string } = {},
): SnapshotRow {
  db.prepare(
    `INSERT INTO balance_snapshots (account_id, as_of, balance_cents, source, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (account_id, as_of) DO UPDATE SET
       balance_cents = excluded.balance_cents, source = excluded.source, note = excluded.note`,
  ).run(accountId, asOf, balanceCents, opts.source ?? 'manual', opts.note ?? '', now);
  const r = db
    .prepare('SELECT * FROM balance_snapshots WHERE account_id = ? AND as_of = ?')
    .get(accountId, asOf) as RawSnapshot;
  return mapSnapshot(r);
}

type RawSnapshot = {
  id: number;
  account_id: number;
  as_of: string;
  balance_cents: number;
  source: string;
  note: string;
};
const mapSnapshot = (r: RawSnapshot): SnapshotRow => ({
  id: r.id,
  accountId: r.account_id,
  asOf: r.as_of,
  balanceCents: r.balance_cents,
  source: r.source,
  note: r.note,
});

export function listSnapshots(db: DB, accountId?: number): SnapshotRow[] {
  const rows = (
    accountId === undefined
      ? db.prepare('SELECT * FROM balance_snapshots ORDER BY as_of, id').all()
      : db.prepare('SELECT * FROM balance_snapshots WHERE account_id = ? ORDER BY as_of, id').all(accountId)
  ) as RawSnapshot[];
  return rows.map(mapSnapshot);
}

export function deleteSnapshot(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM balance_snapshots WHERE id = ?').run(id).changes > 0;
}

/**
 * Everything the net worth math needs. For investment accounts with Fidelity activity, every day that
 * has a usable price (known, estimated or stale, see lib/valuation.ts) through `today` becomes a
 * balance for that day: shares x price + cash. Because that daily value already includes the money
 * that moved that day, the transfer transactions are never counted on top of it (balances are
 * end-of-day; only flows AFTER a balance's date are added). Balances the user typed in or imported
 * still win on their own date; the old "Use holdings value" (computed) balances of a valued account are
 * replaced by the daily values. Days with no price data keep the older rule (money put in).
 */
export function toNw(
  db: DB,
  accounts: AccountRow[],
  snaps: SnapshotRow[],
  today: IsoDate,
): {
  accounts: NwAccount[];
  snapshots: NwSnapshot[];
  flows: NwFlow[];
  changeDates: IsoDate[];
  /** Daily values (with price states) of investment accounts, by account id. */
  valuation: Map<number, DayValue[]>;
} {
  const flows = (
    db.prepare('SELECT account_id, date, amount_cents FROM transactions ORDER BY date, id').all() as {
      account_id: number;
      date: string;
      amount_cents: number;
    }[]
  ).map((r) => ({ accountId: r.account_id, date: r.date, amountCents: r.amount_cents }));
  const valuation = new Map<number, DayValue[]>();
  const invIds = new Set(accounts.filter((a) => a.isInvestment).map((a) => a.id));
  const acts = loadActivity(db).filter((a) => invIds.has(a.accountId));
  if (acts.length) {
    const lines = priceLines(loadPrices(db));
    for (const id of invIds) {
      const mine = acts.filter((a) => a.accountId === id);
      if (mine.length) valuation.set(id, valueAccountDaily(mine, lines, mine[0]!.date, today));
    }
  }
  const valued = (id: number) => (valuation.get(id) ?? []).some((v) => v.valueCents !== null);
  const kept = snaps.filter((s) => !(valued(s.accountId) && s.source === 'computed'));
  const realDays = new Set(kept.map((s) => `${s.accountId}|${s.asOf}`));
  const snapshots = kept.map((s) => ({ accountId: s.accountId, asOf: s.asOf, balanceCents: s.balanceCents }));
  for (const [id, days] of valuation) {
    for (const v of days) {
      if (v.valueCents !== null && !realDays.has(`${id}|${v.date}`)) snapshots.push({ accountId: id, asOf: v.date, balanceCents: v.valueCents });
    }
  }
  // Every valued day (unavailable ones included) is a chart point, so charts can label each day's
  // price state instead of drawing a silent straight line across days without prices.
  const valuationDates = [...valuation.values()].flatMap((days) => days.map((v) => v.date));
  return {
    valuation,
    accounts: accounts.map((a) => ({ id: a.id, class: a.class, isInvestment: a.isInvestment })),
    snapshots,
    flows,
    changeDates: [...new Set([...snapshots.map((s) => s.asOf), ...flows.map((f) => f.date), ...valuationDates])],
  };
}
