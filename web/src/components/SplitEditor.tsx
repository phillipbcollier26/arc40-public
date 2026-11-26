import { useState } from 'react';
import { ArrowDownToLine, Plus, Scissors, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { Category, SplitPiece, Transaction } from '../lib/types';
import { formatCents, parseMoneyToCents } from '../../../shared/money';
import { MoneyInput } from './AccountForm';
import { CategorySelect } from './TxBits';

const MAX_PIECES = 50;

interface Draft {
  key: number;
  categoryId: number | null;
  amount: string;
  note: string;
}

/** Cents typed in a piece, or null when it is not a valid amount yet. */
function centsOf(text: string): number | null {
  if (!text.trim()) return null;
  try {
    return parseMoneyToCents(text);
  } catch {
    return null;
  }
}

/**
 * Divides one income or expense transaction into pieces. "Remaining" updates as you type and
 * Save stays off until the pieces add up exactly, to the cent. The server checks every rule again.
 */
export function SplitEditor({
  tx,
  categories,
  existing,
  onSaved,
  onCancel,
}: {
  tx: Transaction;
  categories: Category[];
  existing: SplitPiece[];
  onSaved: (pieces: SplitPiece[]) => void;
  onCancel: () => void;
}) {
  const kind = tx.type as 'income' | 'expense';
  const total = Math.abs(tx.amountCents);
  const [nextKey, setNextKey] = useState(existing.length > 0 ? existing.length + 1 : 3);
  const [pieces, setPieces] = useState<Draft[]>(() =>
    existing.length > 0
      ? existing.map((p, i) => ({ key: i + 1, categoryId: p.categoryId, amount: formatCents(Math.abs(p.amountCents)).slice(1), note: p.note }))
      : [
          { key: 1, categoryId: tx.categoryId, amount: formatCents(total).slice(1), note: '' },
          { key: 2, categoryId: null, amount: '', note: '' },
        ],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const placed = pieces.reduce((s, p) => s + (centsOf(p.amount) ?? 0), 0);
  const remaining = total - placed;
  const allValid = pieces.every((p) => p.categoryId !== null && (centsOf(p.amount) ?? 0) > 0);
  const canSave = pieces.length >= 2 && remaining === 0 && allValid && !busy;

  const update = (key: number, patch: Partial<Draft>) => setPieces((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const putRest = (key: number) => {
    const p = pieces.find((x) => x.key === key)!;
    const next = (centsOf(p.amount) ?? 0) + remaining;
    if (next > 0) update(key, { amount: formatCents(next).slice(1) });
  };
  const add = () => {
    setPieces((ps) => [...ps, { key: nextKey, categoryId: null, amount: '', note: '' }]);
    setNextKey((k) => k + 1);
  };

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ splits: SplitPiece[] }>('PUT', `/api/transactions/${tx.id}/split`, {
        pieces: pieces.map((p) => ({ categoryId: p.categoryId, amount: p.amount, note: p.note })),
      });
      onSaved(r.splits);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the split.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="split-editor" aria-label="Split transaction">
      <div className="split-head">
        <span className="label">
          <Scissors size={13} /> Split {formatCents(total)} into pieces
        </span>
        <span className={`split-remaining num ${remaining === 0 ? 'is-done' : remaining < 0 ? 'is-over' : ''}`} aria-live="polite">
          {remaining === 0 ? 'Adds up exactly' : remaining > 0 ? `Remaining: ${formatCents(remaining)}` : `Over by ${formatCents(-remaining)}`}
        </span>
      </div>
      <div className="split-bar" aria-hidden="true">
        {pieces.map((p, i) => {
          const c = centsOf(p.amount) ?? 0;
          const cat = categories.find((x) => x.id === p.categoryId);
          return c > 0 ? (
            <span
              key={p.key}
              style={{ flexGrow: c, background: `var(--${cat?.color ?? 'pewter'})`, animationDelay: `${i * 40}ms` }}
              title={cat?.name ?? 'Uncategorized'}
            />
          ) : null;
        })}
        {remaining > 0 && <span className="split-bar-rest" style={{ flexGrow: remaining }} />}
      </div>

      <ol className="split-pieces">
        {pieces.map((p, i) => (
          <li key={p.key} className="split-piece">
            <span className="split-n num">{i + 1}</span>
            <CategorySelect
              categories={categories}
              kind={kind}
              value={p.categoryId}
              onChange={(id) => update(p.key, { categoryId: id })}
              ariaLabel={`Piece ${i + 1} category`}
              includeNone={p.categoryId === null}
            />
            <MoneyInput value={p.amount} onChange={(v) => update(p.key, { amount: v })} ariaLabel={`Piece ${i + 1} amount`} />
            <input
              className="input"
              aria-label={`Piece ${i + 1} note`}
              placeholder="Note (optional)"
              value={p.note}
              maxLength={200}
              onChange={(e) => update(p.key, { note: e.target.value })}
            />
            <button
              type="button"
              className="btn btn-ghost split-rest"
              onClick={() => putRest(p.key)}
              disabled={remaining === 0 || (centsOf(p.amount) ?? 0) + remaining <= 0}
              aria-label={`Put the rest in piece ${i + 1}`}
              title="Put the rest here"
            >
              <ArrowDownToLine size={14} /> Put the rest here
            </button>
            <button
              type="button"
              className="btn btn-ghost icon-btn"
              onClick={() => setPieces((ps) => ps.filter((x) => x.key !== p.key))}
              disabled={pieces.length <= 2}
              aria-label={`Remove piece ${i + 1}`}
            >
              <X size={15} />
            </button>
          </li>
        ))}
      </ol>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions spread">
        <button type="button" className="btn btn-ghost" onClick={add} disabled={pieces.length >= MAX_PIECES}>
          <Plus size={15} /> Add a piece
        </button>
        <div className="split-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!canSave}>
            Save split
          </button>
        </div>
      </div>
    </div>
  );
}
