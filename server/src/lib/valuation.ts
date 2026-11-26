/**
 * Investment value history from real prices: pure functions, no database.
 *
 * For one investment account on day D:
 *   value = sum over funds of (shares held on D x that fund's price for D), computed with BigInt and
 *           rounded to the cent ONCE, + uninvested cash on D (from the activity rows).
 *
 * The price for a fund on day D, and how sure it is ("state"):
 *   known       a real price on D, or the last real price when the next real one is at most 4 days
 *               later (weekends and holidays: the market was closed, Friday's close IS the price)
 *   estimated   between two real prices more than 4 days apart: a straight line between them
 *               (price_e4 rounded half away from zero), labeled estimated
 *   stale       after the last real price (more than 4 days old): that last price is used as is, never
 *               projected forward, and labeled with its age
 *   unavailable before a fund's first real price: no value for D (the account falls back to the older
 *               rule: recorded balances and money put in), labeled "no price data"
 * The account's state on D is the worst state among the funds it holds that day.
 */
import { addDays, type IsoDate } from '../../../shared/dates.js';
import type { Activity, Price } from './investments.js';
import { shareDelta } from './investments.js';
import type { Cents } from './money.js';

export type PriceState = 'known' | 'estimated' | 'stale' | 'unavailable';
const SEVERITY: Record<PriceState, number> = { known: 0, estimated: 1, stale: 2, unavailable: 3 };
/** A gap this short (in days) between two real prices is a weekend or holiday, not an estimate. */
export const MARKET_CLOSED_DAYS = 4;

export const worstState = (a: PriceState, b: PriceState): PriceState => (SEVERITY[b] > SEVERITY[a] ? b : a);

const dayNum = (d: IsoDate) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;

/** Integer division rounded half away from zero. */
function divRound(num: number, den: number): number {
  const q = Math.floor((2 * Math.abs(num) + den) / (2 * den));
  return num < 0 ? -q : q;
}

/** Sorted real prices of one fund, and a lookup for any day. */
export class PriceLine {
  private readonly pts: { day: number; date: IsoDate; priceE4: number }[];
  constructor(prices: readonly Price[]) {
    this.pts = prices
      .map((p) => ({ day: dayNum(p.asOf), date: p.asOf, priceE4: p.priceE4 }))
      .sort((a, b) => a.day - b.day);
  }
  get first(): IsoDate | null {
    return this.pts[0]?.date ?? null;
  }
  get last(): IsoDate | null {
    return this.pts.at(-1)?.date ?? null;
  }
  /** Price and state for a day. `ageDays` is how old the price used is (stale only). */
  at(date: IsoDate): { priceE4: number | null; state: PriceState; ageDays: number } {
    const d = dayNum(date);
    let lo = 0;
    let hi = this.pts.length - 1;
    let i = -1; // last point with day <= d
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.pts[mid]!.day <= d) {
        i = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (i < 0) return { priceE4: null, state: 'unavailable', ageDays: 0 };
    const prev = this.pts[i]!;
    if (prev.day === d) return { priceE4: prev.priceE4, state: 'known', ageDays: 0 };
    const next = this.pts[i + 1];
    if (!next) {
      const age = d - prev.day;
      return { priceE4: prev.priceE4, state: age <= MARKET_CLOSED_DAYS ? 'known' : 'stale', ageDays: age };
    }
    const gap = next.day - prev.day;
    if (gap <= MARKET_CLOSED_DAYS) return { priceE4: prev.priceE4, state: 'known', ageDays: 0 };
    const k = d - prev.day;
    return { priceE4: prev.priceE4 + divRound((next.priceE4 - prev.priceE4) * k, gap), state: 'estimated', ageDays: 0 };
  }
}

export interface DayValue {
  date: IsoDate;
  /** null when the state is unavailable. */
  valueCents: Cents | null;
  state: PriceState;
  /** Oldest price age used on a stale day (0 otherwise). */
  staleDays: number;
  /** Funds whose price was estimated / stale / missing that day. */
  estimated: string[];
  stale: string[];
  missing: string[];
}

const SCALE = 100_000_000n; // micro-shares x price_e4 / SCALE = cents

/**
 * Value of ONE account for every day from `from` to `to` (inclusive). `acts` must be that account's
 * activity; `lines` holds one PriceLine per fund symbol. Days before the first activity are skipped.
 */
export function valueAccountDaily(acts: readonly Activity[], lines: ReadonlyMap<string, PriceLine>, from: IsoDate, to: IsoDate): DayValue[] {
  const sorted = [...acts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!sorted.length) return [];
  const start = sorted[0]!.date > from ? sorted[0]!.date : from;
  const shares = new Map<string, number>();
  let cash = 0;
  let ai = 0;
  const out: DayValue[] = [];
  for (let d = sorted[0]!.date; d <= to; d = addDays(d, 1)) {
    while (ai < sorted.length && sorted[ai]!.date <= d) {
      const a = sorted[ai]!;
      cash += a.amountCents;
      const delta = a.symbol ? shareDelta(a) : 0;
      if (delta) shares.set(a.symbol, (shares.get(a.symbol) ?? 0) + delta);
      ai++;
    }
    if (d < start) continue;
    let state: PriceState = 'known';
    let staleDays = 0;
    let total = 0n;
    const estimated: string[] = [];
    const stale: string[] = [];
    const missing: string[] = [];
    for (const [symbol, sh] of shares) {
      if (sh === 0) continue;
      const p = lines.get(symbol)?.at(d) ?? { priceE4: null, state: 'unavailable' as const, ageDays: 0 };
      state = worstState(state, p.state);
      if (p.state === 'estimated') estimated.push(symbol);
      if (p.state === 'stale') {
        stale.push(symbol);
        staleDays = Math.max(staleDays, p.ageDays);
      }
      if (p.priceE4 === null) missing.push(symbol);
      else total += BigInt(sh) * BigInt(p.priceE4);
    }
    let valueCents: Cents | null = null;
    if (state !== 'unavailable') {
      const neg = total < 0n;
      const abs = neg ? -total : total;
      const rounded = Number((abs + SCALE / 2n) / SCALE);
      valueCents = (neg ? -rounded : rounded) + cash;
    }
    out.push({ date: d, valueCents, state, staleDays, estimated, stale, missing });
  }
  return out;
}

/** One PriceLine per symbol from a flat price list. */
export function priceLines(prices: readonly Price[]): Map<string, PriceLine> {
  const by = new Map<string, Price[]>();
  for (const p of prices) by.set(p.symbol, [...(by.get(p.symbol) ?? []), p]);
  return new Map([...by].map(([s, ps]) => [s, new PriceLine(ps)]));
}

export interface DayState {
  state: PriceState;
  staleDays: number;
  estimated: string[];
  stale: string[];
  missing: string[];
}

/**
 * Price state per day across several accounts (the worst one wins). Days on which none of the
 * accounts holds valued activity are left out (nothing to say about prices there).
 */
export function statesByDate(valuation: ReadonlyMap<number, readonly DayValue[]>, accountIds: Iterable<number>): Map<IsoDate, DayState> {
  const out = new Map<IsoDate, DayState>();
  for (const id of accountIds) {
    for (const v of valuation.get(id) ?? []) {
      const cur = out.get(v.date) ?? { state: 'known' as PriceState, staleDays: 0, estimated: [], stale: [], missing: [] };
      out.set(v.date, {
        state: worstState(cur.state, v.state),
        staleDays: Math.max(cur.staleDays, v.staleDays),
        estimated: [...new Set([...cur.estimated, ...v.estimated])].sort(),
        stale: [...new Set([...cur.stale, ...v.stale])].sort(),
        missing: [...new Set([...cur.missing, ...v.missing])].sort(),
      });
    }
  }
  return out;
}
