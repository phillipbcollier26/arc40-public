import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FileUp, FlaskConical, Info, RotateCcw, Settings2, TriangleAlert } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import type { AccountSummary, Category, ImportBatch, ImportPreview, ImportResult, Mapping, TreatAs, UnknownAction } from '../lib/types';
import { Segmented } from '../components/Controls';
import { Modal } from '../components/Modal';
import { Amount, CategoryBadge } from '../components/TxBits';
import { formatDate } from '../lib/format';
import { useMode } from '../lib/demo';

const MAX_BYTES = 10 * 1024 * 1024;

/** Import is refused by the server in demo mode, so the page explains that instead. */
export function ImportPage() {
  return useMode() === 'demo' ? <ImportOffInDemo /> : <ImportWorkspace />;
}

function ImportOffInDemo() {
  return (
    <div className="page">
      <header className="page-head rise">
        <div>
          <div className="label">Bring in your history</div>
          <h1 className="page-title">Import CSV</h1>
        </div>
      </header>
      <section className="card rise empty">
        <FlaskConical size={28} className="empty-icon" />
        <p>Import is turned off in demo mode so real bank files never end up in demo data.</p>
        <p className="hint">Leave demo mode (in the sidebar or Settings) to import your bank files.</p>
      </section>
    </div>
  );
}

function ImportWorkspace() {
  const { data: acc } = useApi<{ accounts: AccountSummary[] }>('/api/accounts');
  const { data: cats } = useApi<{ categories: Category[] }>('/api/categories');
  const { data: hist, reload: reloadHist } = useApi<{ batches: ImportBatch[] }>('/api/import/batches');
  const accounts = acc?.accounts ?? [];
  const catById = new Map((cats?.categories ?? []).map((c) => [c.id, c]));

  const [accountId, setAccountId] = useState<number | null>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [showMapping, setShowMapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragging, setDragging] = useState(false);

  // Default to the first account, but never overwrite a choice already made (even mid-load).
  useEffect(() => {
    if (accounts[0]) setAccountId((cur) => cur ?? accounts[0]!.id);
  }, [accounts]);

  const runPreview = useCallback(
    async (m: Mapping | null) => {
      if (!file || !accountId) return;
      setBusy(true);
      setError(null);
      try {
        const p = await api<ImportPreview>('POST', '/api/import/preview', {
          accountId,
          filename: file.name,
          text: file.text,
          ...(m ? { mapping: m } : {}),
        });
        setPreview(p);
        setMapping(p.mapping);
        if (p.mappingProblem || p.mappingSource === 'suggested') setShowMapping(true);
      } catch (err) {
        setPreview(null);
        setError(err instanceof ApiError ? err.message : 'Could not read that file.');
      } finally {
        setBusy(false);
      }
    },
    [file, accountId],
  );

  // New file or different account: start over with the saved/suggested columns.
  useEffect(() => {
    setMapping(null);
    if (file) void runPreview(null);
  }, [runPreview, file]);

  async function pick(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setError('That file is larger than 10 MB. Download a shorter date range.');
      return;
    }
    setResult(null);
    setFile({ name: f.name, text: await f.text() });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void pick(e.dataTransfer.files[0]);
  }

  function changeMapping(patch: Partial<Mapping>) {
    const m = { ...mapping!, ...patch };
    setMapping(m);
    void runPreview(m);
  }

  async function doImport() {
    if (!file || !accountId) return;
    setBusy(true);
    try {
      const r = await api<ImportResult>('POST', '/api/import/commit', {
        accountId,
        filename: file.name,
        text: file.text,
        ...(preview?.format === 'generic' && mapping ? { mapping } : {}),
      });
      setResult(r);
      setPreview(null);
      setFile(null);
      reloadHist();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  const [confirmUndo, setConfirmUndo] = useState<ImportBatch | null>(null);
  async function undo(batchId: number) {
    await api('DELETE', `/api/import/batches/${batchId}`);
    if (result?.batchId === batchId) setResult(null);
    setConfirmUndo(null);
    reloadHist();
  }
  // Undo stays one click, except when it would also delete splits you made by hand.
  const askUndo = (b: ImportBatch) => (b.splitCount > 0 ? setConfirmUndo(b) : void undo(b.id));

  const accName = (id: number) => accounts.find((a) => a.id === id)?.name ?? 'Account';

  return (
    <div className="page">
      <Link to="/transactions" className="back-link rise">
        <ArrowLeft size={16} /> Transactions
      </Link>
      <header className="page-head rise">
        <div>
          <div className="label">Bring in your history</div>
          <h1 className="page-title">Import CSV</h1>
        </div>
      </header>

      <section className="card import-start rise" style={{ animationDelay: '60ms' }}>
        <label className="field">
          <span className="label">1 · Account</span>
          <select className="input" aria-label="Import into account" value={accountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.typeLabel})
              </option>
            ))}
          </select>
          {!accounts.length && (
            <p className="hint">
              Add your accounts first on the <Link to="/accounts">Accounts</Link> page.
            </p>
          )}
        </label>
        <div className="field">
          <span className="label">2 · CSV file</span>
          <label
            className={`dropzone ${dragging ? 'is-drag' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <FileUp size={26} />
            <span>{file ? file.name : 'Drop a CSV here, or click to choose'}</span>
            <small>Download ALL history from your bank as CSV. Re-importing is safe: duplicates are skipped.</small>
            <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => {
                // Reset so picking the same file again (e.g. a re-download) still triggers a preview.
                const f = e.target.files?.[0];
                e.target.value = '';
                void pick(f);
              }}
              hidden
            />
          </label>
        </div>
      </section>

      {error && (
        <div className="notice-bar is-error" role="alert">
          <TriangleAlert size={16} /> {error}
        </div>
      )}

      {result && (
        <section className="card result-card rise">
          <CheckCircle2 size={28} className="result-icon" />
          <div>
            <h3>Imported {result.imported} transactions</h3>
            <p className="muted">
              {result.duplicates > 0 && `${result.duplicates} already-imported rows were skipped. `}
              {result.skipped > 0 && `${result.skipped} lines without a transaction were ignored. `}
              {result.balancesRecorded > 0 && `${result.balancesRecorded} daily balances were added to your balance history. `}
              {result.transfersLinked > 0 && `${result.transfersLinked} transfers between your accounts were matched.`}
            </p>
          </div>
          <div className="result-actions">
            <Link to="/transactions" className="btn btn-primary">
              View transactions
            </Link>
            <button className="btn btn-ghost" onClick={() => undo(result.batchId)}>
              <RotateCcw size={15} /> Undo
            </button>
          </div>
        </section>
      )}

      {preview && (
        <>
          <section className="card rise">
            <div className="card-head">
              <div>
                <div className="label">3 · Check it</div>
                <h3 className="preview-title">
                  {preview.preset ? `Recognized: ${preview.preset}` : 'Unknown bank layout'}
                  {preview.mappingSource === 'saved' && <span className="chip">Using your saved columns</span>}
                </h3>
              </div>
              {preview.format === 'generic' && (
                <button className="btn btn-ghost" onClick={() => setShowMapping((s) => !s)}>
                  <Settings2 size={15} /> {showMapping ? 'Hide columns' : 'Adjust columns'}
                </button>
              )}
            </div>

            {preview.format === 'fidelity' && (
              <p className="hint">
                <Info size={13} /> Fidelity file: contributions and transfers appear as transfers. Purchases, reinvestments and dividends are saved to
                this account's investment activity (used for holdings on the Investments page). Dividends are growth, not income.
              </p>
            )}
            {preview.unknownActions.length > 0 && (
              <UnknownActions items={preview.unknownActions} onSaved={() => runPreview(null)} />
            )}
            {preview.alreadyImported && (
              <div className="notice-bar">
                <Info size={16} /> You imported this exact file on {new Date(preview.alreadyImported.at).toLocaleDateString()}. Nothing will be
                duplicated.
              </div>
            )}

            {showMapping && mapping && <MappingEditor preview={preview} mapping={mapping} onChange={changeMapping} />}

            {preview.mappingProblem ? (
              <div className="notice-bar is-error">
                <TriangleAlert size={16} /> {preview.mappingProblem}
              </div>
            ) : (
              <div className="count-row">
                <span className="count-pill tone-gold">
                  <b>{preview.counts.new}</b> new
                </span>
                <span className="count-pill tone-silver">
                  <b>{preview.counts.duplicate}</b> already imported
                </span>
                {preview.counts.skipped > 0 && (
                  <span className="count-pill tone-garnet">
                    <b>{preview.counts.skipped}</b> {preview.counts.skipped === 1 ? 'line' : 'lines'} ignored
                  </span>
                )}
                {preview.balancesFound > 0 && (
                  <span className="count-pill tone-sage">
                    <b>{preview.balancesFound}</b> daily balances found
                  </span>
                )}
                <button className="btn btn-primary push-right" disabled={busy || preview.counts.new === 0} onClick={doImport}>
                  {preview.counts.new === 0 ? 'Nothing new to import' : `Import ${preview.counts.new} ${preview.format === 'fidelity' ? 'rows' : 'transactions'}`}
                </button>
              </div>
            )}
          </section>

          {!preview.mappingProblem && preview.rows.length > 0 && (
            <section className="card rise" style={{ padding: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>{preview.format === 'fidelity' ? 'Kind' : 'Category'}</th>
                    <th className="num-col">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line} className={r.status === 'duplicate' ? 'is-dim' : ''}>
                      <td className="tx-date">{formatDate(r.date)}</td>
                      <td className="tx-desc">
                        {r.description}
                        {r.unknownAction && <span className="chip chip-warn">Not recognized</span>}
                        {r.reversal && (
                          <span className="chip chip-warn" title={r.note}>
                            {r.note}
                          </span>
                        )}
                      </td>
                      <td>
                        {r.unknownAction ? (
                          <span className="cat-badge cat-none">Unknown action</span>
                        ) : r.type ? (
                          <CategoryBadge category={r.categoryId ? catById.get(r.categoryId) : undefined} type={r.type} />
                        ) : (
                          <span className="cat-badge cat-none">Investment activity</span>
                        )}
                      </td>
                      <td className="num-col">
                        <Amount cents={r.amountCents} type={r.type ?? undefined} />
                      </td>
                      <td>
                        <span className={`status status-${r.status}`}>{r.status === 'new' ? 'New' : 'Already imported'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          {confirmUndo && (
            <Modal title="Undo this import?" onClose={() => setConfirmUndo(null)}>
              <div className="stack">
                <p className="muted">
                  {confirmUndo.filename} brought in {confirmUndo.splitCount} transaction{confirmUndo.splitCount === 1 ? '' : 's'} you split
                  by hand. Undoing the import removes {confirmUndo.splitCount === 1 ? 'it and its' : 'them and their'} splits too. Importing
                  the file again brings the transactions back, but not the splits.
                </p>
                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => setConfirmUndo(null)}>
                    Keep it
                  </button>
                  <button className="btn btn-primary" onClick={() => undo(confirmUndo.id)}>
                    <RotateCcw size={14} /> Undo import and delete splits
                  </button>
                </div>
              </div>
            </Modal>
          )}
              {preview.rowsTruncated && <p className="hint" style={{ padding: 14 }}>Showing the first 500 rows. All of them will be imported.</p>}
            </section>
          )}

          {preview.skipped.length > 0 && (
            <details className="card skipped">
              <summary>
                {preview.skipped.length} {preview.skipped.length === 1 ? 'line' : 'lines'} ignored (notes, comments or unreadable rows)
              </summary>
              <ul>
                {preview.skipped.slice(0, 100).map((s) => (
                  <li key={s.line}>
                    Line {s.line}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {hist && hist.batches.length > 0 && (
        <section className="card rise">
          <div className="label" style={{ marginBottom: 10 }}>
            Import history
          </div>
          <table className="table">
            <tbody>
              {hist.batches.map((b) => (
                <tr key={b.id}>
                  <td>{new Date(b.createdAt).toLocaleDateString()}</td>
                  <td className="tx-desc">{b.filename}</td>
                  <td>{accName(b.accountId)}</td>
                  <td className="num-col">
                    {b.rowsImported} new · {b.rowsDuplicate} skipped
                  </td>
                  <td className="row-actions" style={{ width: 120 }}>
                    <button className="btn btn-ghost" style={{ opacity: 1 }} onClick={() => askUndo(b)} aria-label={`Undo import ${b.filename}`}>
                      <RotateCcw size={14} /> Undo
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

const TREAT_AS_LABEL: Record<TreatAs, string> = {
  transfer_in: 'Money put in',
  transfer_out: 'Money taken out',
  growth: 'Growth (gains, not money put in)',
  ignore: 'Ignore (do not import)',
};

/**
 * Fidelity actions Arc40 does not recognize. Arc40 never guesses: you pick what each one means,
 * the answer is remembered for every later import, and rows you already imported are corrected too.
 */
function UnknownActions({ items, onSaved }: { items: UnknownAction[]; onSaved: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const waiting = items.filter((i) => !i.treatAs).length;
  async function save(action: string, treatAs: TreatAs) {
    setErr(null);
    try {
      const r = await api<{ rowsUpdated: number }>('PUT', '/api/import/fidelity-actions', { action, treatAs });
      setMsg(r.rowsUpdated > 0 ? `Saved. ${r.rowsUpdated} row${r.rowsUpdated === 1 ? '' : 's'} you imported before were updated too.` : 'Saved.');
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save that.');
    }
  }
  return (
    <div className={`unknown-actions ${waiting ? 'is-waiting' : ''}`}>
      <p className="unknown-actions-head">
        <TriangleAlert size={15} />
        {waiting
          ? `${waiting} Fidelity action${waiting === 1 ? '' : 's'} Arc40 does not recognize. Until you choose, their cash counts as growth, not money put in.`
          : 'Fidelity actions Arc40 did not recognize, with your answers.'}
      </p>
      {items.map((i) => (
        <div className="unknown-action" key={i.action}>
          <div className="unknown-action-text">
            <code>{i.action}</code>
            <small>
              {i.rows} row{i.rows === 1 ? '' : 's'} · cash <Amount cents={i.cashCents} />
            </small>
          </div>
          <select
            className="input"
            aria-label={`What does "${i.action}" mean?`}
            value={i.treatAs ?? ''}
            onChange={(e) => e.target.value && void save(i.action, e.target.value as TreatAs)}
          >
            {!i.treatAs && <option value="">Choose what this means...</option>}
            {(Object.keys(TREAT_AS_LABEL) as TreatAs[]).map((k) => (
              <option key={k} value={k}>
                {TREAT_AS_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      ))}
      {msg && <p className="hint">{msg}</p>}
      {err && <p className="hint is-error">{err}</p>}
    </div>
  );
}

function MappingEditor({ preview, mapping, onChange }: { preview: ImportPreview; mapping: Mapping; onChange: (p: Partial<Mapping>) => void }) {
  const cols = preview.headers.filter(Boolean);
  const ColumnSelect = ({ label, value, onPick, optional }: { label: string; value?: string; onPick: (v: string | undefined) => void; optional?: boolean }) => (
    <label className="field">
      <span className="label">{label}</span>
      <select className="input" aria-label={label} value={value ?? ''} onChange={(e) => onPick(e.target.value || undefined)}>
        {optional ? <option value="">None</option> : <option value="" disabled>Pick a column</option>}
        {cols.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="mapping">
      <p className="hint">Tell Arc40 which column is which. This is saved for this account, so you only do it once.</p>
      <div className="sample-wrap">
        <table className="table sample">
          <thead>
            <tr>
              {preview.headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.sampleRows.map((r, i) => (
              <tr key={i}>
                {preview.headers.map((_, j) => (
                  <td key={j}>{r[j]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-row">
        <label className="field">
          <span className="label">Header is on line</span>
          <input
            className="input"
            type="number"
            min={1}
            aria-label="Header line"
            value={mapping.headerRow + 1}
            onChange={(e) => onChange({ headerRow: Math.max(0, Number(e.target.value) - 1) })}
          />
        </label>
        <ColumnSelect label="Date column" value={mapping.dateColumn} onPick={(v) => onChange({ dateColumn: v ?? '' })} />
        <label className="field">
          <span className="label">Date looks like</span>
          <select className="input" aria-label="Date format" value={mapping.dateFormat} onChange={(e) => onChange({ dateFormat: e.target.value as Mapping['dateFormat'] })}>
            <option value="MDY">10/29/2026 (month first)</option>
            <option value="YMD">2026-10-29 (year first)</option>
            <option value="DMY">29/10/2026 (day first)</option>
          </select>
        </label>
        <ColumnSelect label="Description" value={mapping.descriptionColumns[0]} onPick={(v) => onChange({ descriptionColumns: [v ?? '', ...mapping.descriptionColumns.slice(1)].filter(Boolean) })} />
        <ColumnSelect
          label="Backup description"
          optional
          value={mapping.descriptionColumns[1]}
          onPick={(v) => onChange({ descriptionColumns: [mapping.descriptionColumns[0] ?? '', ...(v ? [v] : [])].filter(Boolean) })}
        />
        <ColumnSelect label="Running balance" optional value={mapping.balanceColumn} onPick={(v) => onChange({ balanceColumn: v })} />
      </div>
      <div className="field">
        <span className="label">How amounts are shown</span>
        <Segmented
          ariaLabel="Amount layout"
          value={mapping.amountMode}
          onChange={(v) => onChange({ amountMode: v })}
          options={[
            { value: 'single', label: 'One amount column' },
            { value: 'debitCredit', label: 'Separate in / out columns' },
            { value: 'indicator', label: 'Amount + Credit/Debit column' },
          ]}
        />
      </div>
      <div className="form-row">
        {mapping.amountMode === 'single' && (
          <>
            <ColumnSelect label="Amount" value={mapping.amountColumn} onPick={(v) => onChange({ amountColumn: v })} />
            <label className="check">
              <input type="checkbox" checked={!!mapping.invertAmount} onChange={(e) => onChange({ invertAmount: e.target.checked })} />
              <span>My bank shows spending as positive numbers</span>
            </label>
          </>
        )}
        {mapping.amountMode === 'debitCredit' && (
          <>
            <ColumnSelect label="Money out" value={mapping.debitColumn} onPick={(v) => onChange({ debitColumn: v })} />
            <ColumnSelect label="Money in" value={mapping.creditColumn} onPick={(v) => onChange({ creditColumn: v })} />
          </>
        )}
        {mapping.amountMode === 'indicator' && (
          <>
            <ColumnSelect label="Amount" value={mapping.amountColumn} onPick={(v) => onChange({ amountColumn: v })} />
            <ColumnSelect label="Credit/Debit column" value={mapping.indicatorColumn} onPick={(v) => onChange({ indicatorColumn: v })} />
            <label className="field">
              <span className="label">Word for money in</span>
              <input className="input" aria-label="Word for money in" value={mapping.creditWord ?? ''} onChange={(e) => onChange({ creditWord: e.target.value })} />
            </label>
          </>
        )}
      </div>
    </div>
  );
}
