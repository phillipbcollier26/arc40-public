import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, Info, Plus, Telescope, Trash2, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import { Chart } from '../components/Chart';
import { BigMoney } from '../components/Money';
import { Segmented } from '../components/Controls';
import { MoneyInput } from '../components/AccountForm';
import { TimeMachine } from '../components/TimeMachine';
import { whatIfOption } from '../lib/charts';
import { useChartTheme } from '../lib/themeMode';
import { formatBasisPoints, formatCents } from '../lib/format';
import type { AppSettings, WhatIfChange, WhatIfPath, WhatIfRange, WhatIfReach, WhatIfResult } from '../lib/types';

/** Scenario metals in card order (the current path is platinum). */
const METALS = ['gold', 'silver', 'bronze'] as const;
const MAX_SCENARIOS = 3;
const MAX_CHANGES = 10;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const pct = (bp: number) => formatBasisPoints(bp, { sign: false }).replace(/\.00%$/, '%').replace(/0%$/, '%');

interface Draft {
  key: number;
  name: string;
  changes: WhatIfChange[];
}

/** "18 years 3 months" */
function yearsMonths(m: number): string {
  const y = Math.floor(m / 12);
  const r = m % 12;
  const parts = [y ? `${y} year${y === 1 ? '' : 's'}` : '', r ? `${r} month${r === 1 ? '' : 's'}` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : 'now';
}

function reachText(r: WhatIfReach, notReached: string): string {
  if (r.month === null || r.date === null) return notReached;
  if (r.month === 0) return 'Already there';
  return `${monthYear(r.date)}${r.age !== null ? ` · age ${r.age}` : ''}`;
}

/** "4 months sooner" / "1 year later" / "same" compared with the current path. */
function shift(s: WhatIfReach, c: WhatIfReach): { text: string; tone: 'good' | 'bad' | 'same' } | null {
  if (s.month === null && c.month === null) return null;
  if (s.month === null) return { text: 'no longer reached', tone: 'bad' };
  if (c.month === null) return { text: 'reached on this path only', tone: 'good' };
  const d = s.month - c.month;
  if (d === 0) return { text: 'same', tone: 'same' };
  return { text: `${yearsMonths(Math.abs(d))} ${d < 0 ? 'sooner' : 'later'}`, tone: d < 0 ? 'good' : 'bad' };
}

function describeChange(c: WhatIfChange, catName: (id: number) => string): string {
  if (c.kind === 'spending') return `${catName(c.categoryId)} ${c.direction === 'down' ? '−' : '+'}$${c.amount}/mo`;
  if (c.kind === 'roth') return `Roth IRA $${c.monthly}/mo`;
  return `Return ${c.rate.replace(/%$/, '')}% a year`;
}

export function WhatIfPage() {
  const { data: settings } = useApi<AppSettings>('/api/settings');
  const [baselineMonths, setBaselineMonths] = useState<number | null>(null);
  const [range, setRange] = useState<WhatIfRange>('10y');
  const [mode, setMode] = useState<'networth' | 'invested'>('networth');
  // Scenarios live ONLY here, in this page's memory: never saved, gone when you leave the page.
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useRef(1);
  const chartTheme = useChartTheme();

  useEffect(() => {
    if (settings) setBaselineMonths((cur) => cur ?? settings.incomeAvgMonths);
  }, [settings]);

  // Ask the server (read-only) whenever something changes, a moment after the last change.
  useEffect(() => {
    if (baselineMonths === null) return;
    let live = true;
    const t = setTimeout(() => {
      api<WhatIfResult>('POST', '/api/what-if/project', {
        baselineMonths,
        range,
        scenarios: drafts.map((d) => ({ name: d.name.trim() || 'Scenario', changes: d.changes })),
      })
        .then((r) => {
          if (!live) return;
          setResult(r);
          setError(null);
        })
        .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not work that out.'));
    }, 220);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [baselineMonths, range, drafts]);

  // Once the age is known, start on "until 40" if there is room (never overriding a pick).
  const pickedRange = useRef(false);
  useEffect(() => {
    if (!pickedRange.current && result?.age !== null && result?.age !== undefined && result.age < 40) {
      pickedRange.current = true;
      setRange('to40');
    }
  }, [result?.age]);

  const paths = useMemo(() => (result ? [result.current, ...result.scenarios] : []), [result]);
  const option = useMemo(() => (paths.length ? whatIfOption(paths, mode) : null), [paths, mode, chartTheme]);
  const catName = (id: number) => result?.categories.find((c) => c.id === id)?.name ?? 'Category';

  const update = (key: number, fn: (d: Draft) => Draft) => setDrafts((ds) => ds.map((d) => (d.key === key ? fn(d) : d)));
  const addScenario = () =>
    setDrafts((ds) => (ds.length >= MAX_SCENARIOS ? ds : [...ds, { key: nextKey.current++, name: `Scenario ${ds.length + 1}`, changes: [] }]));

  const age = result?.age ?? null;
  const rangeOptions: { value: WhatIfRange; label: string; disabled?: boolean; title?: string }[] = [
    { value: '1y', label: '1 year' },
    { value: '5y', label: '5 years' },
    { value: '10y', label: '10 years' },
    { value: 'to40', label: 'Until 40', disabled: age === null || age >= 40, title: age === null ? 'Set your birth month in Settings' : undefined },
    { value: 'to65', label: 'Until 65', disabled: age === null || age >= 65, title: age === null ? 'Set your birth month in Settings' : undefined },
  ];

  const b = result?.baseline;
  return (
    <div className="page whatif">
      <header className="page-head rise">
        <div>
          <div className="label">Plan ahead</div>
          <h1 className="page-title">What if</h1>
        </div>
        <span className="estimate-chip">Estimate, not financial advice</span>
      </header>

      {/* Assumptions: always visible next to the results. */}
      <section className="card assumptions rise" style={{ animationDelay: '30ms' }} aria-label="Assumptions">
        <div className="assume-item">
          <span className="label">Return after inflation</span>
          <b className="num">{result ? pct(result.defaultReturnRateBp) : '…'} a year</b>
          <Link to="/settings" className="assume-link">
            Change in Settings
          </Link>
        </div>
        <div className="assume-item">
          <span className="label">Based on your last</span>
          <Segmented
            ariaLabel="Baseline months"
            value={String(baselineMonths ?? 3)}
            onChange={(v) => setBaselineMonths(Number(v))}
            options={[
              { value: '3', label: '3 months' },
              { value: '6', label: '6 months' },
              { value: '12', label: '12 months' },
            ]}
          />
          {b && b.monthsUsed < b.monthsRequested && <span className="hint">Only {b.monthsUsed} full months of data so far.</span>}
        </div>
        <div className="assume-item">
          <span className="label">Each month now</span>
          <span className="num assume-flow">
            {b ? (
              <>
                {formatCents(b.incomeCents)} in · {formatCents(b.spendingCents)} spent · <b>{formatCents(b.savingsCents)}</b> saved
              </>
            ) : (
              '…'
            )}
          </span>
          {b && <span className="hint">{formatCents(b.toInvestedCents)} of it goes to investments, like the last few months. Cash earns nothing here.</span>}
        </div>
        <p className="assume-foot hint">
          <Info size={13} /> Every amount is in today's dollars. Income and spending stay where they are now; transfers and gifts never
          count as income or spending.
        </p>
      </section>

      {error && <p className="error-text">{error}</p>}

      <div className="whatif-top rise" style={{ animationDelay: '70ms' }}>
        {result && <FiCard result={result} />}
        <section className="card whatif-chart">
          <div className="card-head">
            <Segmented ariaLabel="Projection range" value={range} onChange={setRange} options={rangeOptions} />
            <Segmented
              ariaLabel="Chart shows"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'networth', label: 'Net worth' },
                { value: 'invested', label: 'Invested only' },
              ]}
            />
          </div>
          {option ? <Chart option={option} height={330} ariaLabel="Projected net worth, current path and scenarios" /> : <div style={{ height: 330 }} />}
          {mode === 'invested' && <p className="hint">The dashed lines are each path's FI number. Only invested money counts toward it.</p>}
        </section>
      </div>

      <div className="rise" style={{ animationDelay: '90ms' }}>
        <TimeMachine />
      </div>

      <section className="rise" style={{ animationDelay: '110ms' }}>
        <div className="group-title-row">
          <h2 className="group-title">
            <FlaskConical size={18} /> Scenarios
          </h2>
          <span className="hint">Up to {MAX_SCENARIOS}. Nothing here is saved; leaving the page clears them.</span>
        </div>
        <div className="scen-grid">
          {drafts.map((d, i) => (
            <ScenarioCard
              key={d.key}
              draft={d}
              metal={METALS[i]!}
              path={result?.scenarios[i] ?? null}
              categories={result?.categories ?? []}
              catName={catName}
              onRename={(name) => update(d.key, (x) => ({ ...x, name }))}
              onAdd={(c) => update(d.key, (x) => ({ ...x, changes: [...x.changes.filter((y) => c.kind === 'spending' || y.kind !== c.kind), c] }))}
              onRemoveChange={(j) => update(d.key, (x) => ({ ...x, changes: x.changes.filter((_, k) => k !== j) }))}
              onRemove={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
            />
          ))}
          {drafts.length < MAX_SCENARIOS && (
            <button className="card scen-add" onClick={addScenario}>
              <Plus size={20} />
              <span>Add a scenario</span>
              <small>Spend more or less in a category, change your Roth amount or the return rate.</small>
            </button>
          )}
        </div>
      </section>

      {result && <Results result={result} />}
    </div>
  );
}

function FiCard({ result }: { result: WhatIfResult }) {
  const c = result.current;
  const notReached = `Not reached by ${result.fiHorizon.label} on this path`;
  return (
    <section className="card fi-card" aria-label="FI number">
      <div className="label">
        <Telescope size={13} /> Your FI number
      </div>
      {c.fi.numberCents === null ? (
        <p className="muted">No spending recorded in these months, so there is nothing to cover yet.</p>
      ) : (
        <>
          <BigMoney cents={c.fi.numberCents} size="lg" />
          <p className="hint">
            25 × {formatCents(c.spendingCents * 12)} of spending a year. Invested money this big could cover your spending if you took out about 4% a
            year.
          </p>
        </>
      )}
      <div className="fi-paths">
        {[c, ...result.scenarios].map((p, i) => (
          <div key={i} className={`fi-path path-${i === 0 ? 'platinum' : METALS[i - 1]}`}>
            <span className="fi-dot" aria-hidden />
            <span className="fi-name">{p.name}</span>
            <b className="num">{p.fi.month === null ? '' : p.fi.month === 0 ? 'Already there' : yearsMonths(p.fi.month)}</b>
            <span className="fi-when">{p.fi.numberCents === null ? 'No spending to cover' : reachText(p.fi, notReached)}</span>
          </div>
        ))}
      </div>
      <p className="hint fi-caveat">
        25× is a rule of thumb for retirements of about 30 years. Retiring around 40 means 50 or more years, so many planners aim higher.
      </p>
    </section>
  );
}

function ScenarioCard({
  draft,
  metal,
  path,
  categories,
  catName,
  onRename,
  onAdd,
  onRemoveChange,
  onRemove,
}: {
  draft: Draft;
  metal: (typeof METALS)[number];
  path: WhatIfPath | null;
  categories: WhatIfResult['categories'];
  catName: (id: number) => string;
  onRename: (name: string) => void;
  onAdd: (c: WhatIfChange) => void;
  onRemoveChange: (i: number) => void;
  onRemove: () => void;
}) {
  return (
    <article className={`card scen-card scen-${metal}`} aria-label={`Scenario ${draft.name}`}>
      <div className="scen-head">
        <span className="scen-dot" aria-hidden />
        <input className="scen-name" aria-label="Scenario name" maxLength={40} value={draft.name} onChange={(e) => onRename(e.target.value)} />
        <button className="btn btn-ghost icon-btn danger" aria-label={`Remove ${draft.name}`} onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </div>
      {draft.changes.length === 0 ? (
        <p className="hint">No changes yet: this is the same as your current path.</p>
      ) : (
        <ul className="scen-changes">
          {draft.changes.map((c, i) => (
            <li key={i}>
              <span className="num">{describeChange(c, catName)}</span>
              <button className="icon-btn btn-ghost btn" aria-label={`Remove change ${describeChange(c, catName)}`} onClick={() => onRemoveChange(i)}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {draft.changes.length < MAX_CHANGES && <ChangeForm categories={categories} onAdd={onAdd} />}
      {path && (
        <div className="scen-summary">
          <span>
            Saves <b className="num">{formatCents(path.savingsCents)}</b>/mo
          </span>
          <span>
            Rate <b className="num">{path.savingsRateBp === null ? 'n/a' : formatBasisPoints(path.savingsRateBp, { sign: false })}</b>
            {path.savingsRateChangeBp ? <em className={path.savingsRateChangeBp > 0 ? 'up' : 'down'}> {formatBasisPoints(path.savingsRateChangeBp)}</em> : null}
          </span>
        </div>
      )}
      {path?.notes.map((n) => (
        <p key={n} className="hint scen-note">
          <Info size={12} /> {n}
        </p>
      ))}
    </article>
  );
}

function ChangeForm({ categories, onAdd }: { categories: WhatIfResult['categories']; onAdd: (c: WhatIfChange) => void }) {
  const [kind, setKind] = useState<'spending' | 'roth' | 'return'>('spending');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [direction, setDirection] = useState<'down' | 'up'>('down');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const spendCats = categories;
  const cat = categoryId ?? spendCats[0]?.id ?? null;

  function add(e: FormEvent) {
    e.preventDefault();
    if (kind === 'return') {
      if (!rate.trim()) return;
      onAdd({ kind: 'return', rate: rate.trim().replace(/%$/, '') });
      setRate('');
      return;
    }
    if (!amount.trim()) return;
    if (kind === 'roth') onAdd({ kind: 'roth', monthly: amount.trim() });
    else if (cat !== null) onAdd({ kind: 'spending', categoryId: cat, direction, amount: amount.trim() });
    setAmount('');
  }

  const avg = categories.find((c) => c.id === cat)?.avgCents ?? 0;
  return (
    <form className="change-form" onSubmit={add} aria-label="Add a change">
      <select className="input" aria-label="Kind of change" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
        <option value="spending">Spending in a category</option>
        <option value="roth">Roth IRA each month</option>
        <option value="return">Return rate</option>
      </select>
      {kind === 'spending' && (
        <>
          <select className="input" aria-label="Category" value={cat ?? ''} onChange={(e) => setCategoryId(Number(e.target.value))}>
            {spendCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (now {formatCents(c.avgCents)}/mo)
              </option>
            ))}
          </select>
          <div className="change-row">
            <Segmented
              ariaLabel="Spend less or more"
              value={direction}
              onChange={setDirection}
              options={[
                { value: 'down', label: 'Less' },
                { value: 'up', label: 'More' },
              ]}
            />
            <MoneyInput value={amount} onChange={setAmount} ariaLabel="Amount per month" />
          </div>
          {direction === 'down' && avg > 0 && <span className="hint">Down to $0 at most ({formatCents(avg)} a month now).</span>}
        </>
      )}
      {kind === 'roth' && (
        <>
          <MoneyInput value={amount} onChange={setAmount} ariaLabel="Roth amount per month" />
          <span className="hint">Replaces what you put in now. Stops at each year's limit.</span>
        </>
      )}
      {kind === 'return' && (
        <span className="input-suffix">
          <input className="input" inputMode="decimal" aria-label="Return rate for this scenario" placeholder="e.g. 5" value={rate} onChange={(e) => setRate(e.target.value)} />
          <span className="suffix">%</span>
        </span>
      )}
      <button className="btn btn-sm">
        <Plus size={14} /> Add change
      </button>
    </form>
  );
}

function Results({ result }: { result: WhatIfResult }) {
  const paths = [result.current, ...result.scenarios];
  const c = result.current;
  const notReached = `Not by ${result.fiHorizon.label}`;
  const when = { '1y': 'in 1 year', '5y': 'in 5 years', '10y': 'in 10 years', to40: 'at age 40', to65: 'at age 65' }[result.range];
  const metalOf = (i: number) => (i === 0 ? 'platinum' : METALS[i - 1]);
  const money = (cents: number, i: number, base: number) => (
    <>
      <b className="num">{formatCents(cents)}</b>
      {i > 0 && cents !== base && <em className={`num ${cents > base ? 'up' : 'down'}`}>{formatCents(cents - base, { sign: true })}</em>}
    </>
  );
  const reach = (r: WhatIfReach, cr: WhatIfReach, i: number, none: string) => {
    const sh = i > 0 ? shift(r, cr) : null;
    return (
      <>
        <b>{reachText(r, none)}</b>
        {sh && sh.tone !== 'same' && <em className={sh.tone === 'good' ? 'up' : 'down'}>{sh.text}</em>}
      </>
    );
  };
  const rows: { label: string; cell: (p: WhatIfPath, i: number) => ReactNode }[] = [
    { label: `Net worth ${when}`, cell: (p, i) => money(p.end.netWorthCents, i, c.end.netWorthCents) },
    { label: 'Invested by then', cell: (p, i) => money(p.end.investedCents, i, c.end.investedCents) },
    {
      label: 'Savings rate',
      cell: (p) => (
        <>
          <b className="num">{p.savingsRateBp === null ? 'No income' : formatBasisPoints(p.savingsRateBp, { sign: false })}</b>
          {p.savingsRateChangeBp ? <em className={`num ${p.savingsRateChangeBp > 0 ? 'up' : 'down'}`}>{formatBasisPoints(p.savingsRateChangeBp)}</em> : null}
        </>
      ),
    },
    { label: 'To investments each month', cell: (p) => <b className="num">{formatCents(p.investedMonthlyCents)}</b> },
    { label: 'Return after inflation', cell: (p) => <b className="num">{pct(p.returnRateBp)}</b> },
    { label: 'FI number', cell: (p) => <b className="num">{p.fi.numberCents === null ? 'n/a' : formatCents(p.fi.numberCents)}</b> },
    { label: 'Reaches FI', cell: (p, i) => reach(p.fi, c.fi, i, `Not by ${result.fiHorizon.label}`) },
  ];
  if (c.goals.roth) {
    rows.push({
      label: `Roth ${c.goals.roth.year} limit (${formatCents(c.goals.roth.limitCents)})`,
      cell: (p, i) => (
        <>
          <span className="cell-sub num">{formatCents(p.goals.roth!.monthlyCents)}/mo</span>
          {reach(p.goals.roth!, c.goals.roth!, i, 'Not before the deadline')}
        </>
      ),
    });
  }
  if (c.goals.emergency) {
    rows.push({
      label: 'Emergency fund',
      cell: (p, i) => (
        <>
          <span className="cell-sub num">{formatCents(p.goals.emergency!.targetCents)}</span>
          {reach(p.goals.emergency!, c.goals.emergency!, i, notReached)}
        </>
      ),
    });
  }
  c.goals.custom.forEach((g, gi) => {
    rows.push({
      label: `${g.name} (${formatCents(g.targetCents)})`,
      cell: (p, i) => reach(p.goals.custom[gi]!, g, i, g.accountName ? notReached : 'No account linked'),
    });
  });

  return (
    <section className="card whatif-results rise" style={{ animationDelay: '150ms' }} aria-label="Results">
      <div className="table-scroll">
        <table className="table results-table">
          <thead>
            <tr>
              <th />
              {paths.map((p, i) => (
                <th key={i} className={`path-${metalOf(i)}`}>
                  <span className="fi-dot" aria-hidden /> {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {paths.map((p, i) => (
                  <td key={i}>
                    <div className="result-cell">{r.cell(p, i)}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Goal dates follow each goal's account at its recent pace (plus growth if it is invested). Dates are the end of the month they are reached
        in. Roth amounts in later years stop at {result.rothRules.laterLimitCents ? formatCents(result.rothRules.laterLimitCents) : 'no limit'} a year (your newest saved limit).
      </p>
    </section>
  );
}
