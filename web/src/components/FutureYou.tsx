import { Hourglass } from 'lucide-react';
import { usePlanning } from '../lib/planning';
import { formatBasisPoints, formatCents } from '../lib/format';
import { futureYou, wholeDollarsDown } from '../../../shared/projection';
import { spendingCents } from '../../../shared/workCost';

/** "$50" for whole dollars, "$13.49" otherwise. */
export const spentText = (cents: number) => formatCents(cents).replace(/\.00$/, '');

/**
 * "This $50 could be $221 at age 40" (today's dollars) for one expense. Renders nothing when the Settings switch is
 * off, no birth month is set, 65 has passed, or the amount is not spending (income, transfers, gifts, refunds).
 * Pass a transaction's signed `amountCents` + `type`, or `costCents` (a positive amount already known to be spending).
 */
export function FutureYouLine({ amountCents, type, costCents }: { amountCents?: number; type?: string; costCents?: number }) {
  const { planning } = usePlanning();
  if (!planning?.futureYouLine || !planning.birth) return null;
  const cost = costCents !== undefined ? costCents : amountCents !== undefined && type ? spendingCents(type, amountCents) : null;
  if (cost === null || !Number.isInteger(cost) || cost <= 0) return null;
  const f = futureYou(cost, planning.birth, planning.today, planning.returnRateBp);
  if (!f) return null;
  return (
    <span className="future-line" title={`If invested instead, at ${formatBasisPoints(planning.returnRateBp, { sign: false })} a year after inflation, in today's dollars. Estimate, not financial advice.`}>
      <Hourglass size={12} aria-hidden />
      <span>
        This {spentText(cost)} could be <b className="num">{wholeDollarsDown(f.valueCents)}</b> at age {f.age}
      </span>
    </span>
  );
}

/** True when the future-you line would show for this transaction (used to decide whether a hover box is needed). */
export function useFutureYouOn(): boolean {
  const { planning } = usePlanning();
  return !!(planning?.futureYouLine && planning.birth && planning.age !== null && planning.age < 65);
}
