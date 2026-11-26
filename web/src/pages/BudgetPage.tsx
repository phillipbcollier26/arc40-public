import { useMemo, useState, type FormEvent } from 'react';
import { WorkCost } from '../components/WorkCost';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Info, TriangleAlert, Whistle } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import type { BudgetCategory, BudgetMonth, Cashflow } from '../lib/types';
import { Chart } from '../components/Chart';
import { Modal } from '../components/Modal';
import { Segmented } from '../components/Controls';
import { MoneyInput } from '../components/AccountForm';
import { RateRing } from '../components/RateRing';
import { BigMoney } from '../components/Money';
import { cashflowOption, spendingDonutOption } from '../lib/charts';
import { formatBasisPoints, formatCents, todayIso } from '../lib/format';
import { addMonths, startOfMonth } from '../../../shared/dates';
import { useChartTheme } from '../lib/themeMode';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export function BudgetPage() {
  const current = startOfMonth(todayIso());
  const [month, setMonth] = useState(current);
  const [editing, setEditing] = useState<BudgetCategory | null>(null);
  const { data: b, reload } = useApi<BudgetMonth>(`/api/budget?month=${month}`);
  const { data: cf, reload: reloadCf } = useApi<Cashflow>('/api/cashflow?months=12');

  const chartTheme = useChartTheme();
  const flowOption = useMemo(() => (cf ? cashflowOption(cf.months) : null), [cf, chartTheme]);
  const donutRows = useMemo(() => {
    if (!b) return [];
    const rows = b.categories.filter((c) => c.spentCents > 0).map((c) => ({ name: c.name, color: c.color, cents: c.spentCents }));
    if (b.uncategorizedCents > 0) rows.push({ name: 'Uncategorized', color: 'pewter', cents: b.uncategorizedCents });
    return rows.sort((x, y) => y.cents - x.cents);
  }, [b]);
  const donutOption = useMemo(() => (donutRows.length ? spendingDonutOption(donutRows) : null), [donutRows, chartTheme]);

  async function setAvgMonths(n: 3 | 6 | 12) {
    await api('PUT', '/api/settings/budget', { incomeAvgMonths: n });
    reload();
  }

  const withLimit = (b?.categories ?? []).filter((c) => c.limitCents !== null);
  const withoutLimit = (b?.categories ?? []).filter((c) => c.limitCents === null);
  const groups = [...new Set(withLimit.map((c) => c.group))];
  const left = b ? b.income.thisMonthCents - b.totals.spentCents : 0;

  return (
    <div className="page">
      <header className="page-head rise">
        <div>
          <div className="label">Plan</div>
          <h1 className="page-title">Budget</h1>
        </div>
        <div className="month-nav">
          <button className="btn btn-ghost icon-btn" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}>
            <ChevronLeft size={18} />
          </button>
          <span className="month-label">{label(month)}</span>
          <button className="btn btn-ghost icon-btn" aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))} disabled={month >= current}>
            <ChevronRight size={18} />
          </button>
        </div>
      </header>

      {cf && cf.ytd.uncategorizedIncomeCents > 0 && (
        <Link to="/transactions" className="notice-bar rise">
          <TriangleAlert size={16} />
          {formatCents(cf.ytd.uncategorizedIncomeCents)} of money in this year has no category, so it counts as income. If any of it was a gift
          or a transfer from your own account, change its type on the Transactions page.
        </Link>
      )}

      <div className="grid-budget-top rise" style={{ animationDelay: '60ms' }}>
        <section className="card rate-card">
          <RateRing bp={b?.savingsRateBp ?? null} />
          <div className="rate-side">
            <div className="label">Year to date ({cf?.ytd.year})</div>
            <div className="ytd-rate num">{cf ? (cf.ytd.savingsRateBp === null ? 'No income yet' : formatBasisPoints(cf.ytd.savingsRateBp, { sign: false })) : ''}</div>
            <p className="hint">(income - spending) / income. Transfers and gifts are left out of both.</p>
          </div>
        </section>

        <section className="card month-card">
          <div className="label">{label(month)}</div>
          <div className="mini-stats">
            <div className="mini-stat tone-sage">
              <span>Income</span>
              <b className="num">{formatCents(b?.income.thisMonthCents ?? 0)}</b>
            </div>
            <div className="mini-stat tone-garnet">
              <span>Spending</span>
              <b className="num">{formatCents(b?.totals.spentCents ?? 0)}</b>
            </div>
            <div className="mini-stat tone-gold">
              <span>Kept</span>
              <BigMoney cents={left} size="md" />
            </div>
          </div>
        </section>

        <section className="card baseline-card">
          <div className="card-head">
            <div className="label">Plan from your average income</div>
          </div>
          <Segmented
            ariaLabel="Average over"
            value={String(b?.income.avgMonths ?? 3) as '3' | '6' | '12'}
            onChange={(v) => setAvgMonths(Number(v) as 3 | 6 | 12)}
            options={[
              { value: '3', label: '3 months' },
              { value: '6', label: '6 months' },
              { value: '12', label: '12 months' },
            ]}
          />
          <div className="baseline-num num">{b?.income.avgCents === null || !b ? 'Not enough history' : `${formatCents(b.income.avgCents)} / mo`}</div>
          <p className="hint">
            {b && b.income.monthsUsed > 0 && b.income.monthsUsed < b.income.avgMonths
              ? `Based on ${b.income.monthsUsed} month${b.income.monthsUsed === 1 ? '' : 's'} of history so far. `
              : ''}
            Your limits add up to {formatCents(b?.totals.limitCents ?? 0)}.
          </p>
          {b?.income.overAverage && (
            <div className="notice-bar is-error">
              <TriangleAlert size={16} /> Your limits are higher than your average income.
            </div>
          )}
        </section>
      </div>

      <section className="card rise" style={{ animationDelay: '120ms' }}>
        <div className="card-head">
          <div className="label">Income vs spending, last 12 months</div>
          <span className="hint">Click a month to see it below</span>
        </div>
        {flowOption ? (
          <Chart
            option={flowOption}
            height={320}
            ariaLabel="Income and spending by month with savings rate"
            onPick={(i) => cf && cf.months[i] && setMonth(cf.months[i]!.month)}
          />
        ) : (
          <div className="skeleton" style={{ height: 320 }} />
        )}
      </section>

      <div className="grid-budget rise" style={{ animationDelay: '180ms' }}>
        <section className="card">
          <div className="card-head">
            <div className="label">Spending limits</div>
            <span className="hint">Click a category to set its limit</span>
          </div>
          {groups.map((g) => (
            <div key={g} className="budget-group">
              <h4>{g}</h4>
              {withLimit
                .filter((c) => c.group === g)
                .map((c) => (
                  <BudgetRow key={c.id} c={c} onClick={() => setEditing(c)} />
                ))}
            </div>
          ))}
          {withoutLimit.length > 0 && (
            <details className="budget-nolimit">
              <summary>No limit set ({withoutLimit.length})</summary>
              {withoutLimit.map((c) => (
                <button key={c.id} className="nolimit-row" onClick={() => setEditing(c)}>
                  <span className="cat-dot" style={{ background: `var(--${c.color})` }} />
                  <span>{c.name}</span>
                  <span className="num">{formatCents(c.spentCents)}</span>
                  {c.spentCents > 0 && <WorkCost costCents={c.spentCents} className="budget-work" />}
                </button>
              ))}
            </details>
          )}
          {(b?.uncategorizedCents ?? 0) > 0 && (
            <p className="hint" style={{ marginTop: 12 }}>
              <Info size={13} /> {formatCents(b!.uncategorizedCents)} of spending is uncategorized. <Link to="/transactions">Categorize it</Link>
            </p>
          )}
        </section>

        <div className="stack">
          <section className="card">
            <div className="label">Where it went</div>
            {donutOption ? (
              <>
                <Chart option={donutOption} height={220} ariaLabel="Spending by category" />
                <ul className="donut-legend">
                  {donutRows.slice(0, 6).map((r) => (
                    <li key={r.name}>
                      <span className="cat-dot" style={{ background: `var(--${r.color})` }} />
                      {r.name}
                      <b className="num">{formatCents(r.cents)}</b>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">No spending in {label(month)}.</p>
            )}
          </section>

          <section className="card gig-card">
            <div className="label">
              <Whistle size={13} /> Refereeing, {cf?.ytd.year}
            </div>
            <div className="mini-stats">
              <div className="mini-stat tone-sage">
                <span>Pay</span>
                <b className="num">{formatCents(cf?.gig.payCents ?? 0)}</b>
              </div>
              <div className="mini-stat tone-garnet">
                <span>Gear & fees</span>
                <b className="num">{formatCents(cf?.gig.costsCents ?? 0)}</b>
              </div>
              <div className="mini-stat tone-gold">
                <span>Net</span>
                <b className="num">{formatCents(cf?.gig.netCents ?? 0)}</b>
              </div>
            </div>
            {cf && cf.gig.setAsideBp > 0 ? (
              <div className="setaside">
                <span>
                  Set aside for taxes ({formatBasisPoints(cf.gig.setAsideBp, { sign: false })} of {cf.gig.setAsideOnNet ? 'net' : 'gross'} pay)
                </span>
                <b className="num">{formatCents(cf.gig.setAsideCents)}</b>
                <small>Estimate based on the percent you chose. Not tax advice.</small>
              </div>
            ) : (
              <p className="hint">
                Optional: turn on a tax set-aside estimate in <Link to="/settings">Settings</Link>.
              </p>
            )}
          </section>
        </div>
      </div>

      {editing && (
        <Modal title={`${editing.name} limit`} onClose={() => setEditing(null)}>
          <LimitEditor
            c={editing}
            month={month}
            onDone={() => {
              setEditing(null);
              reload();
              reloadCf();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function BudgetRow({ c, onClick }: { c: BudgetCategory; onClick: () => void }) {
  const limit = c.limitCents ?? 0;
  const ratio = limit > 0 ? c.spentCents / limit : c.spentCents > 0 ? 2 : 0;
  const tone = ratio > 1 ? 'over' : ratio >= 0.8 ? 'near' : 'ok';
  const leftCents = limit - c.spentCents;
  return (
    <button className={`budget-row tone-${tone}`} onClick={onClick} aria-label={`${c.name} budget`}>
      <span className="budget-name">
        <span className="cat-dot" style={{ background: `var(--${c.color})` }} />
        {c.name}
        {c.isOverride && <span className="chip">this month</span>}
      </span>
      <span className="budget-amounts num">
        {formatCents(c.spentCents)} <small>of {formatCents(limit)}</small>
      </span>
      <span className="budget-bar">
        <span style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
      </span>
      <span className="budget-left">{leftCents >= 0 ? `${formatCents(leftCents)} left` : `${formatCents(-leftCents)} over`}</span>
      {c.spentCents > 0 && <WorkCost costCents={c.spentCents} className="budget-work" />}
    </button>
  );
}

function LimitEditor({ c, month, onDone }: { c: BudgetCategory; month: string; onDone: () => void }) {
  const [amount, setAmount] = useState(c.limitCents === null ? '' : formatCents(c.limitCents).slice(1));
  const [scope, setScope] = useState<'all' | 'month'>(c.isOverride ? 'month' : 'all');
  const [error, setError] = useState<string | null>(null);
  const target = scope === 'all' ? null : month;

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api('PUT', '/api/budget', { categoryId: c.id, month: target, limit: amount });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    }
  }
  async function remove() {
    await api('PUT', '/api/budget', { categoryId: c.id, month: target, limit: null });
    onDone();
  }

  return (
    <form className="stack" onSubmit={save}>
      <label className="field">
        <span className="label">Monthly limit</span>
        <MoneyInput value={amount} onChange={setAmount} ariaLabel="Monthly limit" autoFocus />
      </label>
      <div className="field">
        <span className="label">Applies to</span>
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: 'Every month' },
            { value: 'month', label: `Only ${label(month)}` },
          ]}
        />
      </div>
      <p className="hint">Spent in {label(month)}: {formatCents(c.spentCents)}.</p>
      {error && <p className="error-text">{error}</p>}
      <div className="form-actions spread">
        <button type="button" className="btn btn-ghost danger" onClick={remove}>
          Remove limit
        </button>
        <button className="btn btn-primary" disabled={!amount.trim()}>
          Save limit
        </button>
      </div>
    </form>
  );
}
