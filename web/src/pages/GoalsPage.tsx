import { useState, type FormEvent } from 'react';
import { Pencil, Plus, ShieldCheck, Target, Trash2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import type { AccountSummary, Goals } from '../lib/types';
import { Modal } from '../components/Modal';
import { Segmented } from '../components/Controls';
import { MoneyInput } from '../components/AccountForm';
import { formatCents, formatDate } from '../lib/format';
import { Ring } from '../components/Ring';
import { RothPacePanel } from '../components/RothPace';

const pctOf = (cur: number, target: number) => (target > 0 ? Math.floor((cur * 100) / target) : 0);

export function GoalsPage() {
  const [year, setYear] = useState<number | null>(null);
  const { data: g, reload } = useApi<Goals>(`/api/goals${year ? `?year=${year}` : ''}`);
  const { data: acc } = useApi<{ accounts: AccountSummary[] }>('/api/accounts');
  const [editLimit, setEditLimit] = useState(false);
  const [adding, setAdding] = useState(false);
  const [essentials, setEssentials] = useState<string | null>(null);

  if (!g) return <div className="page" />;
  const r = g.roth;
  const e = g.emergency;

  async function saveEssentials(ev: FormEvent) {
    ev.preventDefault();
    await api('PUT', '/api/settings/emergency', { essentials: essentials ?? '' });
    setEssentials(null);
    reload();
  }

  return (
    <div className="page">
      <header className="page-head rise">
        <div>
          <div className="label">Plan ahead</div>
          <h1 className="page-title">Goals</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Plus size={16} /> New goal
        </button>
      </header>

      <div className="grid-goals-top rise" style={{ animationDelay: '60ms' }}>
        <section className={`card goal-hero${r.pace ? ' roth-hero' : ''}`}>
          <div className="card-head">
            <div className="label">
              <Target size={13} /> Max out the Roth IRA
            </div>
            {r.years.length > 1 && (
              <Segmented value={String(r.year)} onChange={(v) => setYear(Number(v))} options={r.years.map((y) => ({ value: String(y), label: `${y} tax year` }))} />
            )}
          </div>
          {r.limitCents === null ? (
            <div className="stack">
              <p className="muted">No IRA limit is saved for {r.year}. Look it up on irs.gov and enter it here.</p>
              <div>
                <button className="btn" onClick={() => setEditLimit(true)}>
                  Enter the {r.year} limit
                </button>
              </div>
            </div>
          ) : (
            <div className="roth-layout">
              <div className="goal-hero-body">
                <Ring pct={pctOf(r.contributedCents, r.limitCents)}>
                  <span className="rate-num num">{pctOf(r.contributedCents, r.limitCents)}%</span>
                  <span className="label">of {formatCents(r.limitCents)}</span>
                </Ring>
                <div className="goal-facts">
                  <div className="mini-stat tone-gold">
                    <span>Contributed for {r.year}</span>
                    <b className="num">{formatCents(r.contributedCents)}</b>
                  </div>
                  <div className="mini-stat tone-silver">
                    <span>Room left</span>
                    <b className="num">{formatCents(r.remainingCents ?? 0)}</b>
                  </div>
                  <div className="mini-stat tone-sage">
                    <span>Earned income in {r.year}</span>
                    <b className="num">{formatCents(r.earnedIncomeCents)}</b>
                  </div>
                  {r.deadline && <p className="hint">Contributions for {r.year} can be made until {formatDate(r.deadline)}.</p>}
                  {r.earnedIncomeCents < r.limitCents && !r.pace && (
                    <p className="hint">
                      IRS rule: you can only contribute up to your taxable compensation for the year (or the limit, whichever is lower). Earned
                      income here is your Refereeing and Other Income; interest and gifts do not count.
                    </p>
                  )}
                  <button className="btn btn-ghost" onClick={() => setEditLimit(true)}>
                    <Pencil size={14} /> Edit {r.year} limit
                  </button>
                </div>
              </div>
              {r.pace ? (
                <RothPacePanel pace={r.pace} year={r.year} today={g.today} />
              ) : (
                r.hasRothAccount &&
                !r.deadline && <p className="hint">Add the {r.year} deadline from irs.gov (Edit {r.year} limit) to see your pace.</p>
              )}
            </div>
          )}
          {!r.hasRothAccount && <p className="hint">Add a Roth IRA account to track contributions.</p>}
        </section>

        <section className="card goal-hero">
          <div className="label">
            <ShieldCheck size={13} /> Emergency fund check
          </div>
          {e.targetCents === null ? (
            <p className="muted">Import a few months of spending to see this.</p>
          ) : (
            <div className="goal-hero-body">
              <Ring pct={pctOf(e.savingsCents, e.targetCents)}>
                <span className="rate-num num">{Math.min(999, pctOf(e.savingsCents, e.targetCents))}%</span>
                <span className="label">covered</span>
              </Ring>
              <div className="goal-facts">
                <div className="mini-stat tone-gold">
                  <span>6 months of expenses</span>
                  <b className="num">{formatCents(e.targetCents)}</b>
                </div>
                <div className="mini-stat tone-silver">
                  <span>In savings accounts</span>
                  <b className="num">{formatCents(e.savingsCents)}</b>
                </div>
                <p className="hint">
                  Average spending {formatCents(e.avgMonthlySpendingCents ?? 0)}/mo over {e.monthsUsed} full month{e.monthsUsed === 1 ? '' : 's'}
                  {e.essentialsCents > 0 && ` + ${formatCents(e.essentialsCents)}/mo essentials`}. Info only, not a tracked goal yet.
                </p>
                {essentials === null ? (
                  <button className="btn btn-ghost" onClick={() => setEssentials(e.essentialsCents ? formatCents(e.essentialsCents).slice(1) : '')}>
                    <Pencil size={14} /> {e.essentialsCents ? 'Change' : 'Add'} costs someone else covers
                  </button>
                ) : (
                  <form className="inline-form" onSubmit={saveEssentials}>
                    <MoneyInput value={essentials} onChange={setEssentials} ariaLabel="Monthly essentials" />
                    <button className="btn">Save</button>
                  </form>
                )}
                <p className="hint">If someone else pays for things like housing or food, add what they would cost per month to see a realistic target.</p>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="rise" style={{ animationDelay: '120ms' }}>
        <h2 className="group-title">
          <Target size={18} /> Your goals
        </h2>
        {g.custom.length === 0 ? (
          <div className="card empty">
            <p className="muted">Add a goal like a long-term land fund, pick the account that holds the money, and watch it fill up.</p>
          </div>
        ) : (
          <div className="acct-grid">
            {g.custom.map((c) => (
              <div key={c.id} className="card goal-card">
                <div className="acct-card-top">
                  <div>
                    <div className="acct-name">{c.name}</div>
                    <div className="acct-inst">{c.accountName ?? 'No account linked'}</div>
                  </div>
                  <button className="btn btn-ghost icon-btn danger" aria-label={`Delete ${c.name}`} onClick={async () => (await api('DELETE', `/api/goals/${c.id}`), reload())}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="goal-amounts num">
                  {formatCents(c.currentCents)} <small>of {formatCents(c.targetCents)}</small>
                </div>
                <div className="budget-bar">
                  <span style={{ width: `${Math.min(100, pctOf(c.currentCents, c.targetCents))}%` }} />
                </div>
                <div className="budget-left">{pctOf(c.currentCents, c.targetCents)}% there</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {editLimit && (
        <Modal title={`${r.year} IRA limit`} onClose={() => setEditLimit(false)}>
          <LimitForm year={r.year} current={r.limitCents} deadline={r.deadline} onDone={() => (setEditLimit(false), reload())} />
        </Modal>
      )}
      {adding && (
        <Modal title="New goal" onClose={() => setAdding(false)}>
          <GoalForm accounts={acc?.accounts ?? []} onDone={() => (setAdding(false), reload())} />
        </Modal>
      )}
    </div>
  );
}

function LimitForm({ year, current, deadline, onDone }: { year: number; current: number | null; deadline: string | null; onDone: () => void }) {
  const [limit, setLimit] = useState(current ? formatCents(current).slice(1) : '');
  const [dl, setDl] = useState(deadline ?? '');
  const [error, setError] = useState<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api('PUT', '/api/settings/ira', { year, limit, deadline: dl || null });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    }
  }
  return (
    <form className="stack" onSubmit={save}>
      <p className="hint">Use the official number from irs.gov. The 2026 limit ($7,500 under age 50) comes from the IRS announcement for 2026.</p>
      <label className="field">
        <span className="label">Limit</span>
        <MoneyInput value={limit} onChange={setLimit} ariaLabel="IRA limit" autoFocus />
      </label>
      <label className="field">
        <span className="label">Deadline (optional)</span>
        <input className="input" type="date" aria-label="Contribution deadline" value={dl} onChange={(e) => setDl(e.target.value)} />
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={!limit.trim()}>
          Save
        </button>
      </div>
    </form>
  );
}

function GoalForm({ accounts, onDone }: { accounts: AccountSummary[]; onDone: () => void }) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [accountId, setAccountId] = useState<number | null>(accounts[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api('POST', '/api/goals', { name, target, accountId });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    }
  }
  return (
    <form className="stack" onSubmit={save}>
      <label className="field">
        <span className="label">Goal name</span>
        <input className="input" aria-label="Goal name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Land fund" />
      </label>
      <label className="field">
        <span className="label">Target</span>
        <MoneyInput value={target} onChange={setTarget} ariaLabel="Goal target" />
      </label>
      <label className="field">
        <span className="label">Money is kept in</span>
        <select className="input" aria-label="Goal account" value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">No account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">Progress is that account's balance.</p>
      {error && <p className="error-text">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={!name.trim() || !target.trim()}>
          Add goal
        </button>
      </div>
    </form>
  );
}
