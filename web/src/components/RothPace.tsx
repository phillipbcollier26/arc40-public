import { useMemo } from 'react';
import { Gauge } from 'lucide-react';
import { Chart } from './Chart';
import { rothPaceOption } from '../lib/charts';
import { useChartTheme } from '../lib/themeMode';
import { formatCents, formatDate } from '../lib/format';
import type { PaceStatus, RothPace } from '../lib/types';

/** Metal tone per status: gold for on pace / ahead / maxed, bronze slightly behind, garnet well behind. */
const TONE: Record<PaceStatus, 'gold' | 'bronze' | 'garnet' | 'silver'> = {
  maxed: 'gold',
  ahead: 'gold',
  on_pace: 'gold',
  behind_slightly: 'bronze',
  behind_well: 'garnet',
  closed: 'silver',
  not_started: 'silver',
};

export function paceHeadline(p: RothPace): string {
  switch (p.status) {
    case 'maxed':
      return 'Maxed out';
    case 'ahead':
      return `Ahead by ${formatCents(-p.gapCents)}`;
    case 'on_pace':
      return 'On pace';
    case 'behind_slightly':
    case 'behind_well':
      return `Behind by ${formatCents(p.gapCents)}`;
    case 'closed':
      return 'Window closed';
    default:
      return 'Not open yet';
  }
}

const perMonth = (cents: number | null, months: number) =>
  cents === null ? '' : cents === 0 ? 'Reached' : `${formatCents(cents)}/mo for ${months} month${months === 1 ? '' : 's'}`;

/** The pace planner inside the Roth card (Goals page). The pace follows the tax year shown. */
export function RothPacePanel({ pace: p, year, today }: { pace: RothPace; year: number; today: string }) {
  const chartTheme = useChartTheme();
  const capBelow = p.earned.targetCents < p.limit.targetCents;
  const option = useMemo(() => rothPaceOption(p, today, capBelow ? p.earned.targetCents : null), [p, today, capBelow, chartTheme]);
  const tone = TONE[p.status];
  const closed = today > p.deadline;

  return (
    <div className="roth-pace" aria-label="Roth pace">
      <div className="pace-head">
        <div className="label">
          <Gauge size={13} /> Pace for {year}
        </div>
        <div className={`pace-status pace-${tone}`} role="status">
          <span className="pace-dot" aria-hidden />
          <b className="num">{paceHeadline(p)}</b>
        </div>
        <p className="hint">
          {closed
            ? `The ${year} window closed on ${formatDate(p.deadline)}. You put in ${formatCents(p.contributedCents)} of ${formatCents(p.limit.targetCents)}.`
            : `Compared with an even pace from ${formatDate(p.start)} to ${formatDate(p.deadline)}: ${formatCents(p.idealTodayCents)} by today, about ${formatCents(p.monthOfPaceCents)} a month.`}
        </p>
      </div>

      {!closed && (
        <div className="pace-targets">
          <div className="pace-target">
            <span className="label">IRS limit</span>
            <b className="num">{formatCents(p.limit.targetCents)}</b>
            <span className="pace-need num">{perMonth(p.limit.neededPerMonthCents, p.monthsLeft)}</span>
          </div>
          <div className="pace-target">
            <span className="label">You can put in so far</span>
            <b className="num">{formatCents(p.earned.targetCents)}</b>
            <span className="pace-need num">{perMonth(p.earned.neededPerMonthCents, p.monthsLeft)}</span>
          </div>
        </div>
      )}
      {!closed && (
        <p className="hint">
          {capBelow
            ? `The IRS only lets you put in as much as you earned from work (Refereeing and Other Income; interest and gifts do not count), so the second number is the lower of the limit and what you have earned in ${year} so far. It grows as you earn more.`
            : `You have already earned at least the full limit in ${year}, so both targets are the same.`}
          {p.overEarned && ' You have put in more than you have earned so far this year.'}
        </p>
      )}

      <Chart option={option} height={220} ariaLabel={`Roth contributions for ${year} against an even pace`} />
    </div>
  );
}
