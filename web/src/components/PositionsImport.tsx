import { useState, type ChangeEvent } from 'react';
import { CheckCircle2, FileUp, FlaskConical, Info, TriangleAlert, Wrench } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { PositionsPreview } from '../lib/types';
import { formatCents, formatDate, formatPriceE4, formatShares, todayIso } from '../lib/format';
import { useMode } from '../lib/demo';

const MAX_BYTES = 10 * 1024 * 1024;
/** Exact decimal text for micro-shares (no floats): 19700000 -> "19.700000". */
const sharesText = (micro: number) => `${micro < 0 ? '-' : ''}${Math.floor(Math.abs(micro) / 1e6)}.${String(Math.abs(micro) % 1e6).padStart(6, '0')}`;
/** "+0.028" / "-1.500": the file has 3 decimals, so the difference is shown to 3 decimals too. */
const diffText = (micro: number) => {
  const thousandths = Math.round(Math.abs(micro) / 1000);
  return `${micro > 0 ? '+' : '-'}${Math.floor(thousandths / 1000)}.${String(thousandths % 1000).padStart(3, '0')}`;
};

/**
 * "Update prices from file": a Fidelity positions CSV -> fund prices for one day, after a preview.
 * In demo mode it offers a fake sample file instead (real files stay out of demo data).
 */
export function PositionsImport({ onSaved }: { onSaved: () => void }) {
  const demo = useMode() === 'demo';
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<PositionsPreview | null>(null);
  const [priceDate, setPriceDate] = useState<string>('');
  const [choice, setChoice] = useState<Record<string, string>>({}); // Fidelity name -> account id | 'none' | ''
  const [saved, setSaved] = useState<PositionsPreview | null>(null);
  const [fixed, setFixed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mapping = (p: PositionsPreview) =>
    p.accounts.map((a) => {
      const c = choice[a.name];
      return { name: a.name, accountId: c === undefined ? a.accountId : c === 'none' || c === '' ? null : Number(c) };
    });

  async function load(text: string | null, opts: { date?: string } = {}) {
    setError(null);
    setBusy(true);
    try {
      const body = { ...(opts.date ? { priceDate: opts.date } : {}), mapping: preview ? mapping(preview) : [] };
      const p = text === null
        ? await api<PositionsPreview>('POST', '/api/investments/positions/sample-preview', body)
        : await api<PositionsPreview>('POST', '/api/investments/positions/preview', { filename: file?.name ?? 'positions.csv', text, ...body });
      setPreview(p);
      setPriceDate(p.priceDate ?? '');
      setSaved(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // picking the same file again still works
    if (!f) return;
    if (f.size > MAX_BYTES) return setError('That file is larger than 10 MB.');
    const text = await f.text();
    setFile({ name: f.name, text });
    setChoice({});
    setPreview(null);
    await load(text);
  }

  async function save() {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      const body = { priceDate, mapping: mapping(preview) };
      const r = preview.sample
        ? await api<PositionsPreview>('POST', '/api/investments/positions/sample-commit', body)
        : await api<PositionsPreview>('POST', '/api/investments/positions/commit', { filename: file?.name ?? 'positions.csv', text: file?.text ?? '', ...body });
      setSaved(r);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the prices.');
    } finally {
      setBusy(false);
    }
  }

  async function fixShares(accountId: number, symbol: string, micro: number) {
    setError(null);
    try {
      await api('POST', '/api/investments/shares', { accountId, symbol, shares: sharesText(micro), asOf: saved?.priceDate ?? todayIso() });
      setFixed((s) => new Set(s).add(`${accountId}|${symbol}`));
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not fix the share count.');
    }
  }

  const shown = saved ?? preview;
  const allChosen = !!preview && preview.accounts.every((a) => (choice[a.name] ?? (a.accountId === null ? '' : String(a.accountId))) !== '');

  return (
    <div className="stack positions">
      {!preview && (
        <>
          <p className="muted">
            In Fidelity, open <b>Positions</b> and download the CSV. Arc40 reads each fund's price and checks your share counts. Account
            numbers in the file are ignored and never saved.
          </p>
          {demo ? (
            <button className="btn btn-primary" onClick={() => load(null)} disabled={busy}>
              <FlaskConical size={16} /> Try with a sample file
            </button>
          ) : (
            <label className="btn btn-primary file-btn">
              <FileUp size={16} /> Choose positions file
              <input type="file" accept=".csv,text/csv" aria-label="Positions file" onChange={pick} hidden />
            </label>
          )}
          {demo && <p className="hint">Demo mode uses a fake file Arc40 makes from the demo holdings. Real files stay out of demo data.</p>}
        </>
      )}

      {shown && (
        <>
          {shown.sample && <p className="chip chip-sample">Sample file (fake data)</p>}
          <div className="pos-date">
            <label className="field">
              <span className="label">Price date</span>
              <input
                className="input"
                type="date"
                aria-label="Price date"
                value={priceDate}
                max={todayIso()}
                disabled={!!saved}
                onChange={(e) => setPriceDate(e.target.value)}
                onBlur={() => priceDate && priceDate !== shown.priceDate && void load(shown.sample ? null : (file?.text ?? null), { date: priceDate })}
              />
            </label>
            <p className="hint">
              <Info size={13} /> {shown.priceDateReason}
              {shown.downloaded && <> (file: "{shown.downloaded.text}")</>}
            </p>
          </div>

          <div className="pos-block">
            <span className="label">Accounts</span>
            {shown.accounts.map((a) => (
              <div key={a.name} className="pos-account">
                <span className="pos-fid-name">{a.name}</span>
                <span className="muted">is</span>
                <select
                  className="input select-flush"
                  aria-label={`Arc40 account for ${a.name}`}
                  disabled={!!saved}
                  value={choice[a.name] ?? (a.accountId === null ? '' : String(a.accountId))}
                  onChange={(e) => setChoice((c) => ({ ...c, [a.name]: e.target.value }))}
                >
                  <option value="">Choose...</option>
                  {shown.investmentAccounts.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                  <option value="none">Not in Arc40</option>
                </select>
                {a.remembered && <span className="chip">remembered</span>}
              </div>
            ))}
          </div>

          <table className="table pos-table">
            <thead>
              <tr>
                <th>Fund</th>
                <th className="num-col">Price</th>
                <th className="num-col">Fidelity shares</th>
                <th className="num-col">Arc40 shares</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {shown.funds.map((f) => {
                const key = `${f.accountId}|${f.symbol}`;
                return (
                  <tr key={`${f.line}`}>
                    <td>
                      <div className="tx-desc">{f.symbol}</div>
                      <div className="tx-sub">
                        {f.description} · {f.accountName}
                      </div>
                    </td>
                    <td className="num-col num">
                      {formatPriceE4(f.priceE4)}
                      <div className="tx-sub">{priceDate ? formatDate(priceDate, { year: false }) : 'pick a date'}</div>
                    </td>
                    <td className="num-col num">{formatShares(f.fidelitySharesMicro)}</td>
                    <td className="num-col num">{f.arc40SharesMicro === null ? '-' : formatShares(f.arc40SharesMicro)}</td>
                    <td>
                      {f.arc40SharesMicro === null ? (
                        <span className="muted">not compared</span>
                      ) : f.matches || fixed.has(key) ? (
                        <span className="pos-ok">
                          <CheckCircle2 size={14} /> {fixed.has(key) ? 'Fixed' : 'Matches'}
                        </span>
                      ) : (
                        <span className="pos-off">
                          <TriangleAlert size={14} /> Off by {diffText(f.differenceMicro!)}
                          {saved && f.accountId !== null && (
                            <button className="btn btn-ghost btn-sm" onClick={() => fixShares(f.accountId!, f.symbol, f.fidelitySharesMicro)} aria-label={`Fix shares of ${f.symbol}`}>
                              <Wrench size={13} /> Fix shares
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!saved && shown.funds.some((f) => f.arc40SharesMicro !== null && !f.matches) && (
            <p className="hint">Share counts that differ can be fixed after you save the prices. Fixing adds an adjustment; your imported history is not changed.</p>
          )}

          {shown.missing.map((m) => (
            <p key={`${m.accountId}|${m.symbol}`} className="pos-off">
              <TriangleAlert size={14} /> Arc40 shows {formatShares(m.arc40SharesMicro)} shares of {m.symbol} in {m.accountName}, but the file lists none.
              {saved && !fixed.has(`${m.accountId}|${m.symbol}`) && (
                <button className="btn btn-ghost btn-sm" onClick={() => fixShares(m.accountId, m.symbol, 0)}>
                  <Wrench size={13} /> Set to 0
                </button>
              )}
            </p>
          ))}
          {shown.cash.map((c) => (
            <p key={c.line} className="hint">
              <Info size={13} /> {c.kind === 'pending' ? 'Pending activity' : `Cash (${c.symbol})`} in {c.accountName}: {c.valueCents === null ? 'no amount' : formatCents(c.valueCents)}
              {c.kind === 'cash' && c.arc40CashCents !== null && <> · Arc40 shows {formatCents(c.arc40CashCents)} uninvested</>}. Not a fund price, so it is not saved.
            </p>
          ))}
          {shown.skipped.length > 0 && (
            <details className="skipped">
              <summary>{shown.skipped.length} line(s) Arc40 could not use</summary>
              <ul>
                {shown.skipped.map((s) => (
                  <li key={s.line}>
                    Line {s.line}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {saved ? (
            <p className="ok-text" role="status">
              <CheckCircle2 size={15} /> Saved {saved.saved} price{saved.saved === 1 ? '' : 's'} for {formatDate(saved.priceDate!)}.
            </p>
          ) : (
            <div className="form-actions spread">
              <button className="btn btn-ghost" onClick={() => setPreview(null)}>
                Start over
              </button>
              <button className="btn btn-primary" onClick={save} disabled={busy || !priceDate || !allChosen}>
                Save {shown.prices.length} price{shown.prices.length === 1 ? '' : 's'}
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
