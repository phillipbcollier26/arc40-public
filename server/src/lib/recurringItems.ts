/**
 * Recurring charges: database access and the Recurring page's data.
 * The detection math is pure and lives in lib/recurring.ts.
 *
 *  - Charges are WHOLE expense transactions (money out, not transfers, not refunds). A split
 *    transaction is one charge with its full amount; its pieces only decide the category shown.
 *  - Suggestions are recomputed on every request. A suggestion is hidden when a saved item
 *    (confirmed, cancelled or manual) or a dismissal from the same merchant at a nearby amount
 *    already covers it, so dismissed suggestions stay dismissed and confirmed ones never repeat.
 *  - Costs: yearly = one charge x charges per year (exact cents); monthly = yearly / 12, rounded
 *    to the cent once. The headline total is the sum of the confirmed items' yearly costs.
 */
import type { DB } from '../db/database.js';
import { addDays, type IsoDate } from '../../../shared/dates.js';
import type { Cents } from './money.js';
import { listAccounts, listSnapshots, toNw } from './accounts.js';
import { netWorthOn } from './networth.js';
import {
  amountNear,
  dueDatesBetween,
  chargesForItem,
  findSeries,
  isActive,
  isNew,
  merchantKey,
  monthlyCents,
  keepBillingDay,
  nextDue,
  priceIncrease,
  SCHEDULE_LABELS,
  tierFor,
  yearlyCents,
  type Charge,
  type Schedule,
  type Series,
} from './recurring.js';
import { addMonths, endOfMonth, startOfMonth } from '../../../shared/dates.js';

export class RecurringError extends Error {}

/** Every whole expense transaction that cost money, with split pieces' categories (biggest first). */
export function loadCharges(db: DB): Charge[] {
  const rows = db
    .prepare(
      `SELECT id, date, -amount_cents AS cost, description, category_id FROM transactions
       WHERE type = 'expense' AND amount_cents < 0 AND transfer_group_id IS NULL ORDER BY date, id`,
    )
    .all() as { id: number; date: string; cost: number; description: string; category_id: number | null }[];
  const pieces = new Map<number, number[]>();
  for (const p of db
    .prepare('SELECT transaction_id, category_id FROM transaction_splits ORDER BY transaction_id, ABS(amount_cents) DESC, position')
    .all() as { transaction_id: number; category_id: number | null }[]) {
    if (p.category_id === null) continue;
    const list = pieces.get(p.transaction_id) ?? [];
    if (!list.includes(p.category_id)) list.push(p.category_id);
    pieces.set(p.transaction_id, list);
  }
  return rows.map((r) => ({
    txId: r.id,
    date: r.date,
    amountCents: r.cost,
    description: r.description,
    categoryId: r.category_id,
    splitCategoryIds: pieces.get(r.id) ?? [],
  }));
}

interface ItemRow {
  id: number;
  name: string;
  merchant_key: string | null;
  amount_cents: number;
  schedule: Schedule;
  anchor_date: string;
  billing_day: number | null;
  category_id: number | null;
  status: 'confirmed' | 'cancelled';
  source: 'detected' | 'manual';
  cancelled_on: string | null;
}

/** What the Recurring page shows for one charge (saved item or suggestion). */
interface CostView {
  name: string;
  schedule: Schedule;
  scheduleLabel: string;
  amountCents: Cents;
  yearlyCents: Cents;
  monthlyCents: Cents;
  nextDue: IsoDate | null;
  /** The date the schedule counts from (the later of the saved anchor and the newest charge). */
  scheduleAnchor: IsoDate;
  /** The category shown: the item's own, else the newest charge's (the biggest piece's, if split). */
  categoryId: number | null;
  /** When the newest charge is split: every piece's category, biggest first. */
  splitCategoryIds: number[];
  chargeCount: number;
  firstSeen: IsoDate | null;
  lastCharge: { date: IsoDate; amountCents: Cents; txId: number } | null;
  isNew: boolean;
  priceIncrease: { fromCents: Cents; toCents: Cents } | null;
  /** Lowest and highest of the recent charges, when they differ (e.g. a phone bill). */
  varies: { lowCents: Cents; highCents: Cents } | null;
}

export interface ItemView extends CostView {
  id: number;
  source: 'detected' | 'manual';
  status: 'confirmed' | 'cancelled';
  anchorDate: IsoDate;
  cancelledOn: IsoDate | null;
  tier: 'gold' | 'silver' | 'bronze' | null;
}

export interface SuggestionView extends CostView {
  key: string;
}

function costView(
  name: string,
  schedule: Schedule,
  amountCents: Cents,
  charges: readonly Charge[],
  today: IsoDate,
  opts: { anchor: IsoDate | null; categoryId: number | null; cancelled: boolean },
): CostView {
  const last = charges.at(-1) ?? null;
  const recent = charges.slice(-6).map((c) => c.amountCents);
  const low = recent.length ? Math.min(...recent) : amountCents;
  const high = recent.length ? Math.max(...recent) : amountCents;
  const raise = priceIncrease(charges);
  const base = opts.anchor && last && last.date > opts.anchor ? last.date : (opts.anchor ?? last?.date ?? today);
  // Audit F-06: a Feb 28 charge must not move a bill on the 29th to 31st to the 28th for good.
  const anchor = keepBillingDay(base, schedule, charges.map((c) => c.date));
  return {
    name,
    schedule,
    scheduleLabel: SCHEDULE_LABELS[schedule],
    amountCents,
    yearlyCents: yearlyCents(amountCents, schedule),
    monthlyCents: monthlyCents(amountCents, schedule),
    nextDue: opts.cancelled ? null : nextDue(anchor, schedule, today, last?.date ?? null),
    scheduleAnchor: anchor,
    categoryId: opts.categoryId ?? last?.splitCategoryIds[0] ?? last?.categoryId ?? null,
    splitCategoryIds: opts.categoryId === null && last ? last.splitCategoryIds : [],
    chargeCount: charges.length,
    firstSeen: charges[0]?.date ?? null,
    lastCharge: last ? { date: last.date, amountCents: last.amountCents, txId: last.txId } : null,
    isNew: isNew(charges[0]?.date ?? null, today),
    priceIncrease: raise,
    varies: !raise && low !== high ? { lowCents: low, highCents: high } : null,
  };
}

const sameDay = (a: number | null, b: number | null) => a === null || b === null || Math.abs(a - b) <= 3;

export function recurringOverview(db: DB, today: IsoDate) {
  const charges = loadCharges(db);
  const rows = db.prepare('SELECT * FROM recurring_items ORDER BY id').all() as unknown as ItemRow[];

  const views: ItemView[] = rows.map((r) => {
    const mine = chargesForItem({ merchantKey: r.merchant_key, refCents: r.amount_cents, billingDay: r.billing_day }, charges);
    const amount = r.source === 'detected' && mine.length ? mine.at(-1)!.amountCents : r.amount_cents;
    return {
      ...costView(r.name, r.schedule, amount, mine, today, {
        anchor: r.anchor_date,
        categoryId: r.category_id,
        cancelled: r.status === 'cancelled',
      }),
      id: r.id,
      source: r.source,
      status: r.status,
      anchorDate: r.anchor_date,
      cancelledOn: r.cancelled_on,
      tier: null,
    };
  });
  const confirmed = views.filter((v) => v.status === 'confirmed').sort((a, b) => b.yearlyCents - a.yearlyCents || (a.name < b.name ? -1 : 1));
  confirmed.forEach((v, i) => (v.tier = tierFor(i, confirmed.length)));

  // Saved items and dismissals "claim" a series: same merchant, nearby amount (and billing day, if set).
  const claims = [
    ...rows.map((r) => ({ key: r.merchant_key ?? merchantKey(r.name), ref: r.amount_cents, day: r.billing_day })),
    ...(db.prepare('SELECT merchant_key, amount_cents, billing_day FROM recurring_dismissals').all() as {
      merchant_key: string;
      amount_cents: number;
      billing_day: number | null;
    }[]).map((d) => ({ key: d.merchant_key, ref: d.amount_cents, day: d.billing_day })),
  ];
  const claimed = (s: Series) => claims.some((c) => c.key === s.merchantKey && amountNear(c.ref, s.lowCents, s.highCents) && sameDay(c.day, s.billingDay));

  const suggestions: SuggestionView[] = findSeries(charges)
    .filter((s) => isActive(s, today) && !claimed(s))
    .map((s) => ({ ...costView(s.name, s.schedule, s.amountCents, s.charges, today, { anchor: null, categoryId: null, cancelled: false }), key: s.key }))
    .sort((a, b) => b.yearlyCents - a.yearlyCents || (a.name < b.name ? -1 : 1));

  const yearly = confirmed.reduce((s, v) => s + v.yearlyCents, 0);
  return {
    today,
    items: confirmed,
    cancelled: views.filter((v) => v.status === 'cancelled').sort((a, b) => ((a.cancelledOn ?? '') < (b.cancelledOn ?? '') ? 1 : -1)),
    suggestions,
    totals: { yearlyCents: yearly, monthlyCents: Math.round(yearly / 12), count: confirmed.length },
  };
}

/** Items marked cancelled on the Recurring page, oldest cancellation first (Trophies Round 3). Read-only. */
export function cancelledItems(db: DB): { date: IsoDate; name: string }[] {
  return (
    db
      .prepare("SELECT name, cancelled_on FROM recurring_items WHERE status = 'cancelled' AND cancelled_on IS NOT NULL ORDER BY cancelled_on, id")
      .all() as { name: string; cancelled_on: string }[]
  ).map((r) => ({ date: r.cancelled_on, name: r.name }));
}

/**
 * Every saved recurring item (confirmed or cancelled) with the charges that belong to it, found exactly the way
 * the Recurring page finds them. Read-only. Manual items have no merchant, so no charges are matched to them.
 */
export function itemCharges(db: DB): { id: number; name: string; status: 'confirmed' | 'cancelled'; source: 'detected' | 'manual'; charges: Charge[] }[] {
  const charges = loadCharges(db);
  const rows = db.prepare('SELECT * FROM recurring_items ORDER BY id').all() as unknown as ItemRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    source: r.source,
    charges: chargesForItem({ merchantKey: r.merchant_key, refCents: r.amount_cents, billingDay: r.billing_day }, charges),
  }));
}

function findSuggestion(db: DB, key: string, today: IsoDate): Series {
  const s = findSeries(loadCharges(db)).find((x) => x.key === key);
  if (!s) throw new RecurringError('That suggestion is gone (new transactions may have changed it). Refresh the page.');
  return s;
}

export function getItem(db: DB, id: number, today: IsoDate): ItemView | null {
  const o = recurringOverview(db, today);
  return [...o.items, ...o.cancelled].find((v) => v.id === id) ?? null;
}

export function confirmSuggestion(db: DB, key: string, today: IsoDate, now: number): ItemView {
  const s = findSuggestion(db, key, today);
  if (!recurringOverview(db, today).suggestions.some((x) => x.key === key)) throw new RecurringError('That one is already in your list.');
  const id = Number(
    db
      .prepare(
        `INSERT INTO recurring_items (name, merchant_key, amount_cents, schedule, anchor_date, billing_day, category_id, status, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 'confirmed', 'detected', ?, ?)`,
      )
      .run(s.name.slice(0, 80) || s.merchantKey.slice(0, 80), s.merchantKey, s.amountCents, s.schedule, s.lastDate, s.billingDay, now, now)
      .lastInsertRowid,
  );
  return getItem(db, id, today)!;
}

export function dismissSuggestion(db: DB, key: string, today: IsoDate, now: number): void {
  const s = findSuggestion(db, key, today);
  db.prepare('INSERT INTO recurring_dismissals (merchant_key, amount_cents, billing_day, name, created_at) VALUES (?, ?, ?, ?, ?)').run(
    s.merchantKey,
    s.amountCents,
    s.billingDay,
    s.name.slice(0, 80),
    now,
  );
}

export interface ManualInput {
  name: string;
  amountCents: Cents;
  schedule: Schedule;
  nextDue: IsoDate;
  categoryId: number | null;
}

export function addManual(db: DB, input: ManualInput, today: IsoDate, now: number): ItemView {
  const id = Number(
    db
      .prepare(
        `INSERT INTO recurring_items (name, merchant_key, amount_cents, schedule, anchor_date, category_id, status, source, created_at, updated_at)
         VALUES (?, NULL, ?, ?, ?, ?, 'confirmed', 'manual', ?, ?)`,
      )
      .run(input.name, input.amountCents, input.schedule, input.nextDue, input.categoryId, now, now).lastInsertRowid,
  );
  return getItem(db, id, today)!;
}

export interface ItemPatch {
  name?: string;
  amountCents?: Cents;
  schedule?: Schedule;
  nextDue?: IsoDate;
  categoryId?: number | null;
}

export function updateItem(db: DB, id: number, patch: ItemPatch, today: IsoDate, now: number): ItemView | null {
  const r = db.prepare('SELECT * FROM recurring_items WHERE id = ?').get(id) as ItemRow | undefined;
  if (!r) return null;
  if (patch.amountCents !== undefined && r.source === 'detected' && patch.amountCents !== r.amount_cents) {
    throw new RecurringError('This amount comes from your transactions. Add it by hand instead to set your own amount.');
  }
  db.prepare(
    `UPDATE recurring_items SET name = ?, amount_cents = ?, schedule = ?, anchor_date = ?, category_id = ?, updated_at = ? WHERE id = ?`,
  ).run(
    patch.name ?? r.name,
    patch.amountCents ?? r.amount_cents,
    patch.schedule ?? r.schedule,
    patch.nextDue ?? r.anchor_date,
    patch.categoryId !== undefined ? patch.categoryId : r.category_id,
    now,
    id,
  );
  return getItem(db, id, today);
}

/** Cancel: Arc40 stops expecting it. Returns what it cost a year (shown once as "You'll save..."). */
export function cancelItem(db: DB, id: number, today: IsoDate, now: number): { item: ItemView; savedPerYearCents: Cents } | null {
  const before = getItem(db, id, today);
  if (!before) return null;
  if (before.status === 'cancelled') throw new RecurringError('That one is already cancelled.');
  db.prepare("UPDATE recurring_items SET status = 'cancelled', cancelled_on = ?, updated_at = ? WHERE id = ?").run(today, now, id);
  return { item: getItem(db, id, today)!, savedPerYearCents: before.yearlyCents };
}

export function restoreItem(db: DB, id: number, today: IsoDate, now: number): ItemView | null {
  const n = db.prepare("UPDATE recurring_items SET status = 'confirmed', cancelled_on = NULL, updated_at = ? WHERE id = ?").run(now, id).changes;
  return n ? getItem(db, id, today) : null;
}

export function deleteItem(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM recurring_items WHERE id = ?').run(id).changes > 0;
}

/** Oldest allowed next-due correction / manual date, and the latest. */
export const dueDateWindow = (today: IsoDate) => ({ from: addDays(today, -366), to: addDays(today, 3 * 366) });

// ---------- Bills calendar (V2 Phase 2, Milestone 5) ----------

/** One expected charge on one day. Only confirmed items (detected or manual); cancelled ones never appear. */
export interface Bill {
  date: IsoDate;
  itemId: number;
  name: string;
  amountCents: Cents;
  tier: 'gold' | 'silver' | 'bronze' | null;
  schedule: Schedule;
  scheduleLabel: string;
  categoryId: number | null;
  splitCategoryIds: number[];
}

/** Every bill due between two dates (inclusive), date order. Nothing before today is ever listed. */
export function billsBetween(items: readonly ItemView[], from: IsoDate, to: IsoDate): Bill[] {
  const out: Bill[] = [];
  for (const i of items) {
    if (i.status !== 'confirmed' || i.nextDue === null) continue;
    for (const date of dueDatesBetween(i.scheduleAnchor, i.schedule, i.nextDue, from, to)) {
      out.push({
        date,
        itemId: i.id,
        name: i.name,
        amountCents: i.amountCents,
        tier: i.tier,
        schedule: i.schedule,
        scheduleLabel: i.scheduleLabel,
        categoryId: i.categoryId,
        splitCategoryIds: i.splitCategoryIds,
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name < b.name ? -1 : 1));
}

/** Today's total in checking accounts (same balance the Accounts page shows), or null with none. */
export function checkingBalance(db: DB, today: IsoDate): { balanceCents: Cents; accounts: number } | null {
  const all = listAccounts(db, { includeArchived: true });
  const checking = all.filter((a) => a.type === 'checking' && !a.archived);
  if (!checking.length) return null;
  const nw = toNw(db, all, listSnapshots(db), today);
  const point = netWorthOn(nw.accounts, nw.snapshots, today, nw.flows);
  return { balanceCents: checking.reduce((s, a) => s + (point.byAccount[a.id] ?? 0), 0), accounts: checking.length };
}

export const UPCOMING_DAYS = 30;

/** The next 30 days (today + 29): bills, their total, and whether it is more than checking holds. */
export function upcomingBills(db: DB, today: IsoDate) {
  const to = addDays(today, UPCOMING_DAYS - 1);
  const bills = billsBetween(recurringOverview(db, today).items, today, to);
  const totalCents = bills.reduce((s, b) => s + b.amountCents, 0);
  const checking = checkingBalance(db, today);
  return { from: today, to, totalCents, bills, checking, overChecking: checking !== null && totalCents > checking.balanceCents };
}

/** One month of the calendar: days from today (or the 1st, if later) to the month's end. */
export function billsCalendar(db: DB, today: IsoDate, month: IsoDate) {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const bills = last < today ? [] : billsBetween(recurringOverview(db, today).items, first > today ? first : today, last);
  return { month: first, today, bills, totalCents: bills.reduce((s, b) => s + b.amountCents, 0) };
}

/** Months the calendar can show: this month through 24 months ahead. */
export const calendarWindow = (today: IsoDate) => ({ from: startOfMonth(today), to: addMonths(startOfMonth(today), 24) });

