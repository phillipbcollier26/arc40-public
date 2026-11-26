import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowLeft, Trash2 } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { api, ApiError } from '../lib/api';
import type { AccountDetail } from '../lib/types';
import { Chart } from '../components/Chart';
import { BigMoney, ChangePill } from '../components/Money';
import { MoneyInput } from '../components/AccountForm';
import { balanceOption } from '../lib/charts';
import { PriceStateLegend } from '../components/PriceHistoryImport';
import { formatCents, formatDate, todayIso } from '../lib/format';
import { ACCOUNT_TYPES } from '../../../shared/accounts';
import { useChartTheme } from '../lib/themeMode';

export function AccountDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, reload } = useApi<AccountDetail>(`/api/accounts/${id}`);

  const [asOf, setAsOf] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const chronological = useMemo(() => [...(data?.snapshots ?? [])].reverse(), [data]);
  const chartTheme = useChartTheme();
  // Investment accounts show the history rebuilt from fund prices (with estimated/stale days shaded).
  const points = useMemo(
    () =>
      data?.history?.length
        ? data.history.map((p) => ({ date: p.date, cents: p.cents, priceState: p.state, staleDays: p.staleDays }))
        : chronological.map((s) => ({ date: s.asOf, cents: s.balanceCents })),
    [chronological, data],
  );
  const option = useMemo(
    () => (points.length > 1 ? balanceOption(points, data && ACCOUNT_TYPES[data.account.type].isInvestment ? '--gold' : '--silver') : null),
    [points, data, chartTheme],
  );

  if (error) {
    return (
      <div className="page">
        <Link to="/accounts" className="back-link">
          <ArrowLeft size={16} /> Accounts
        </Link>
        <div className="card empty">
          <h3>{error}</h3>
        </div>
      </div>
    );
  }
  if (!data) return <div className="page" />;

  const { account, snapshots } = data;
  const latest = snapshots[0];
  const previous = snapshots[1];

  async function addBalance(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api('POST', `/api/accounts/${account.id}/balances`, { asOf, balance: amount });
      setAmount('');
      setMsg({ ok: true, text: `Saved ${formatDate(asOf)}.` });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not save.' });
    }
  }

  async function removeSnapshot(snapId: number) {
    await api('DELETE', `/api/balances/${snapId}`);
    reload();
  }

  async function toggleArchive() {
    await api('PATCH', `/api/accounts/${account.id}`, { archived: !account.archived });
    reload();
  }

  async function remove() {
    if (
      !window.confirm(
        `Delete "${account.name}"? This also deletes all of its transactions, imports and balance history. A backup is saved first (Settings shows your backups).`,
      )
    )
      return;
    await api('DELETE', `/api/accounts/${account.id}`);
    navigate('/accounts');
  }

  return (
    <div className="page">
      <Link to="/accounts" className="back-link rise">
        <ArrowLeft size={16} /> Accounts
      </Link>

      <section className="hero card rise" style={{ animationDelay: '40ms' }}>
        <div className="hero-main">
          <div className="label">
            {account.typeLabel}
            {account.institution && ` · ${account.institution}`}
            {account.archived && ' · Archived'}
          </div>
          <h1 className="detail-title">{account.name}</h1>
          {latest ? <BigMoney cents={latest.balanceCents} size="lg" /> : <div className="muted">No balance recorded yet.</div>}
          {latest && (
            <div className="hero-change">
              {previous && <ChangePill cents={latest.balanceCents - previous.balanceCents} />}
              <span className="muted-inline">
                as of {formatDate(latest.asOf)}
                {previous && ` vs ${formatDate(previous.asOf, { year: false })}`}
              </span>
            </div>
          )}
        </div>
        <div className="detail-actions">
          <button className="btn btn-ghost" onClick={() => setEditing((v) => !v)}>
            Edit
          </button>
          <button className="btn btn-ghost" onClick={toggleArchive}>
            {account.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            {account.archived ? 'Unarchive' : 'Archive'}
          </button>
          <button className="btn btn-ghost danger" onClick={remove}>
            <Trash2 size={16} /> Delete
          </button>
        </div>
      </section>

      {editing && <EditAccount detail={data} onSaved={() => (setEditing(false), reload())} />}

      <div className="grid-detail rise" style={{ animationDelay: '100ms' }}>
        <section className="card">
          <div className="label">Balance history</div>
          {option ? (
            <>
              <Chart option={option} height={300} ariaLabel={`${account.name} balance history`} />
              <PriceStateLegend states={(data?.history ?? []).map((p) => p.state)} />
            </>
          ) : (
            <p className="muted" style={{ padding: '40px 0' }}>
              Add at least two balances on different dates to see a chart.
            </p>
          )}
        </section>

        <form className="card stack" onSubmit={addBalance}>
          <div className="label">Update balance</div>
          <p className="hint">Enter the balance shown by your bank. Use a past date to fill in history; the same date replaces the old entry.</p>
          <MoneyInput value={amount} onChange={setAmount} ariaLabel="Balance" />
          <input className="input" type="date" aria-label="Balance date" value={asOf} max={todayIso()} onChange={(e) => setAsOf(e.target.value)} />
          {msg && <p className={msg.ok ? 'ok-text' : 'error-text'}>{msg.text}</p>}
          <button className="btn btn-primary" disabled={!amount.trim()}>
            Save balance
          </button>
        </form>
      </div>

      <section className="card rise" style={{ animationDelay: '160ms' }}>
        <div className="label" style={{ marginBottom: 10 }}>
          History ({snapshots.length})
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num-col">Balance</th>
              <th className="num-col">Change</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(showAll ? snapshots : snapshots.slice(0, 12)).map((s, i) => {
              const prev = snapshots[i + 1];
              const diff = prev ? s.balanceCents - prev.balanceCents : null;
              return (
                <tr key={s.id}>
                  <td>{formatDate(s.asOf)}</td>
                  <td className="num-col num">{formatCents(s.balanceCents)}</td>
                  <td className={`num-col ${diff === null ? '' : diff >= 0 ? 'pos' : 'neg'}`}>
                    {diff === null ? '' : formatCents(diff, { sign: true })}
                  </td>
                  <td className="row-actions">
                    <button className="btn btn-ghost icon-btn" aria-label={`Delete balance on ${formatDate(s.asOf)}`} onClick={() => removeSnapshot(s.id)}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {snapshots.length > 12 && (
          <button className="btn btn-ghost show-more" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `Show all ${snapshots.length}`}
          </button>
        )}
      </section>
    </div>
  );
}

function EditAccount({ detail, onSaved }: { detail: AccountDetail; onSaved: () => void }) {
  const [name, setName] = useState(detail.account.name);
  const [institution, setInstitution] = useState(detail.account.institution);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api('PATCH', `/api/accounts/${detail.account.id}`, { name, institution });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    }
  }

  return (
    <form className="card form-row rise" onSubmit={save}>
      <label className="field">
        <span className="label">Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Bank or broker</span>
        <input className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} />
      </label>
      <div className="field" style={{ alignSelf: 'end' }}>
        <button className="btn btn-primary">Save</button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}
