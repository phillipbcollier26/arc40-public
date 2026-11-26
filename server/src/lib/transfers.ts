/**
 * Finds the two halves of a transfer between your own accounts, e.g.
 * "-$1,500.00 from bank savings" and "+$1,500.00 into the brokerage" on the
 * same day. Pure function.
 *
 * To avoid false matches (two unrelated $10 charges), at least one side must
 * already be marked as a transfer (by a rule, or because Fidelity says
 * "contribution"/"transfer received"). Pairs: opposite signs, same size,
 * different accounts, dates within `windowDays`. Closest dates pair first.
 */
import type { IsoDate } from '../../../shared/dates.js';
import type { TxType } from '../../../shared/transactions.js';

export interface TransferCandidate {
  id: number;
  accountId: number;
  date: IsoDate;
  amountCents: number;
  type: TxType;
  transferGroupId: number | null;
  /** Only used by the automatic-link rule (audit F-02): a categorized row is never re-typed on its own. */
  categoryId?: number | null;
}

/** Which out/in pairs may be considered. Default: at least one side is already a transfer. */
export type PairRule = (out: TransferCandidate, inn: TransferCandidate) => boolean;
export const oneSideTransfer: PairRule = (o, i) => o.type === 'transfer' || i.type === 'transfer';

/** A side that is not yet a transfer can be re-typed automatically only when it has no category. */
const freeToRetype = (c: TransferCandidate) => c.type === 'transfer' || (c.categoryId ?? null) === null;

/**
 * Automatic linking at import (audit F-02): both sides are transfers, or one is a transfer and the
 * other has no category. A categorized purchase or paycheck is never re-typed without the user's say.
 */
export const autoLinkRule: PairRule = (o, i) => oneSideTransfer(o, i) && freeToRetype(o) && freeToRetype(i);

/** The pairs automatic linking leaves alone: one side a transfer, the other categorized. Shown as suggestions. */
export const suggestionRule: PairRule = (o, i) => oneSideTransfer(o, i) && !(freeToRetype(o) && freeToRetype(i));

const daysBetween = (a: IsoDate, b: IsoDate) => {
  const t = (d: IsoDate) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round(Math.abs(t(a) - t(b)) / 86_400_000);
};

/** Key for an unordered pair of transaction ids (smaller first). */
export const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/**
 * `blocked` holds pairKey()s the user broke apart (unlinked, or re-typed one side):
 * those two are never paired again automatically.
 */
export function findTransferPairs(
  candidates: readonly TransferCandidate[],
  windowDays = 3,
  blocked: ReadonlySet<string> = new Set(),
  accept: PairRule = oneSideTransfer,
): [outId: number, inId: number][] {
  const open = candidates.filter((c) => c.transferGroupId === null && c.type !== 'gift' && c.amountCents !== 0);
  const options: { out: TransferCandidate; inn: TransferCandidate; gap: number }[] = [];

  const byAmount = new Map<number, TransferCandidate[]>();
  for (const c of open) {
    const k = Math.abs(c.amountCents);
    byAmount.set(k, [...(byAmount.get(k) ?? []), c]);
  }
  for (const group of byAmount.values()) {
    const outs = group.filter((c) => c.amountCents < 0);
    const ins = group.filter((c) => c.amountCents > 0);
    for (const o of outs) {
      for (const i of ins) {
        if (o.accountId === i.accountId) continue;
        if (!accept(o, i)) continue;
        if (blocked.has(pairKey(o.id, i.id))) continue;
        const gap = daysBetween(o.date, i.date);
        if (gap <= windowDays) options.push({ out: o, inn: i, gap });
      }
    }
  }
  options.sort((a, b) => a.gap - b.gap || a.out.id - b.out.id || a.inn.id - b.inn.id);

  const used = new Set<number>();
  const pairs: [number, number][] = [];
  for (const o of options) {
    if (used.has(o.out.id) || used.has(o.inn.id)) continue;
    used.add(o.out.id);
    used.add(o.inn.id);
    pairs.push([o.out.id, o.inn.id]);
  }
  return pairs;
}

