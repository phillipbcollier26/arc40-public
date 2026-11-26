/**
 * Shared helpers for the FAKE demo dataset. Every seeder gets one DemoContext.
 * Nothing here may contain real names, emails, account numbers or real figures.
 */
import type { DB } from '../../db/database.js';
import { addDays, daysInMonth, type IsoDate } from '../../../../shared/dates.js';
import { insertTransaction, listCategories } from '../transactions.js';
import type { AccountRow } from '../accounts.js';

/** Small seeded random generator (mulberry32) so demo data is repeatable. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fund buys queued by the banking seeder and turned into investment activity by the investments seeder. */
export interface DemoBuy {
  accountId: number;
  date: IsoDate;
  cents: number;
  kind: 'contribution' | 'transfer_in';
  split: [string, number][];
}

export interface DemoContext {
  db: DB;
  /** Last day of the dataset. The data always ends "today" so charts look current. */
  today: IsoDate;
  /** First day of the two-year history. */
  start: IsoDate;
  /** Timestamp written to created_at / updated_at columns. */
  now: number;
  /**
   * The v1 random stream (seed 40). The v1 seeders share it, in order, so their numbers never change.
   * NEW seeders must not use it: call `rngFor('my-feature')` so adding them never shifts older data.
   */
  rand: () => number;
  rngFor: (name: string) => () => number;
  /** Whole cents between lo and hi, from `rand`. */
  between: (lo: number, hi: number) => number;
  pick: <T>(xs: readonly T[]) => T;
  /** A random day inside the month that starts at `month`, never after today. */
  dayIn: (month: IsoDate) => IsoDate;
  /** Category id by name (the built-in categories from the migrations). */
  cat: Map<string, number>;
  /** Adds a manual transaction and returns its id. */
  tx: (
    accountId: number,
    date: IsoDate,
    cents: number,
    description: string,
    type: 'income' | 'expense' | 'transfer' | 'gift',
    category?: string,
    extra?: { giftFrom?: string; payer?: string },
  ) => number;
  /** Accounts created by the accounts seeder, by role. */
  accounts: { checking: AccountRow; hysa: AccountRow; roth: AccountRow; brokerage: AccountRow };
  buys: DemoBuy[];
}

/** Stable small hash so `rngFor(name)` gives every feature its own repeatable stream. */
function seedOf(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function makeContext(db: DB, today: IsoDate, now: number, accounts: DemoContext['accounts']): DemoContext {
  const rand = rng(40);
  const ctx: DemoContext = {
    db,
    today,
    start: addDays(today, -730),
    now,
    rand,
    rngFor: (name) => rng(seedOf(name)),
    between: (lo, hi) => Math.round(lo + rand() * (hi - lo)),
    pick: (xs) => xs[Math.floor(rand() * xs.length)]!,
    dayIn: (month) => {
      const [y, m] = month.split('-').map(Number) as [number, number];
      const d = `${month.slice(0, 8)}${String(1 + Math.floor(rand() * daysInMonth(y, m))).padStart(2, '0')}`;
      return d > today ? today : d;
    },
    cat: new Map(),
    tx: (accountId, date, cents, description, type, category, extra = {}) =>
      insertTransaction(
        db,
        { accountId, date, amountCents: cents, description, type, categoryId: category ? (ctx.cat.get(category) ?? null) : null, source: 'manual', ...extra },
        now,
      ),
    accounts,
    buys: [],
  };
  ctx.cat = new Map(listCategories(db).map((c) => [c.name, c.id]));
  return ctx;
}
