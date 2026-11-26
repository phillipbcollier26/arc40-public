import { useEffect, useState, type FormEvent } from 'react';
import { Coins, Pencil, Trash2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useWorkCost } from '../lib/workCost';
import { formatCents } from '../lib/format';
import { MoneyInput } from './AccountForm';
import { Segmented } from './Controls';
import { WorkCoins } from './WorkCost';
import { MAX_JOBS, hourlyCents, type WorkJob } from '../../../shared/workCost';

const plain = (cents: number) => formatCents(cents).slice(1);

/**
 * Settings: "Work cost". Pay per game, any number of other jobs (hourly or a yearly salary) and one picker that
 * is both the on/off switch and the choice of pay. All pay is before taxes. Personal: stays in this database.
 */
export function WorkCostCard() {
  const { state, reload } = useWorkCost();
  const [pay, setPay] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<WorkJob | null>(null);

  useEffect(() => {
    if (state) setPay(state.refPayPerGameCents ? plain(state.refPayPerGameCents) : '');
  }, [state?.refPayPerGameCents]);

  if (!state) return <section className="card" />;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not save.' });
    }
  };

  async function savePay(e: FormEvent) {
    e.preventDefault();
    await run(() => api('PUT', '/api/work-cost', { refPayPerGame: pay.trim() ? pay : null }), pay.trim() ? 'Pay per game saved.' : 'Pay per game cleared.');
  }

  return (
    <section className="card rise stack work-settings" style={{ animationDelay: '50ms' }} aria-label="Work cost">
      <h3 className="icon-title">
        <Coins size={18} /> Work cost
      </h3>
      <p className="muted">See what your spending costs in refereeing games or hours of another job. All pay is before taxes.</p>

      <label className="field">
        <span className="label">Show spending in</span>
        <select
          className="input"
          aria-label="Show spending in"
          value={state.active ? state.selection : 'off'}
          onChange={(e) => run(() => api('PUT', '/api/work-cost', { selection: e.target.value }), e.target.value === 'off' ? 'Work cost is off.' : 'Saved.')}
        >
          <option value="off">Off</option>
          <option value="ref" disabled={!state.refPayPerGameCents}>
            Refereeing games{state.refPayPerGameCents ? '' : ' (set your pay per game first)'}
          </option>
          {state.jobs.map((j) => (
            <option key={j.id} value={`job:${j.id}`}>
              Hours as {j.title}
            </option>
          ))}
        </select>
      </label>
      {state.active && (
        <p className="hint work-legend">
          <WorkCoins tenths={35} rate={state.active} /> 3.5 {state.active.unit === 'game' ? 'games' : 'hours'}: one coin per{' '}
          {state.active.unit === 'game' ? 'game' : 'hour'}, the last one partly filled.
        </p>
      )}

      <form className="form-row work-pay" onSubmit={savePay}>
        <label className="field">
          <span className="label">Pay per refereeing game</span>
          <MoneyInput value={pay} onChange={setPay} ariaLabel="Pay per game" />
        </label>
        <button className="btn">Save</button>
      </form>
      {!state.refPayPerGameCents && <p className="hint">Set your pay per game to see costs in games. Every game counts as one hour.</p>}

      <div className="stack work-jobs">
        <span className="label">Other jobs</span>
        {state.jobs.length === 0 && <p className="hint">No jobs yet. Add one with an hourly pay or a yearly salary.</p>}
        {state.jobs.map((j) => (
          <div key={j.id} className="work-job">
            <div className="work-job-text">
              <b>{j.title}</b>
              <span className="num">
                {j.payKind === 'hourly' ? `${formatCents(j.payCents)}/hour` : `${formatCents(j.payCents)}/year, about ${formatCents(hourlyCents(j))}/hour`}
              </span>
            </div>
            <button className="btn btn-ghost icon-btn" aria-label={`Edit ${j.title}`} onClick={() => setEditing(j)}>
              <Pencil size={14} />
            </button>
            <button
              className="btn btn-ghost icon-btn danger"
              aria-label={`Delete ${j.title}`}
              onClick={() => run(() => api('DELETE', `/api/work-jobs/${j.id}`), `${j.title} deleted.`)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <JobForm
          key={editing?.id ?? 'new'}
          job={editing}
          full={state.jobs.length >= MAX_JOBS}
          onDone={(text) => (setEditing(null), setMsg({ ok: true, text }), reload())}
          onCancel={() => setEditing(null)}
          onError={(text) => setMsg({ ok: false, text })}
        />
        <p className="hint">A yearly salary is turned into hours as salary ÷ 2,080 (40 hours a week, 52 weeks).</p>
      </div>
      {msg && <p className={msg.ok ? 'ok-text' : 'error-text'}>{msg.text}</p>}
    </section>
  );
}

function JobForm({
  job,
  full,
  onDone,
  onCancel,
  onError,
}: {
  job: WorkJob | null;
  full: boolean;
  onDone: (msg: string) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [title, setTitle] = useState(job?.title ?? '');
  const [kind, setKind] = useState<'hourly' | 'salary'>(job?.payKind ?? 'hourly');
  const [pay, setPay] = useState(job ? plain(job.payCents) : '');

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      const body = { title, payKind: kind, pay };
      if (job) await api('PATCH', `/api/work-jobs/${job.id}`, body);
      else await api('POST', '/api/work-jobs', body);
      onDone(job ? `${title.trim()} saved.` : `${title.trim()} added.`);
      if (!job) {
        setTitle('');
        setPay('');
      }
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not save the job.');
    }
  }

  if (full && !job) return <p className="hint">Arc40 keeps up to {MAX_JOBS} jobs.</p>;
  return (
    <form className="work-job-form" onSubmit={save} aria-label={job ? `Edit ${job.title}` : 'Add a job'}>
      <input className="input" aria-label="Job title" placeholder="Job title" maxLength={40} value={title} onChange={(e) => setTitle(e.target.value)} />
      <Segmented
        value={kind}
        onChange={setKind}
        ariaLabel="Pay type"
        options={[
          { value: 'hourly', label: 'Hourly' },
          { value: 'salary', label: 'Yearly' },
        ]}
      />
      <MoneyInput value={pay} onChange={setPay} ariaLabel={kind === 'hourly' ? 'Pay per hour' : 'Pay per year'} />
      <div className="work-job-actions">
        <button className="btn" disabled={!title.trim() || !pay.trim()}>
          {job ? 'Save job' : 'Add job'}
        </button>
        {job && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
