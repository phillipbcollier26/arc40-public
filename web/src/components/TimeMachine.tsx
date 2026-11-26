import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hourglass } from 'lucide-react';
import { usePlanning } from '../lib/planning';
import { formatBasisPoints, formatCents, formatCompactCents } from '../lib/format';
import { MoneyInput } from './AccountForm';
import { BigMoney } from './Money';
import { futureYou } from '../../../shared/projection';
import { parseMoneyToCents } from '../../../shared/money';

const MAX_AMOUNT = 1_000_000_000; // $10M: a sanity cap for the box
const MAX_COINS = 16;
// Drawing area (SVG units)
const W = 640;
const H = 270;
const PAD = { l: 58, r: 26, t: 22, b: 34 };

/** "4.4×": value / amount in tenths, whole-number math, rounded half up. */
function multipleText(value: number, amount: number): string {
  const tenths = Math.floor((value * 20 + amount) / (amount * 2));
  return `${Math.floor(tenths / 10)}.${tenths % 10}×`;
}

/**
 * Future you (What if page): type an amount, drag the age. Shows what it would be worth at that age if invested
 * instead, in today's dollars, at the Settings return rate (the same engine as every projection).
 * Visual: a faint gold "ghost" curve to the oldest age, the bright curve growing out of the amount up to the age
 * picked, and a stack of gold coins (one per time your money is multiplied) rising at that age.
 */
export function TimeMachine() {
  const { planning } = usePlanning();
  const [amountText, setAmountText] = useState('50');
  const [extend, setExtend] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const gid = useId().replace(/:/g, '');

  const amount = useMemo(() => {
    try {
      const c = parseMoneyToCents(amountText);
      return c > 0 && c <= MAX_AMOUNT ? c : null;
    } catch {
      return null;
    }
  }, [amountText]);

  if (!planning) return <section className="card time-machine" />;
  const head = (
    <div className="tm-head">
      <div className="label">
        <Hourglass size={13} /> Future you
      </div>
      <span className="hint">What money you keep today could become, if invested instead.</span>
    </div>
  );
  if (!planning.birth || planning.age === null) {
    return (
      <section className="card time-machine" aria-label="Future you">
        {head}
        <p className="muted">
          Set your birth month and year in <Link to="/settings">Settings</Link> to use the time machine.
        </p>
      </section>
    );
  }
  const birth = planning.birth;
  const start = planning.age;
  if (start >= 65) {
    return (
      <section className="card time-machine" aria-label="Future you">
        {head}
        <p className="muted">You are 65 or older, so there is no later age to look at here.</p>
      </section>
    );
  }
  const canExtend = start < 40;
  const maxAge = canExtend && !extend ? 40 : 65;
  const age = Math.min(Math.max(picked ?? maxAge, start), maxAge);
  const rate = planning.returnRateBp;

  const ages = Array.from({ length: maxAge - start + 1 }, (_, i) => start + i);
  const values = amount ? ages.map((a) => futureYou(amount, birth, planning.today, rate, a)!.valueCents) : [];
  const now = amount ? futureYou(amount, birth, planning.today, rate, age)! : null;
  const top = values.length ? values[values.length - 1]! : 1;
  const x = (a: number) => PAD.l + ((a - start) / Math.max(maxAge - start, 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / (top * 1.08)) * (H - PAD.t - PAD.b);
  const path = (upto: number) =>
    ages
      .filter((a) => a <= upto)
      .map((a, i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)},${y(values[a - start]!).toFixed(1)}`)
      .join(' ');
  const live = amount ? path(age) : '';
  const area = amount ? `${live} L${x(age).toFixed(1)},${H - PAD.b} L${x(start).toFixed(1)},${H - PAD.b} Z` : '';
  // One coin per time the money is multiplied (at least one), capped.
  const coins = now && amount ? Math.min(MAX_COINS, Math.max(1, Math.floor(now.valueCents / amount))) : 0;
  const more = now && amount ? Math.floor(now.valueCents / amount) > MAX_COINS : false;
  const ticks = [start, ...[25, 30, 35, 40, 45, 50, 55, 60, 65].filter((a) => a > start + 2 && a < maxAge - 2), maxAge];

  return (
    <section className="card time-machine" aria-label="Future you">
      {head}
      <div className="tm-body">
        <div className="tm-controls">
          <label className="field">
            <span className="label">If I keep</span>
            <MoneyInput value={amountText} onChange={setAmountText} ariaLabel="Amount to invest" />
          </label>
          <label className="field">
            <span className="label">
              Until age <b className="num tm-age">{age}</b>
            </span>
            <input
              type="range"
              className="tm-slider"
              aria-label="Age"
              min={start}
              max={maxAge}
              step={1}
              value={age}
              onChange={(e) => setPicked(Number(e.target.value))}
            />
            <span className="tm-scale num">
              <span>{start}</span>
              <span>{maxAge}</span>
            </span>
          </label>
          {canExtend && (
            <label className="check">
              <input type="checkbox" checked={extend} onChange={(e) => (setExtend(e.target.checked), setPicked(null))} aria-label="Extend to 65" />
              <span>Extend to 65</span>
            </label>
          )}
          <div className="tm-result" aria-live="polite">
            {now && amount ? (
              <>
                <span className="label">It could be</span>
                <BigMoney cents={now.valueCents} size="lg" />
                <span className="tm-sub">
                  at age {now.age}, in today's dollars · <b className="num">{multipleText(now.valueCents, amount)}</b> what you kept
                </span>
              </>
            ) : (
              <span className="hint">Type an amount like 50 or 12.50.</span>
            )}
          </div>
          <p className="hint">
            {formatBasisPoints(rate, { sign: false }).replace(/\.00%$/, '%')} a year after inflation (Settings). Estimate, not financial advice.
          </p>
        </div>

        <svg className="tm-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={now && amount ? `${formatCents(amount)} could grow to ${formatCents(now.valueCents)} by age ${now.age}` : 'Future you chart'}>
          <defs>
            <linearGradient id={`${gid}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--gold)', stopOpacity: 0.32 }} />
              <stop offset="100%" style={{ stopColor: 'var(--gold)', stopOpacity: 0 }} />
            </linearGradient>
            <linearGradient id={`${gid}-coin`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--gold-bright)' }} />
              <stop offset="55%" style={{ stopColor: 'var(--gold)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--gold-deep)' }} />
            </linearGradient>
          </defs>
          {/* grid */}
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line className="tm-grid" x1={PAD.l} x2={W - PAD.r} y1={y(top * f)} y2={y(top * f)} />
              <text className="tm-axis" x={PAD.l - 8} y={y(top * f) + 4} textAnchor="end">
                {formatCompactCents(Math.round(top * f))}
              </text>
            </g>
          ))}
          <line className="tm-base" x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} />
          {ticks.map((a) => (
            <text key={a} className="tm-axis" x={x(a)} y={H - PAD.b + 18} textAnchor="middle">
              {a}
            </text>
          ))}
          {amount && (
            <>
              <path className="tm-ghost" d={path(maxAge)} />
              <path d={area} fill={`url(#${gid}-area)`} className="tm-area" />
              <path className="tm-live" d={live} />
              <circle className="tm-start" cx={x(start)} cy={y(amount)} r={4.5} />
              <line className="tm-drop" x1={x(age)} x2={x(age)} y1={y(now!.valueCents)} y2={H - PAD.b} />
              {/* coins rising at the chosen age */}
              <g className="tm-coins" transform={`translate(${x(age).toFixed(1)}, ${H - PAD.b - 6})`}>
                {Array.from({ length: coins }, (_, i) => (
                  <g key={i} className="tm-coin" style={{ animationDelay: `${i * 35}ms` }} transform={`translate(0, ${-i * 7})`}>
                    <ellipse rx={15} ry={4.6} cy={2} className="tm-coin-edge" />
                    <ellipse rx={15} ry={4.6} fill={`url(#${gid}-coin)`} />
                  </g>
                ))}
                {more && (
                  <text className="tm-axis" x={20} y={-coins * 7 + 4}>
                    +
                  </text>
                )}
              </g>
              <circle className="tm-end" cx={x(age)} cy={y(now!.valueCents)} r={6} />
            </>
          )}
        </svg>
      </div>
    </section>
  );
}
