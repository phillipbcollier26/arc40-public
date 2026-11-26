import { useWorkRate } from '../lib/workCost';
import { formatWorkCost, spendingCents, workTenths, type WorkRate } from '../../../shared/workCost';

const MAX_COINS = 10;

/**
 * A row of small metal coins: one per game (gold) or hour (platinum), the last one filled to the fraction
 * (3.5 = three coins and a half). Above 10 units only one coin is drawn next to the number.
 */
export function WorkCoins({ tenths, rate }: { tenths: number; rate: WorkRate }) {
  const whole = Math.floor(tenths / 10);
  const part = tenths % 10;
  const fills: number[] = [];
  if (tenths === 0) fills.push(1);
  else if (whole + (part ? 1 : 0) > MAX_COINS) fills.push(10);
  else {
    for (let i = 0; i < whole; i++) fills.push(10);
    if (part) fills.push(part);
  }
  return (
    <span className={`work-coins coin-${rate.unit === 'game' ? 'gold' : 'platinum'}`} aria-hidden>
      {fills.map((f, i) => (
        <span key={i} className="work-coin">
          <span className="work-coin-fill" style={{ width: `${f * 10}%` }} />
        </span>
      ))}
    </span>
  );
}

/**
 * "3.5 games" with coins, for one amount of SPENDING. Renders nothing when work cost is Off or the amount is
 * not spending. Pass either `costCents` (a positive amount already known to be spending, like a budget
 * category's spending or a recurring charge) or a transaction's signed `amountCents` + `type` (then only an
 * expense with money going out counts: income, transfers, gifts and refunds never get a work cost).
 */
export function WorkCost({
  costCents,
  amountCents,
  type,
  suffix,
  className = '',
}: {
  costCents?: number;
  amountCents?: number;
  type?: string;
  suffix?: string;
  className?: string;
}) {
  const rate = useWorkRate();
  if (!rate) return null;
  const cost = costCents !== undefined ? costCents : amountCents !== undefined && type ? spendingCents(type, amountCents) : null;
  if (cost === null || !Number.isInteger(cost) || cost <= 0) return null;
  const tenths = workTenths(cost, rate);
  const text = formatWorkCost(tenths, rate) + (suffix ? ` ${suffix}` : '');
  return (
    <span className={`work-cost ${className}`} title={`${text} of work, before taxes`}>
      <WorkCoins tenths={tenths} rate={rate} />
      <span className="work-cost-text num">{text}</span>
    </span>
  );
}
