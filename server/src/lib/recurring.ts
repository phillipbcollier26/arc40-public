/**
 * Recurring charges and subscriptions: pure detection and schedule math. No database here.
 *
 * Input is WHOLE expense transactions (money out, type 'expense', not transfers, not income, not
 * refunds). A split transaction is ONE charge with its full amount: its pieces are never separate
 * charges (a monthly store run split three ways is one possible recurring charge).
 *
 * Detection, step by step:
 *  1. Group charges by merchant: the cleaned description, upper-cased, punctuation and numbers
 *     removed, a few card-network words dropped, first 3 words ("SPOTIFY USA NY" -> "SPOTIFY USA NY").
 *  2. Within a merchant, group by amount: sorted by amount, a charge joins the group of the next
 *     smaller one when it is at most 15% or $1 above it. So a phone bill that wobbles, or a price
 *     going up step by step, stays one group, while a $2.99 and a $14.99 plan from the same
 *     merchant become two.
 *  3. Fit a schedule to the dates (first that fits, in this order), allowing ONE skipped period
 *     (except yearly):
 *        weekly     every 6-8 days     at least 4 charges
 *        biweekly   every 12-16 days   at least 3 charges
 *        monthly    every 25-36 days   at least 3 charges
 *        quarterly  every 84-98 days   at least 3 charges
 *        yearly     every 358-372 days at least 2 charges; with only 2 charges the price must
 *                   also match within 2% or $1 (renewals cost the same; shopping trips a year
 *                   apart usually do not)
 *  4. If a group does not fit, it is split by day of month (charges within 3 days of each other)
 *     and each part is tried as monthly: two same-price subscriptions billed on different days
 *     from one merchant are found separately.
 *  5. Only groups that still look active are suggested: the last charge is within two periods
 *     (+10 days) of today.
 *
 * Next due dates come from an anchor date: monthly/quarterly/yearly keep the anchor's day of month
 * and fall back to the month's last day (Jan 31 -> Feb 28 -> Mar 31; Feb 29 -> Feb 28 next year).
 * Missing charges are never flagged: the next due date just rolls forward.
 */
import { addDays, addMonths, daysInMonth, type IsoDate } from '../../../shared/dates.js';
import type { Cents } from './money.js';

export const SCHEDULES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'] as const;
export type Schedule = (typeof SCHEDULES)[number];

export const SCHEDULE_LABELS: Record<Schedule, string> = {
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  monthly: 'Every month',
  quarterly: 'Every 3 months',
  yearly: 'Every year',
};

export const PER_YEAR: Record<Schedule, number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, yearly: 1 };
export const MIN_CHARGES: Record<Schedule, number> = { weekly: 4, biweekly: 3, monthly: 3, quarterly: 3, yearly: 2 };
/** Normal gap in days, and the one allowed "skipped period" gap. */
const GAPS: Record<Schedule, { lo: number; hi: number; skip: [number, number] | null; nominal: number }> = {
  weekly: { lo: 6, hi: 8, skip: [13, 15], nominal: 7 },
  biweekly: { lo: 12, hi: 16, skip: [26, 30], nominal: 14 },
  monthly: { lo: 25, hi: 36, skip: [55, 67], nominal: 31 },
  quarterly: { lo: 84, hi: 98, skip: [170, 195], nominal: 92 },
  yearly: { lo: 358, hi: 372, skip: null, nominal: 366 },
};

/** A price increase is flagged when the newest charge is at least 5% AND at least $0.50 above the usual amount. */
export const PRICE_UP_BP = 500;
export const PRICE_UP_MIN_CENTS = 50;
/** Recurring charges first seen this many days ago or less get a NEW badge. */
export const NEW_DAYS = 60;

export interface Charge {
  txId: number;
  date: IsoDate;
  /** What it cost: a POSITIVE number of cents (the transaction's amount is negative). */
  amountCents: Cents;
  description: string;
  categoryId: number | null;
  /** For a split transaction: its pieces' categories, biggest piece first. Empty when not split. */
  splitCategoryIds: number[];
}

export interface Series {
  /** Stable id of a suggestion: merchant key + newest amount. */
  key: string;
  merchantKey: string;
  name: string;
  schedule: Schedule;
  charges: Charge[]; // oldest first
  amountCents: Cents; // newest charge
  lowCents: Cents;
  highCents: Cents;
  firstSeen: IsoDate;
  lastDate: IsoDate;
  /** Set only when this series was told apart from another same-price one by its billing day. */
  billingDay: number | null;
}

const NOISE = new Set(['POS', 'DEBIT', 'PURCHASE', 'CARD', 'SQ', 'TST', 'WWW', 'COM', 'INC', 'LLC', 'CO', 'RECURRING', 'PMT', 'PAYMENT']);

/** "STREAMLY.COM 800-555-0100 CA" -> "STREAMLY CA". Same merchant, same key. */
export function merchantKey(description: string): string {
  const words = description
    .toUpperCase()
    .replace(/[^A-Z]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !NOISE.has(w));
  return words.slice(0, 3).join(' ');
}

const dayNumber = (d: IsoDate) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;
export const daysBetween = (a: IsoDate, b: IsoDate) => dayNumber(b) - dayNumber(a);

/** Charges of one merchant grouped by similar amount (single link: within 15% or $1 of the next smaller). */
export function clusterByAmount(charges: readonly Charge[]): Charge[][] {
  const sorted = [...charges].sort((a, b) => a.amountCents - b.amountCents || (a.date < b.date ? -1 : 1));
  const out: Charge[][] = [];
  for (const c of sorted) {
    const cur = out.at(-1);
    const prev = cur?.at(-1);
    if (cur && prev && c.amountCents - prev.amountCents <= Math.max(Math.round(prev.amountCents * 0.15), 100)) cur.push(c);
    else out.push([c]);
  }
  return out.map((g) => g.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.txId - b.txId)));
}

/** The schedule these dates (oldest first) follow, or null. */
export function fitSchedule(dates: readonly IsoDate[]): Schedule | null {
  for (const s of SCHEDULES) {
    if (dates.length < MIN_CHARGES[s]) continue;
    const g = GAPS[s];
    let skips = 0;
    let ok = true;
    for (let i = 1; i < dates.length; i++) {
      const gap = daysBetween(dates[i - 1]!, dates[i]!);
      if (gap >= g.lo && gap <= g.hi) continue;
      if (g.skip && gap >= g.skip[0] && gap <= g.skip[1] && skips === 0) {
        skips++;
        continue;
      }
      ok = false;
      break;
    }
    if (ok) return s;
  }
  return null;
}

/** Day of month, with the last 3 days of any month counted as "month end" (31). */
export function billingDay(d: IsoDate): number {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  return daysInMonth(y, m) - day < 3 && day >= 28 ? 31 : day;
}

/** Splits charges into groups billed on (nearly) the same day of the month. */
function splitByBillingDay(charges: readonly Charge[]): Charge[][] {
  const byDay = [...charges].sort((a, b) => billingDay(a.date) - billingDay(b.date));
  const groups: Charge[][] = [];
  for (const c of byDay) {
    const cur = groups.at(-1);
    if (cur && billingDay(c.date) - billingDay(cur.at(-1)!.date) <= 3) cur.push(c);
    else groups.push([c]);
  }
  return groups.map((g) => g.sort((a, b) => (a.date < b.date ? -1 : 1)));
}

/** Only two yearly charges is weak evidence: they must cost (nearly) the same. */
function plausible(schedule: Schedule, charges: readonly Charge[]): boolean {
  if (schedule !== 'yearly' || charges.length >= 3) return true;
  const a = charges.map((c) => c.amountCents);
  const hi = Math.max(...a);
  return hi - Math.min(...a) <= Math.max(Math.round(hi * 0.02), 100);
}

function toSeries(merchant: string, schedule: Schedule, charges: Charge[], day: number | null = null): Series {
  const last = charges.at(-1)!;
  const amounts = charges.map((c) => c.amountCents);
  return {
    key: `${merchant}|${last.amountCents}|${charges[0]!.date}${day === null ? '' : `|d${day}`}`,
    merchantKey: merchant,
    name: last.description,
    schedule,
    charges,
    amountCents: last.amountCents,
    lowCents: Math.min(...amounts),
    highCents: Math.max(...amounts),
    firstSeen: charges[0]!.date,
    lastDate: last.date,
    billingDay: day,
  };
}

/** Every recurring series in the charges (active or not), oldest-first charges in each. */
export function findSeries(charges: readonly Charge[]): Series[] {
  const byMerchant = new Map<string, Charge[]>();
  for (const c of charges) {
    if (c.amountCents <= 0) continue; // refunds are not charges
    const k = merchantKey(c.description);
    if (!k) continue;
    byMerchant.set(k, [...(byMerchant.get(k) ?? []), c]);
  }
  const out: Series[] = [];
  for (const [merchant, list] of byMerchant) {
    for (const group of clusterByAmount(list)) {
      const s = fitSchedule(group.map((c) => c.date));
      if (s && plausible(s, group)) {
        out.push(toSeries(merchant, s, group));
        continue;
      }
      for (const part of splitByBillingDay(group)) {
        if (part.length < MIN_CHARGES.monthly) continue;
        const ps = fitSchedule(part.map((c) => c.date));
        if ((ps === 'monthly' || ps === 'quarterly' || ps === 'yearly') && plausible(ps, part)) out.push(toSeries(merchant, ps, part, billingDay(part.at(-1)!.date)));
      }
    }
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Still active: the last charge is within two periods (+10 days) of today. */
export function isActive(s: Pick<Series, 'schedule' | 'lastDate'>, today: IsoDate): boolean {
  return daysBetween(s.lastDate, today) <= 2 * GAPS[s.schedule].nominal + 10;
}

/** The k-th due date counted from the anchor (k may be negative). Keeps the anchor's day of month. */
export function occurrence(anchor: IsoDate, schedule: Schedule, k: number): IsoDate {
  switch (schedule) {
    case 'weekly':
      return addDays(anchor, 7 * k);
    case 'biweekly':
      return addDays(anchor, 14 * k);
    case 'monthly':
      return addMonths(anchor, k);
    case 'quarterly':
      return addMonths(anchor, 3 * k);
    case 'yearly':
      return addMonths(anchor, 12 * k);
  }
}

/** A starting k close to `date`, so loops stay short however old the anchor is. */
function kNear(anchor: IsoDate, schedule: Schedule, date: IsoDate): number {
  const days = daysBetween(anchor, date);
  const per = { weekly: 7, biweekly: 14, monthly: 30.44, quarterly: 91.31, yearly: 365.25 }[schedule];
  return Math.floor(days / per) - 2;
}

/** Due dates from `from` to `to` (inclusive). */
export function occurrencesBetween(anchor: IsoDate, schedule: Schedule, from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let k = kNear(anchor, schedule, from); ; k++) {
    const d = occurrence(anchor, schedule, k);
    if (d > to) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/**
 * Audit F-06: the date a month-based schedule counts from, keeping the bill's real day of the month.
 * A charge on the last day of a short month (Feb 28, or Apr 30 for a bill on the 31st) is the 29th to 31st
 * squeezed into that month. Counting from it would move every later due date to the 28th (or 30th). So when
 * `anchor` IS one of the item's charges and falls on its month's last day, the usual day comes from the
 * charges (the highest day of month among the recent ones on the 28th or later) and the anchor moves back to
 * the newest charge on that day (Jan 31 -> Feb 28 -> Mar 31). The saved billing_day is not used: it stores
 * "month end" for the 29th to the 31st, not the exact day. Anything else (weekly and every-2-weeks schedules,
 * mid-month bills, a next due date the user typed) is returned unchanged.
 */
export function keepBillingDay(anchor: IsoDate, schedule: Schedule, chargeDates: readonly IsoDate[]): IsoDate {
  if (schedule !== 'monthly' && schedule !== 'quarterly' && schedule !== 'yearly') return anchor;
  if (!chargeDates.includes(anchor)) return anchor;
  const day = (d: IsoDate) => Number(d.slice(8, 10));
  const lastDay = (d: IsoDate) => daysInMonth(Number(d.slice(0, 4)), Number(d.slice(5, 7)));
  if (day(anchor) !== lastDay(anchor)) return anchor;
  const recent = [...chargeDates].filter((d) => d <= anchor).sort().slice(-6);
  const target = Math.max(...recent.map(day).filter((x) => x >= 28));
  if (!(target > day(anchor))) return anchor;
  return recent.filter((d) => day(d) === target).at(-1) ?? anchor;
}

/**
 * Next due date: on or after today, after the last charge already seen (if any), and never before the
 * anchor itself (a next due date the user typed or corrected means nothing is expected before it).
 */
export function nextDue(anchor: IsoDate, schedule: Schedule, today: IsoDate, lastCharge: IsoDate | null = null): IsoDate {
  let after = lastCharge && lastCharge >= today ? addDays(lastCharge, 1) : today;
  if (anchor > after) after = anchor;
  for (let k = kNear(anchor, schedule, after); ; k++) {
    const d = occurrence(anchor, schedule, k);
    if (d >= after) return d;
  }
}

export const yearlyCents = (amountCents: Cents, schedule: Schedule): Cents => amountCents * PER_YEAR[schedule];
/** Monthly equivalent, rounded to the cent once (half up; amounts are positive). */
export const monthlyCents = (amountCents: Cents, schedule: Schedule): Cents => Math.round(yearlyCents(amountCents, schedule) / 12);

/** Middle value of a list of cents (the lower middle for an even count, so it is always a real charge). */
function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
}

/** Newest charge compared with the usual amount (median of up to 6 charges before it). */
export function priceIncrease(charges: readonly Charge[]): { fromCents: Cents; toCents: Cents } | null {
  if (charges.length < 2) return null;
  const latest = charges.at(-1)!.amountCents;
  const usual = median(charges.slice(-7, -1).map((c) => c.amountCents));
  const up = latest - usual;
  if (up >= PRICE_UP_MIN_CENTS && up * 10_000 >= usual * PRICE_UP_BP) return { fromCents: usual, toCents: latest };
  return null;
}

export const isNew = (firstSeen: IsoDate | null, today: IsoDate) => firstSeen !== null && daysBetween(firstSeen, today) <= NEW_DAYS;

/** Is `refCents` (an amount the user confirmed or dismissed) close to this group of charges? */
export function amountNear(refCents: Cents, low: Cents, high: Cents): boolean {
  return refCents >= low - Math.max(Math.round(low * 0.15), 100) && refCents <= high + Math.max(Math.round(high * 0.15), 100);
}

/**
 * The charges that belong to a saved item: same merchant, the amount group closest to the item's
 * amount (groups follow price changes, so a confirmed $10.99 plan still matches at $12.99 later).
 */
export function chargesForItem(
  item: { merchantKey: string | null; refCents: Cents; billingDay?: number | null },
  charges: readonly Charge[],
): Charge[] {
  if (!item.merchantKey) return [];
  const day = item.billingDay ?? null;
  const mine = charges.filter(
    (c) =>
      c.amountCents > 0 &&
      merchantKey(c.description) === item.merchantKey &&
      (day === null || Math.abs(billingDay(c.date) - day) <= 3),
  );
  const near = clusterByAmount(mine)
    .map((g) => ({ g, low: Math.min(...g.map((c) => c.amountCents)), high: Math.max(...g.map((c) => c.amountCents)) }))
    .filter((x) => amountNear(item.refCents, x.low, x.high))
    .sort((a, b) => Math.abs(a.g.at(-1)!.amountCents - item.refCents) - Math.abs(b.g.at(-1)!.amountCents - item.refCents));
  return near[0]?.g ?? [];
}

/** Metal tier by rank (0 = most expensive): the top third gold, the next third silver, the rest bronze. */
export function tierFor(rank: number, count: number): 'gold' | 'silver' | 'bronze' {
  const gold = Math.ceil(count / 3);
  const silver = Math.ceil((count - gold) / 2);
  return rank < gold ? 'gold' : rank < gold + silver ? 'silver' : 'bronze';
}

/**
 * Due dates of one item between `from` and `to` (inclusive), starting at its next due date: so a charge
 * already paid this period never shows up again, and a corrected next due date moves every later date.
 */
export function dueDatesBetween(anchor: IsoDate, schedule: Schedule, next: IsoDate, from: IsoDate, to: IsoDate): IsoDate[] {
  return occurrencesBetween(anchor, schedule, from > next ? from : next, to);
}
