/**
 * Investment math. Pure functions.
 *   shares are integer micro-shares (1 share = 1,000,000)
 *   prices are integer ten-thousandths of a dollar (price_e4)
 *   value (cents) = shares_micro x price_e4 / 100,000,000, computed with BigInt and
 *   rounded to the nearest cent ONCE (half away from zero)
 *   money put in = contributions + transfers in - transfers out
 *   growth = value - money put in (never counted as income)
 */
import type { IsoDate } from '../../../shared/dates.js';
import type { ActivityKind } from './fidelity.js';
import type { Cents } from './money.js';

export interface Activity {
  accountId: number;
  date: IsoDate;
  kind: ActivityKind;
  symbol: string;
  quantityMicro: number;
  amountCents: Cents;
  taxYear: number | null;
}

export interface Price {
  symbol: string;
  asOf: IsoDate;
  priceE4: number;
}

const SCALE = 100_000_000n; // micro-shares (1e6) x e4 prices (1e4) / 100 cents

export function valueCents(sharesMicro: number, priceE4: number): Cents {
  const p = BigInt(sharesMicro) * BigInt(priceE4);
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const rounded = (abs + SCALE / 2n) / SCALE;
  return Number(neg ? -rounded : rounded);
}

/** Share change for one activity row. Sells always reduce, buys/reinvests always add. */
export function shareDelta(a: Activity): number {
  switch (a.kind) {
    case 'buy':
    case 'reinvest':
      return Math.abs(a.quantityMicro);
    case 'sell':
      return -Math.abs(a.quantityMicro);
    case 'other':
      return a.quantityMicro; // manual share adjustments are signed
    default:
      return 0;
  }
}

/** Shares held per account and symbol on a date (inclusive). */
export function holdings(acts: readonly Activity[], asOf: IsoDate): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>();
  for (const a of acts) {
    if (a.date > asOf || !a.symbol) continue;
    const d = shareDelta(a);
    if (d === 0) continue;
    const m = out.get(a.accountId) ?? new Map<string, number>();
    m.set(a.symbol, (m.get(a.symbol) ?? 0) + d);
    out.set(a.accountId, m);
  }
  return out;
}

/** Latest price on or before a date per symbol. */
export function latestPrices<P extends Price>(prices: readonly P[], asOf: IsoDate): Map<string, P> {
  const out = new Map<string, P>();
  for (const p of prices) {
    if (p.asOf > asOf) continue;
    const cur = out.get(p.symbol);
    if (!cur || p.asOf > cur.asOf) out.set(p.symbol, p);
  }
  return out;
}

/**
 * Money put in on each kind of row (+ in, - out). Contributions and transfers in keep their REAL sign
 * (audit F-03): a contribution reversal (a negative contribution) lowers money put in instead of adding to it.
 * A transfer out is always money taken out, whatever its sign: that label can be the user's own answer for an
 * unknown Fidelity action ("money taken out"), which decides the direction (groundwork.test.ts).
 */
export function moneyIn(a: Activity): Cents {
  if (a.kind === 'contribution' || a.kind === 'transfer_in') return a.amountCents;
  if (a.kind === 'transfer_out') return -Math.abs(a.amountCents);
  return 0;
}

/** Sum of contribution rows with their real sign (a reversal counts as a minus). */
export function signedContributions(acts: readonly Activity[]): Cents {
  return acts.filter((a) => a.kind === 'contribution').reduce((s, a) => s + a.amountCents, 0);
}

export function moneyPutIn(acts: readonly Activity[], asOf: IsoDate, accountIds?: ReadonlySet<number>): Cents {
  return acts.filter((a) => a.date <= asOf && (!accountIds || accountIds.has(a.accountId))).reduce((s, a) => s + moneyIn(a), 0);
}

/** Uninvested cash inside the account: every row's cash effect added up (buys spend it, dividends add it). */
export function cashCents(acts: readonly Activity[], accountId: number, asOf: IsoDate): Cents {
  return acts.filter((a) => a.accountId === accountId && a.date <= asOf).reduce((s, a) => s + a.amountCents, 0);
}

/** Roth/IRA contributions counted toward one tax year (not the calendar year they happened). */
export function contributionsForTaxYear(acts: readonly Activity[], year: number, accountIds: ReadonlySet<number>): Cents {
  return acts
    .filter((a) => a.kind === 'contribution' && a.taxYear === year && accountIds.has(a.accountId))
    .reduce((s, a) => s + a.amountCents, 0); // real sign: a reversal lowers the total (audit F-03)
}

/** Growth in basis points of money put in; null when nothing was put in. */
export function growthBp(valueCentsNow: Cents, putIn: Cents): number | null {
  if (putIn <= 0) return null;
  const n = (valueCentsNow - putIn) * 10_000;
  return Math.sign(n) * Math.round(Math.abs(n) / putIn);
}
