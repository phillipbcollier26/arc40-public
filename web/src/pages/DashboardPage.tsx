import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, CalendarDays, Flag, Landmark, LineChart, PieChart, Plus, ShieldCheck, Target, Wallet } from 'lucide-react';
import { useApi } from '../lib/useApi';
import type { AccountSummary, BudgetMonth, Cashflow, DashboardExtras, Goals, Investments, NetWorth, Range, UpcomingBills } from '../lib/types';
import { UpcomingList } from '../components/Bills';
import { MoneyRiverCard } from '../components/MoneyRiver';
import { WrappedCard } from '../components/Wrapped';
import { DashboardTrophies } from '../components/TrophyShelf';
import { Chart } from '../components/Chart';
import { BigMoney, ChangePill } from '../components/Money';
import { RangeTabs, Segmented } from '../components/Controls';
import { RateRing } from '../components/RateRing';
import { Ring } from '../components/Ring';
import {
  allocationOption,
  calendarOption,
  cashflowOption,
  incomeSourceOption,
  mixDonutOption,
  netWorthOption,
  payerOption,
  treemapOption,
} from '../lib/charts';
import { formatBasisPoints, formatCents, formatDate } from '../lib/format';
import { seriesColor } from '../lib/theme';
import { useChartTheme } from '../lib/themeMode';

const RANGE_LABEL: Record<Range, string> = {
  '1m': 'past month',
  '3m': 'past 3 months',
  '6m': 'past 6 months',
  '1y': 'past year',
  all: 'all time',
};

const pctOf = (cur: number, target: number) => (target > 0 ? Math.floor((cur * 100) / target) : 0);

/** One card title row with an icon and an optional link to the full page. */
function CardHead({ icon: Icon, title, to, linkText = 'Open' }: { icon: typeof Wallet; title: string; to?: string; linkText?: string }) {
  return (
    <div className="card-head">
      <div className="label dash-label">
        <Icon size={13} /> {title}
      </div>
      {to && (
        <Link to={to} className="link-quiet">
          {linkText}
        </Link>
      )}
    </div>
  );
}

export function DashboardPage() {
  const [range, setRange] = useState<Range>('1y');
  const [mode, setMode] = useState<'total' | 'accounts'>('total');
  const { data: nw } = useApi<NetWorth>(`/api/networth?range=${range}`);
  const { data: acc } = useApi<{ accounts: AccountSummary[] }>('/api/accounts');
  const { data: cf } = useApi<Cashflow>('/api/cashflow?months=12');
  const { data: budget } = useApi<BudgetMonth>('/api/budget');
  const { data: inv } = useApi<Investments>('/api/investments');
  const { data: goals } = useApi<Goals>('/api/goals');
  const { data: dx } = useApi<DashboardExtras>('/api/dashboard');
  const { data: upcoming } = useApi<UpcomingBills>('/api/recurring/upcoming');

  const chartTheme = useChartTheme();
  const nwOption = useMemo(() => (nw ? netWorthOption(nw, mode) : null), [nw, mode, chartTheme]);
  const allocOption = useMemo(() => (nw && nw.allocation.length ? allocationOption(nw) : null), [nw, chartTheme]);
  const flowOption = useMemo(() => (cf ? cashflowOption(cf.months) : null), [cf, chartTheme]);
  const treeOption = useMemo(() => (dx && dx.spendingByCategory.length ? treemapOption(dx.spendingByCategory) : null), [dx, chartTheme]);
  const calOption = useMemo(() => (dx ? calendarOption(dx.daily, dx.calendarFrom, dx.today) : null), [dx, chartTheme]);
  const payOption = useMemo(() => (dx && dx.incomeByPayer.length ? payerOption(dx.incomeByPayer) : null), [dx, chartTheme]);
  const sourceOption = useMemo(() => (dx && dx.incomeBySource.sources.length ? incomeSourceOption(dx.incomeBySource) : null), [dx, chartTheme]);
  const holdingsOption = useMemo(() => {
    const rows = (inv?.holdings ?? []).filter((h) => h.valueCents && h.valueCents > 0).map((h) => ({ name: h.symbol, cents: h.valueCents! }));
    return rows.length ? mixDonutOption(rows, 'HOLDINGS') : null;
  }, [inv, chartTheme]);

  if (nw && !nw.hasData) return <EmptyDashboard />;

  const accounts = (acc?.accounts ?? []).filter((a) => a.balanceCents !== null);
  const assets = nw?.current.assetsCents ?? 0;
  const allIds = nw?.accounts.map((a) => a.id) ?? [];
  const thisMonth = cf?.months.at(-1);
  const budgeted = (budget?.categories ?? []).filter((c) => c.limitCents !== null && (c.limitCents > 0 || c.spentCents > 0)).slice(0, 6);
  const r = goals?.roth;
  const e = goals?.emergency;
  const spendTotal12 = (dx?.spendingByCategory ?? []).reduce((s, c) => s + c.cents, 0);

  return (
    <div className="page">
      <header className="page-head rise">
        <div>
          <div className="label">Overview</div>
          <h1 className="page-title">Dashboard</h1>
        </div>
        <div className="dash-head-tools">
          <WrappedCard />
          <RangeTabs value={range} onChange={setRange} />
        </div>
      </header>

      {/* ---------- Net worth hero ---------- */}
      <section className="hero card rise" style={{ animationDelay: '40ms' }}>
        <div className="hero-main">
          <div className="label">Net worth</div>
          {nw ? <BigMoney cents={nw.current.totalCents} /> : <div className="skeleton skeleton-hero" />}
          {nw && (
            <div className="hero-change">
              <ChangePill cents={nw.change.cents} basisPoints={nw.change.basisPoints} />
              <span className="muted-inline">{RANGE_LABEL[range]}</span>
            </div>
          )}
        </div>
        {nw && (
          <div className="hero-stats">
            <div className="hero-stat tone-gold">
              <div className="label">Assets</div>
              <div className="hero-stat-num num">{formatCents(nw.current.assetsCents)}</div>
            </div>
            {nw.current.liabilitiesCents > 0 && (
              <div className="hero-stat tone-garnet">
                <div className="label">Debt</div>
                <div className="hero-stat-num num">{formatCents(-nw.current.liabilitiesCents)}</div>
              </div>
            )}
            <div className="hero-stat tone-silver">
              <div className="label">Invested</div>
              <div className="hero-stat-num num">{formatCents(inv?.totals.valueCents ?? 0)}</div>
            </div>
          </div>
        )}
      </section>

      {/* ---------- KPI strip ---------- */}
      {/* ---------- Trophies (Trophies Round 2): right under the hero ---------- */}
      <DashboardTrophies />

      <section className="kpi-strip rise" style={{ animationDelay: '80ms' }}>
        <Link to="/budget" className="card kpi">
          <div className="label">Savings rate · this month</div>
          <div className="kpi-num num">{thisMonth ? (thisMonth.savingsRateBp === null ? 'No income' : formatBasisPoints(thisMonth.savingsRateBp, { sign: false })) : ''}</div>
          <div className="kpi-sub">
            YTD {cf?.ytd.savingsRateBp === null || !cf ? 'n/a' : formatBasisPoints(cf.ytd.savingsRateBp, { sign: false })}
          </div>
        </Link>
        <Link to="/budget" className="card kpi">
          <div className="label">Income · this month</div>
          <div className="kpi-num num tone-sage-text">{formatCents(thisMonth?.incomeCents ?? 0)}</div>
          <div className="kpi-sub">YTD {formatCents(cf?.ytd.incomeCents ?? 0)}</div>
        </Link>
        <Link to="/budget" className="card kpi">
          <div className="label">Spending · this month</div>
          <div className="kpi-num num">{formatCents(thisMonth?.spendingCents ?? 0)}</div>
          <div className="kpi-sub">YTD {formatCents(cf?.ytd.spendingCents ?? 0)}</div>
        </Link>
        <Link to="/investments" className="card kpi">
          <div className="label">Investment growth</div>
          <div className={`kpi-num num ${(inv?.totals.growthCents ?? 0) >= 0 ? 'tone-gold-text' : 'tone-garnet-text'}`}>
            {formatCents(inv?.totals.growthCents ?? 0, { sign: true })}
          </div>
          <div className="kpi-sub">{inv?.totals.growthBp === null || !inv ? 'on money put in' : `${formatBasisPoints(inv.totals.growthBp)} on money put in`}</div>
        </Link>
        <Link to="/goals" className="card kpi">
          <div className="label">Roth IRA {r?.year}</div>
          <div className="kpi-num num">{r && r.limitCents ? `${pctOf(r.contributedCents, r.limitCents)}%` : ''}</div>
          <div className="kpi-sub">{r && r.limitCents ? `${formatCents(r.contributedCents)} of ${formatCents(r.limitCents)}` : 'Set the limit on Goals'}</div>
        </Link>
      </section>

      {/* ---------- Net worth over time ---------- */}
      <section className="card rise" style={{ animationDelay: '120ms' }}>
        <div className="card-head">
          <div>
            <div className="label dash-label">
              <LineChart size={13} /> Net worth over time
            </div>
            {nw && <div className="card-sub">Since {formatDate(nw.from)}</div>}
          </div>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'total', label: 'Total' },
              { value: 'accounts', label: 'By account' },
            ]}
          />
        </div>
        {nwOption ? <Chart option={nwOption} height={330} ariaLabel="Net worth over time" /> : <div className="skeleton" style={{ height: 330 }} />}
      </section>

      {/* ---------- Money river (V2 Phase 4) ---------- */}
      <div className="rise" style={{ animationDelay: '140ms' }}>
        <MoneyRiverCard />
      </div>

      {/* ---------- Cash flow + savings rate ---------- */}
      <div className="grid-dash-2 rise" style={{ animationDelay: '160ms' }}>
        <section className="card">
          <CardHead icon={PieChart} title="Income, spending & savings rate · 12 months" to="/budget" linkText="Budget" />
          {flowOption ? <Chart option={flowOption} height={300} ariaLabel="Income and spending by month with savings rate" /> : <div className="skeleton" style={{ height: 300 }} />}
        </section>
        <section className="card ring-card">
          <CardHead icon={PieChart} title="This month" />
          <RateRing bp={thisMonth?.savingsRateBp ?? null} size={180} />
          <div className="mini-stats">
            <div className="mini-stat tone-sage">
              <span>Kept this month</span>
              <b className="num">{formatCents((thisMonth?.incomeCents ?? 0) - (thisMonth?.spendingCents ?? 0))}</b>
            </div>
            <div className="mini-stat tone-gold">
              <span>Gifts received YTD</span>
              <b className="num">{formatCents(cf?.ytd.giftCents ?? 0)}</b>
            </div>
          </div>
        </section>
      </div>

      {/* ---------- Spending ---------- */}
      <div className="grid-dash-2 rise" style={{ animationDelay: '200ms' }}>
        <section className="card">
          <CardHead icon={Wallet} title={`Spending by category · 12 months · ${formatCents(spendTotal12)}`} to="/transactions" linkText="Transactions" />
          {treeOption ? <Chart option={treeOption} height={300} ariaLabel="Spending by category treemap" /> : <p className="muted">No spending yet.</p>}
        </section>
        <section className="card">
          <CardHead icon={Target} title="Budget this month" to="/budget" linkText="Edit" />
          {budgeted.length ? (
            <div className="ring-grid">
              {budgeted.map((c) => {
                const limit = c.limitCents ?? 0;
                const p = limit > 0 ? pctOf(c.spentCents, limit) : c.spentCents > 0 ? 101 : 0;
                return (
                  <div key={c.id} className="ring-cell">
                    <Ring pct={p} size={92} stroke={10} tone={p > 100 ? 'garnet' : p >= 80 ? 'bronze' : 'gold'}>
                      <span className="ring-small num">{limit > 0 ? `${p}%` : '$0'}</span>
                    </Ring>
                    <span className="ring-name">{c.name}</span>
                    <span className="ring-amt num">
                      {formatCents(c.spentCents)} / {formatCents(limit)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">
              Set monthly limits on the <Link to="/budget">Budget</Link> page to see them here.
            </p>
          )}
        </section>
      </div>

      <div className="grid-dash-bills rise" style={{ animationDelay: '240ms' }}>
        <section className="card">
          <CardHead icon={CalendarDays} title="Spending calendar · last 12 months" />
          {calOption ? <Chart option={calOption} height={150} ariaLabel="Daily spending calendar" /> : <div className="skeleton" style={{ height: 150 }} />}
          <p className="hint">Each square is a day. The stronger the gold, the more you spent that day.</p>
        </section>
        <section className="card next30-card" aria-label="Next 30 days">
          <CardHead icon={CalendarClock} title="Next 30 days" to="/recurring" linkText="Recurring" />
          {upcoming ? <UpcomingList data={upcoming} limit={4} /> : <div className="skeleton" style={{ height: 150 }} />}
        </section>
      </div>

      {/* ---------- Income ---------- */}
      <div className="grid-dash-2 rise" style={{ animationDelay: '280ms' }}>
        <section className="card">
          <CardHead icon={Flag} title="Income by source · refereeing seasons" />
          {sourceOption ? <Chart option={sourceOption} height={260} ariaLabel="Income by source per month" /> : <p className="muted">No income yet.</p>}
        </section>
        <section className="card">
          <CardHead icon={Flag} title="Refereeing pay by who paid you · 12 months" />
          {payOption ? (
            <Chart option={payOption} height={260} ariaLabel="Refereeing pay by payer" />
          ) : (
            <p className="muted">Fill in "Paid by" on refereeing income to see who pays you most.</p>
          )}
        </section>
      </div>

      {/* ---------- Investments + goals ---------- */}
      <div className="grid-dash-3 rise" style={{ animationDelay: '320ms' }}>
        <section className="card">
          <CardHead icon={LineChart} title="Holdings mix" to="/investments" />
          {holdingsOption ? <Chart option={holdingsOption} height={210} ariaLabel="Holdings mix" /> : <p className="muted">Import Fidelity history to see holdings.</p>}
          {inv && (
            <div className="mini-stats">
              <div className="mini-stat tone-silver">
                <span>Money put in</span>
                <b className="num">{formatCents(inv.totals.putInCents)}</b>
              </div>
            </div>
          )}
        </section>
        <section className="card ring-card">
          <CardHead icon={Target} title={`Roth IRA ${r?.year ?? ''}`} to="/goals" />
          {r && r.limitCents ? (
            <>
              <Ring pct={pctOf(r.contributedCents, r.limitCents)} size={170}>
                <span className="rate-num num">{pctOf(r.contributedCents, r.limitCents)}%</span>
                <span className="label">of {formatCents(r.limitCents)}</span>
              </Ring>
              <p className="hint center">{formatCents(r.remainingCents ?? 0)} of room left</p>
            </>
          ) : (
            <p className="muted">Enter this year's limit on the Goals page.</p>
          )}
        </section>
        <section className="card ring-card">
          <CardHead icon={ShieldCheck} title="Emergency fund" to="/goals" />
          {e && e.targetCents ? (
            <>
              <Ring pct={pctOf(e.savingsCents, e.targetCents)} size={170} tone="silver">
                <span className="rate-num num">{Math.min(999, pctOf(e.savingsCents, e.targetCents))}%</span>
                <span className="label">of 6 months</span>
              </Ring>
              <p className="hint center">
                {formatCents(e.savingsCents)} saved vs {formatCents(e.targetCents)}
              </p>
            </>
          ) : (
            <p className="muted">Needs a few months of spending history.</p>
          )}
        </section>
      </div>

      {goals && goals.custom.length > 0 && (
        <section className="card rise">
          <CardHead icon={Target} title="Your goals" to="/goals" />
          <div className="goal-bars">
            {goals.custom.map((g) => (
              <div key={g.id} className="goal-bar">
                <div className="goal-bar-top">
                  <span>{g.name}</span>
                  <span className="num">
                    {formatCents(g.currentCents)} <small>of {formatCents(g.targetCents)}</small>
                  </span>
                </div>
                <div className="budget-bar">
                  <span style={{ width: `${Math.min(100, pctOf(g.currentCents, g.targetCents))}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------- Where the money is ---------- */}
      <div className="grid-dash rise">
        <section className="card">
          <CardHead icon={Wallet} title="Where your money is" />
          {allocOption && nw ? (
            <div className="alloc">
              <Chart option={allocOption} height={230} ariaLabel="Money by account group" />
              <ul className="alloc-legend">
                {nw.allocation.map((a) => (
                  <li key={a.group}>
                    <span className={`dot dot-${a.group}`} />
                    <span>{a.label}</span>
                    <b className="num">{formatCents(a.cents)}</b>
                    <span className="alloc-pct">{assets ? Math.round((a.cents * 100) / assets) : 0}%</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="skeleton" style={{ height: 230 }} />
          )}
        </section>
        <section className="card">
          <CardHead icon={Landmark} title="Accounts" to="/accounts" linkText="Manage" />
          <ul className="acct-mini">
            {accounts.map((a) => {
              const share = assets > 0 && a.balanceCents ? Math.max(0, Math.round((a.balanceCents * 1000) / assets)) / 10 : 0;
              return (
                <li key={a.id}>
                  <Link to={`/accounts/${a.id}`}>
                    <span className="acct-swatch" style={{ background: seriesColor(allIds.indexOf(a.id)) }} />
                    <span className="acct-mini-name">
                      {a.name}
                      <small>{a.typeLabel}</small>
                    </span>
                    <span className="acct-mini-bal num">{formatCents(a.balanceCents ?? 0)}</span>
                    <span className="acct-bar">
                      <span style={{ width: `${share}%`, background: seriesColor(allIds.indexOf(a.id)) }} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

function EmptyDashboard() {
  return (
    <div className="page">
      <header className="page-head rise">
        <div>
          <div className="label">Overview</div>
          <h1 className="page-title">Dashboard</h1>
        </div>
      </header>
      <div className="card empty rise" style={{ animationDelay: '60ms' }}>
        <div className="empty-icon">
          <Landmark size={28} strokeWidth={1.5} />
        </div>
        <h3>Add your first account</h3>
        <p className="muted">
          Add your checking, savings and investment accounts with their current balances. Your net worth and charts appear here as soon as
          you do.
        </p>
        <Link to="/accounts?add=1" className="btn btn-primary" style={{ marginTop: 14 }}>
          <Plus size={16} /> Add account
        </Link>
      </div>
    </div>
  );
}
