import { useState, type ChangeEvent } from 'react';
import { CheckCircle2, FileUp, FlaskConical, Info, TriangleAlert } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { PriceHistoryPreview } from '../lib/types';
import { formatBasisPoints, formatDate, formatPriceE4 } from '../lib/format';
import { useMode } from '../lib/demo';
import type { PriceState } from '../lib/charts';
import { PRICE_STATE_STYLE } from '../lib/charts';

const MAX_BYTES = 10 * 1024 * 1024;

/** Color key for the shaded bands on investment charts (only the states that actually appear). */
export function PriceStateLegend({ states }: { states: (PriceState | null | undefined)[] }) {
  const shown = (['estimated', 'stale', 'unavailable'] as const).filter((s) => states.includes(s));
  if (!shown.length) return null;
  const help: Record<(typeof shown)[number], string> = {
    estimated: 'drawn straight between two real prices',
    stale: 'the last real price, getting old',
    unavailable: 'before the first price: money put in is shown',
  };
  return (
    <div className="state-legend" aria-label="What the shading means">
      {shown.map((s) => (
        <span key={s} className={`state-key key-${s}`}>
          <i aria-hidden="true" /> {PRICE_STATE_STYLE[s].label}: {help[s]}
        </span>
      ))}
    </div>
  );
}

/**
 * Import a daily price history file for ONE fund. The fund comes from the row it was opened from and
 * is shown big at the top; the file never decides which fund it is.
 */
export function PriceHistoryImport({ symbol, name, onSaved }: { symbol: string; name: string; onSaved: () => void }) {
  const demo = useMode() === 'demo';
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<PriceHistoryPreview | null>(null);
  const [dateColumn, setDateColumn] = useState('');
  const [priceColumn, setPriceColumn] = useState('');
  const [saved, setSaved] = useState<{ saved: number; first: string; last: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const columns = dateColumn && priceColumn ? { dateColumn, priceColumn } : undefined;

  async function load(text: string | null, cols?: { dateColumn: string; priceColumn: string }) {
    setError(null);
    setBusy(true);
    try {
      const body = { symbol, ...(cols ? { columns: cols } : {}) };
      const p =
        text === null
          ? await api<PriceHistoryPreview>('POST', '/api/investments/price-history/sample-preview', body)
          : await api<PriceHistoryPreview>('POST', '/api/investments/price-history/preview', { ...body, filename: file?.name ?? 'history.csv', text });
      setPreview(p);
      setDateColumn(p.columns?.dateColumn ?? '');
      setPriceColumn(p.columns?.priceColumn ?? '');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > MAX_BYTES) return setError('That file is larger than 10 MB.');
    const text = await f.text();
    setFile({ name: f.name, text });
    setPreview(null);
    setSaved(null);
    await load(text);
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const body = { symbol, ...(columns ? { columns } : {}) };
      const r = preview?.sample
        ? await api<{ saved: number; first: string; last: string }>('POST', '/api/investments/price-history/sample-commit', body)
        : await api<{ saved: number; first: string; last: string }>('POST', '/api/investments/price-history/commit', { ...body, filename: file?.name, text: file?.text ?? '' });
      setSaved(r);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack history-import">
      <div className="fund-banner">
        <span className="fund-symbol">{symbol}</span>
        <span className="fund-name">{name}</span>
        <span className="hint">These prices are saved for {symbol} only, whatever the file is called.</span>
      </div>

      {!preview && (
        <>
          <p className="muted">
            Download a daily price history for {symbol} as a CSV from a finance website (the date and the closing price are enough). Arc40
            reads it here; it never goes online.
          </p>
          {demo ? (
            <button className="btn btn-primary" onClick={() => load(null)} disabled={busy}>
              <FlaskConical size={16} /> Try with a sample file
            </button>
          ) : (
            <label className="btn btn-primary file-btn">
              <FileUp size={16} /> Choose price history file
              <input type="file" accept=".csv,text/csv" aria-label="Price history file" onChange={pick} hidden />
            </label>
          )}
        </>
      )}

      {preview && (
        <>
          {preview.sample && <p className="chip chip-sample">Sample file (fake data)</p>}
          <div className="pos-block">
            <span className="label">Columns</span>
            <div className="history-cols">
              <label className="field">
                <span className="hint">Date</span>
                <select className="input select-flush" aria-label="Date column" value={dateColumn} onChange={(e) => setDateColumn(e.target.value)} disabled={!!saved}>
                  <option value="">Choose...</option>
                  {preview.headers.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="hint">Closing price</span>
                <select className="input select-flush" aria-label="Price column" value={priceColumn} onChange={(e) => setPriceColumn(e.target.value)} disabled={!!saved}>
                  <option value="">Choose...</option>
                  {preview.headers.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
              {!saved && (
                <button
                  className="btn btn-ghost"
                  disabled={!columns || busy || (columns.dateColumn === preview.columns?.dateColumn && columns.priceColumn === preview.columns?.priceColumn)}
                  onClick={() => load(preview.sample ? null : (file?.text ?? ''), columns)}
                >
                  Use these columns
                </button>
              )}
            </div>
            <p className="hint">
              {preview.needsColumns
                ? 'Arc40 did not recognize the columns. Pick the date and the closing price; this is remembered for this fund.'
                : preview.columnsSource === 'saved'
                  ? 'Using the columns you picked last time for this fund.'
                  : preview.columnsSource === 'recognized'
                    ? 'Recognized automatically. "Adj Close" is never used: Arc40 already counts your reinvested dividends as shares.'
                    : 'Using the columns you picked.'}
            </p>
          </div>

          {preview.adjustedWarning && (
            <p className="pos-off">
              <TriangleAlert size={14} /> "{priceColumn}" looks like an adjusted price, which already includes dividends. Pick the plain closing price if the file has one.
            </p>
          )}
          {preview.mismatch && (
            <p className="pos-off" role="alert">
              <TriangleAlert size={14} /> On {preview.mismatch.comparedDays} day(s) Arc40 already has a price for {symbol}, these prices are typically{' '}
              {formatBasisPoints(preview.mismatch.typicalDiffBp, { sign: false })} different. Is this really {symbol}'s file?
            </p>
          )}

          {!preview.needsColumns && (
            <div className="history-summary">
              <div>
                <span className="label">Prices</span>
                <b className="num">{preview.count}</b>
              </div>
              <div>
                <span className="label">From</span>
                <b className="num">{preview.first ? formatDate(preview.first) : '-'}</b>
              </div>
              <div>
                <span className="label">To</span>
                <b className="num">{preview.last ? formatDate(preview.last) : '-'}</b>
              </div>
              <div>
                <span className="label">Latest close</span>
                <b className="num">{preview.prices.length ? formatPriceE4(preview.prices.at(-1)!.priceE4) : '-'}</b>
              </div>
            </div>
          )}
          {preview.existing && !saved && (
            <p className="hint">
              <Info size={13} /> {symbol} already has {preview.existing.count} prices from {formatDate(preview.existing.first)} to{' '}
              {formatDate(preview.existing.last)}. Days in this file replace those days; others stay.
            </p>
          )}
          {(preview.skippedCount ?? 0) > 0 && (
            <details className="skipped">
              <summary>{preview.skippedCount} row(s) skipped</summary>
              <ul>
                {preview.skipped.map((s) => (
                  <li key={s.line}>
                    Line {s.line}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {saved ? (
            <p className="ok-text" role="status">
              <CheckCircle2 size={15} /> Saved {saved.saved} prices for {symbol} ({formatDate(saved.first)} to {formatDate(saved.last)}).
            </p>
          ) : (
            <div className="form-actions spread">
              <button className="btn btn-ghost" onClick={() => setPreview(null)}>
                Start over
              </button>
              <button className="btn btn-primary" onClick={save} disabled={busy || preview.needsColumns || !preview.count}>
                Save {preview.count} prices for {symbol}
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
