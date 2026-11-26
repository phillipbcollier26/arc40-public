/**
 * Work cost (V2 Phase 3): what a purchase costs in refereeing games or hours of a job. Pure, integer math.
 * Shared by the server (validation, tests) and the web page (every place it is shown).
 *
 * A rate is a ratio of whole numbers: one unit of work pays `num / den` cents.
 *   refereeing:   num = pay per game,  den = 1      (every game counts as one hour)
 *   hourly job:   num = pay per hour,  den = 1
 *   salary job:   num = pay per year,  den = 2,080  (40 hours x 52 weeks)
 * All pay is before taxes.
 *
 * Rounding: tenths of a unit = cost x 10 x den / num, rounded half up ONCE, with whole numbers (BigInt).
 * Shown with one decimal ("3.5 games"); under 0.05 of a unit shows as "under 0.1".
 */
export const HOURS_PER_YEAR = 2_080;
export const MAX_JOBS = 20;
export const MAX_TITLE = 40;
/** Caps on what can be typed (sanity limits, not judgments): $10,000 a game, $1,000 an hour, $10M a year. */
export const MAX_GAME_CENTS = 1_000_000;
export const MAX_HOURLY_CENTS = 100_000;
export const MAX_SALARY_CENTS = 1_000_000_000;

export interface WorkRate {
  unit: 'game' | 'hour';
  /** Job title for hours ("Lifeguard"); null for refereeing games. */
  title: string | null;
  num: number;
  den: number;
}

export interface WorkJob {
  id: number;
  title: string;
  payKind: 'hourly' | 'salary';
  payCents: number;
}

/** 'off', 'ref' (refereeing games) or 'job:<id>'. */
export type WorkSelection = 'off' | 'ref' | `job:${number}`;

export function jobRate(job: WorkJob): WorkRate {
  return { unit: 'hour', title: job.title, num: job.payCents, den: job.payKind === 'salary' ? HOURS_PER_YEAR : 1 };
}

/**
 * The rate to use, or null when work cost is off (or what was picked no longer exists / has no pay):
 * a deleted job or a missing pay per game falls back to off, never to some other pay.
 */
export function activeRate(selection: string, refPayPerGameCents: number | null, jobs: readonly WorkJob[]): WorkRate | null {
  if (selection === 'ref') return refPayPerGameCents && refPayPerGameCents > 0 ? { unit: 'game', title: null, num: refPayPerGameCents, den: 1 } : null;
  const m = /^job:(\d+)$/.exec(selection);
  if (m) {
    const job = jobs.find((j) => j.id === Number(m[1]));
    return job ? jobRate(job) : null;
  }
  return null;
}

/** Tenths of a unit of work for `costCents` (a positive amount of spending). Half up, whole numbers only. */
export function workTenths(costCents: number, rate: WorkRate): number {
  if (!Number.isInteger(costCents) || costCents < 0) throw new RangeError('cost must be non-negative whole cents');
  if (!Number.isInteger(rate.num) || rate.num <= 0 || !Number.isInteger(rate.den) || rate.den <= 0) throw new RangeError('bad rate');
  const top = BigInt(costCents) * 10n * BigInt(rate.den);
  const num = BigInt(rate.num);
  return Number((top * 2n + num) / (num * 2n)); // floor(top / num + 1/2)
}

/** "3.5" from 35 tenths. */
export function tenthsText(tenths: number): string {
  return `${Math.floor(tenths / 10).toLocaleString('en-US')}.${tenths % 10}`;
}

const article = (title: string) => (/^[aeiou]/i.test(title) ? 'an' : 'a');

/** "3.5 games", "1.0 game", "under 0.1 games", "3.5 hours as a Lifeguard", "2.0 hours as an IT Help Desk". */
export function formatWorkCost(tenths: number, rate: WorkRate): string {
  const one = tenths === 10;
  const n = tenths === 0 ? 'under 0.1' : tenthsText(tenths);
  if (rate.unit === 'game') return `${n} ${one ? 'game' : 'games'}`;
  return `${n} ${one ? 'hour' : 'hours'} as ${article(rate.title ?? '')} ${rate.title ?? ''}`.trimEnd();
}

/**
 * Only spending gets a work cost: an expense with money going OUT. Income, transfers, gifts and refunds
 * (money coming back in) never do. Returns the positive cost in cents, or null.
 */
export function spendingCents(type: string, amountCents: number): number | null {
  return type === 'expense' && amountCents < 0 ? -amountCents : null;
}

/** "$14.42/hr" style: whole cents per hour for display only (salary / 2,080, half up). */
export function hourlyCents(job: WorkJob): number {
  return job.payKind === 'salary' ? Math.floor((job.payCents * 2 + HOURS_PER_YEAR) / (HOURS_PER_YEAR * 2)) : job.payCents;
}
