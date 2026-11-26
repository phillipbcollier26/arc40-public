import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, History, Info, Pencil, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import type { Holding, Investments, PriceSource } from '../lib/types';
import { Modal } from '../components/Modal';
import { PositionsImport } from '../components/PositionsImport';
import { PriceHistoryImport, PriceStateLegend } from '../components/PriceHistoryImport';
import { Chart } from '../components/Chart';
import { Segmented } from '../components/Controls';
import { BigMoney, ChangePill } from '../components/Money';
import { growthOption, mixDonutOption } from '../lib/charts';
import { formatCents, formatDate, formatPriceE4, formatShares, priceE4ToInput } from '../lib/format';

const SOURCE_LABEL: Record<PriceSource, string> = {
  history: 'price history file',
  positions: 'positions file',
  trade: 'Fidelity purchase',
  manual: 'typed in',
};

/** Price, its date and source, and a small "Edit price" for emergencies (e.g. a fund missing from the file). */
function PriceCell({ h, onSaved }: { h: Holding; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api('PUT', '/api/prices', { prices: [{ symbol: h.symbol, price: value }] });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    }
  }
  async function remove() {
    await api('DELETE', `/api/prices/${h.symbol}/${h.priceDate}`);
    onSaved();
  }
  if (editing) {
    return (
      <div className="price-edit">
        <div className="money-input price-input">
          <span>$</span>
          <input className="input input-sm" inputMode="decimal" aria-label={`Price of ${h.symbol}`} value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))} />
        </div>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={!value.trim()}>
          Save
        </button>
        <button className="btn btn-ghost icon-btn" onClick={() => setEditing(false)} aria-label="Cancel price edit">
          <X size={14} />
        </button>
        {error && <div className="error-text">{error}</div>}
      </div>
    );
  }
  return (
    <>
      <span className="num">{h.priceE4 === null ? 'no price yet' : formatPriceE4(h.priceE4)}</span>
      <div className="tx-sub">
        {h.priceDate && `${formatDate(h.priceDate, { year: false })} · ${SOURCE_LABEL[h.priceSource ?? 'manual']}`}
        {h.priceState === 'stale' && <span className="state-chip chip-stale">stale · {h.priceAgeDays} days old</span>}
        {h.priceState === 'estimated' && <span className="state-chip chip-estimated">estimated</span>}
        <button
          className="link-quiet price-edit-btn"
          onClick={() => {
            setValue(h.priceE4 ? priceE4ToInput(h.priceE4) : '');
            setEditing(true);
          }}
          aria-label={`Edit price of ${h.symbol}`}
          title="For emergencies, like a fund missing from your file. A price from a file for the same day still wins."
        >
          <Pencil size={11} /> Edit price
        </button>
        {h.priceIsManual && (
          <button className="link-quiet price-edit-btn" onClick={remove} aria-label={`Remove typed price of ${h.symbol}`}>
            Remove
          </button>
        )}
      </div>
    </>
  );
}
import { useChartTheme } from '../lib/themeMode';

const KIND_LABEL: Record<string, string> = {
  contribution: 'Contribution',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  buy: 'Bought',
  sell: 'Sold',
  reinvest: 'Reinvested',
  dividend: 'Dividend',
  interest: 'Interest',
  fee: 'Fee',
  other: 'Adjustment',
};

export function InvestmentsPage() {
  const [selected, setSelected] = useState<string>('all');
  const { data: inv, reload } = useApi<Investments>(`/api/investments${selected === 'all' ? '' : `?accountId=${selected}`}`);
  const [importing, setImporting] = useState(false);
  const [historyFor, setHistoryFor] = useState<Holding | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [allActivity, setAllActivity] = useState(false);

  const chartTheme = useChartTheme();
  const chartOption = useMemo(() => (inv && inv.series.length > 1 ? growthOption(inv.series) : null), [inv, chartTheme]);
  const donutOption = useMemo(() => {
    const rows = (inv?.holdings ?? []).filter((h) => h.valueCents && h.valueCents > 0).map((h) => ({ name: h.symbol, cents: h.valueCents! }));
    return rows.length ? mixDonutOption(rows, 'HOLDINGS') : null;
  }, [inv, chartTheme]);

  async function removeHistory(symbol: string) {
    try {
      const r = await api<{ removed: number }>('DELETE', `/api/investments/price-history/${symbol}`);
      setMsg({ ok: true, text: `Removed ${r.removed} prices from ${symbol}'s history.` });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not remove.' });
    }
  }

  async function useHoldings(id: number) {
    try {
      await api('POST', `/api/investments/${id}/use-holdings-value`);
      setMsg({ ok: true, text: "Recorded today's balance from your holdings." });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not update.' });
    }
  }

  if (inv && inv.accounts.length === 0) {
    return (
      <div className="page">
        <header className="page-head rise">
          <div>
            <div className="label">Invest</div>
            <h1 className="page-title">Investments</h1>
          </div>
        </header>
        <div className="card empty">
          <h3>No investment accounts yet</h3>
          <p className="muted">Add your Roth IRA and brokerage on the Accounts page, then import their Fidelity history.</p>
          <Link to="/accounts?add=1" className="btn btn-primary" style={{ marginTop: 14 }}>
            Add account
          </Link>
        </div>
      </div>
    );
  }

  const t = inv?.totals;
  const holdingsTotal = (inv?.holdings ?? []).reduce((s, h) => s + (h.valueCents ?? 0), 0);
  const accName = (id: number) => inv?.accounts.find((a) => a.id === id)?.name ?? '';

  return (
    <div className="page">
      <header className="page-head rise">
        <div>
          <div className="label">Invest</div>
          <h1 className="page-title">Investments</h1>
        </div>
        {inv && (
          <Segmented
            ariaLabel="Which account"
            value={selected}
            onChange={setSelected}
            options={[{ value: 'all', label: 'All' }, ...inv.accounts.map((a) => ({ value: String(a.id), label: a.name }))]}
          />
        )}
      </header>

      <section className="hero card rise" style={{ animationDelay: '60ms' }}>
        <div className="hero-main">
          <div className="label">{selected === 'all' ? 'All investments' : accName(Number(selected))}</div>
          {t ? <BigMoney cents={t.valueCents} /> : <div className="skeleton skeleton-hero" />}
          {t && (
            <div className="hero-change">
              <ChangePill cents={t.growthCents} basisPoints={t.growthBp} />
              <span className="muted-inline">growth on money put in. Market gains are never counted as income.</span>
            </div>
          )}
        </div>
        {t && (
          <div className="hero-stats">
            <div className="hero-stat tone-silver">
              <div className="label">Money put in</div>
              <div className="hero-stat-num num">{formatCents(t.putInCents)}</div>
            </div>
            <div className={`hero-stat ${t.growthCents >= 0 ? 'tone-gold' : 'tone-garnet'}`}>
              <div className="label">Growth</div>
              <div className="hero-stat-num num">{formatCents(t.growthCents, { sign: true })}</div>
            </div>
          </div>
        )}
      </section>

      <section className="card rise" style={{ animationDelay: '120ms' }}>
        <div className="label">Value vs money put in</div>
        {chartOption ? (
          <Chart option={chartOption} height={320} ariaLabel="Investment value versus money put in" />
        ) : (
          <p className="muted" style={{ padding: '30px 0' }}>
            Import your Fidelity history to see this chart. <Link to="/import">Import CSV</Link>
          </p>
        )}
        <PriceStateLegend states={(inv?.series ?? []).map((p) => p.priceState)} />
        <p className="hint">
          <Info size={13} /> Value is your shares on each day times that day's fund price, plus uninvested cash. Import each fund's daily price
          history (from its row below) to see the real ups and downs; days without a real price are shaded and explained when you hover.
        </p>
      </section>

      <div className="grid-budget rise" style={{ animationDelay: '180ms' }}>
        <section className="card">
          <div className="card-head">
            <div className="label">Holdings</div>
            <button className="btn btn-primary" onClick={() => setImporting(true)} disabled={!inv?.accounts.length}>
              <FileUp size={15} /> Update prices from file
            </button>
          </div>
          {msg && <p className={msg.ok ? 'ok-text' : 'error-text'}>{msg.text}</p>}
          {inv && inv.holdings.length === 0 ? (
            <p className="muted">
              No holdings yet. <Link to="/import"><Upload size={13} /> Import your Fidelity history</Link> and the share counts appear here.
            </p>
          ) : (
            <table className="table holdings">
              <thead>
                <tr>
                  <th>Fund</th>
                  <th className="num-col">Shares</th>
                  <th className="num-col">Price</th>
                  <th className="num-col">Value</th>
                  <th className="num-col">Mix</th>
                </tr>
              </thead>
              <tbody>
                {(inv?.holdings ?? []).map((h) => (
                  <tr key={h.symbol}>
                    <td className="fund-cell">
                      <div className="tx-desc">{h.symbol}</div>
                      <div className="tx-sub">{h.name}</div>
                      <div className="tx-sub history-line">
                        {h.history ? (
                          <>
                            Price history {formatDate(h.history.first, { year: false })} to {formatDate(h.history.last, { year: false })}
                          </>
                        ) : (
                          'No price history yet'
                        )}
                      </div>
                      <div className="fund-actions">
                        <button className="link-quiet price-edit-btn" onClick={() => setHistoryFor(h)} aria-label={`Import price history for ${h.symbol}`}>
                          <History size={11} /> Import price history
                        </button>
                        {h.history && (
                          <button className="link-quiet price-edit-btn" onClick={() => removeHistory(h.symbol)} aria-label={`Remove price history for ${h.symbol}`}>
                            <Trash2 size={11} /> Remove
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="num-col num">{formatShares(h.sharesMicro)}</td>
                    <td className="num-col price-col">
                      <PriceCell h={h} onSaved={reload} />
                    </td>
                    <td className="num-col num">{h.valueCents === null ? '' : formatCents(h.valueCents)}</td>
                    <td className="num-col">{h.valueCents && holdingsTotal ? `${Math.round((h.valueCents * 100) / holdingsTotal)}%` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">
            Prices come from files you download from Fidelity (Arc40 never connects to the internet), plus the prices of your Fidelity
            purchases. Use Edit price only when a fund is missing from your file.
          </p>
          {historyFor && (
            <Modal title="Import price history" onClose={() => setHistoryFor(null)}>
              <PriceHistoryImport symbol={historyFor.symbol} name={historyFor.name} onSaved={reload} />
            </Modal>
          )}
          {importing && (
            <Modal title="Update prices from a Fidelity positions file" onClose={() => setImporting(false)}>
              <PositionsImport onSaved={reload} />
            </Modal>
          )}
        </section>

        <div className="stack">
          <section className="card">
            <div className="label">Fund mix</div>
            {donutOption ? <Chart option={donutOption} height={220} ariaLabel="Holdings mix" /> : <p className="muted">No priced holdings yet.</p>}
          </section>
          <section className="card">
            <div className="label">Accounts</div>
            <ul className="recon">
              {(inv?.perAccount ?? []).map((a) => {
                const diff = a.holdingsValueCents !== null && a.recordedCents !== null ? a.holdingsValueCents - a.recordedCents : null;
                return (
                  <li key={a.id}>
                    <div>
                      <b>{a.name}</b>
                      <small>
                        Recorded {formatCents(a.recordedCents ?? 0)}
                        {a.holdingsValueCents !== null && ` · Holdings ${formatCents(a.holdingsValueCents)}`}
                      </small>
                    </div>
                    {diff !== null && diff !== 0 && (
                      <button className="btn btn-ghost" onClick={() => useHoldings(a.id)} title="Record today's balance as holdings x price">
                        <RefreshCw size={14} /> Use holdings value
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>

      {inv && inv.activity.length > 0 && (
        <section className="card rise">
          <div className="label" style={{ marginBottom: 10 }}>
            Recent activity
          </div>
          <table className="table">
            <tbody>
              {(allActivity ? inv.activity : inv.activity.slice(0, 15)).map((r) => (
                <tr key={r.id}>
                  <td className="tx-date">{formatDate(r.date, { year: false })}</td>
                  <td>
                    <div className="tx-desc">
                      {KIND_LABEL[r.kind] ?? r.kind} {r.symbol}
                      {r.taxYear && <span className="chip" style={{ marginLeft: 8 }}>{r.taxYear} tax year</span>}
                    </div>
                    <div className="tx-sub">
                      {accName(r.accountId)}
                      {r.quantityMicro !== 0 && ` · ${formatShares(Math.abs(r.quantityMicro))} shares`}
                      {r.priceE4 && ` @ ${formatPriceE4(r.priceE4)}`}
                    </div>
                  </td>
                  <td className="num-col num">{r.amountCents ? formatCents(r.amountCents, { sign: r.amountCents > 0 }) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {inv.activity.length > 15 && (
            <button className="btn btn-ghost show-more" onClick={() => setAllActivity((v) => !v)}>
              {allActivity ? 'Show fewer' : `Show all ${inv.activity.length}`}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
