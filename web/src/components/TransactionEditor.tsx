import { useEffect, useState, type FormEvent } from 'react';
import { Link2, Link2Off, Scissors, Trash2, Undo2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { AccountSummary, Category, SplitPiece, Transaction } from '../lib/types';
import { TX_TYPE_HELP, TX_TYPE_LABELS, TX_TYPES, type TxType } from '../../../shared/transactions';
import { Segmented } from './Controls';
import { MoneyInput } from './AccountForm';
import { Amount, CategoryBadge, CategorySelect } from './TxBits';
import { WorkCost } from './WorkCost';
import { useWorkRate } from '../lib/workCost';
import { FutureYouLine, useFutureYouOn } from './FutureYou';
import { parseMoneyToCents } from '../../../shared/money';
import { SplitEditor } from './SplitEditor';
import { formatCents, formatDate, todayIso } from '../lib/format';

interface Props {
  tx: Transaction | null; // null = new manual transaction
  accounts: AccountSummary[];
  categories: Category[];
  defaultAccountId?: number;
  onDone: () => void;
  /** Called after a change that keeps the window open (saving or removing a split). */
  onChanged?: () => void;
}

/**
 * Add or edit one transaction. A row in the list can be one piece of a split, so an existing
 * transaction is always loaded whole first (full amount, its own category, all pieces).
 */
export function TransactionEditor(props: Props) {
  const id = props.tx?.id ?? null;
  const [whole, setWhole] = useState<{ transaction: Transaction; splits: SplitPiece[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (id === null) return;
    api<{ transaction: Transaction; splits: SplitPiece[] }>('GET', `/api/transactions/${id}`)
      .then(setWhole)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load this transaction.'));
  }, [id]);
  if (id === null) return <EditorForm {...props} tx={null} splits={[]} />;
  if (error) return <p className="error-text">{error}</p>;
  if (!whole) return <p className="hint">Loading...</p>;
  return <EditorForm {...props} tx={whole.transaction} splits={whole.splits} />;
}

/** Edit one whole transaction, split it, link transfers, and optionally create a rule from it. */
function EditorForm({ tx, accounts, categories, defaultAccountId, onDone, onChanged, splits }: Props & { splits: SplitPiece[] }) {
  const isNew = tx === null;
  const [accountId, setAccountId] = useState(tx?.accountId ?? defaultAccountId ?? accounts[0]?.id ?? 0);
  const [date, setDate] = useState(tx?.date ?? todayIso());
  const [amount, setAmount] = useState(tx ? formatCents(Math.abs(tx.amountCents)).slice(1) : '');
  const [direction, setDirection] = useState<'in' | 'out'>(tx ? (tx.amountCents > 0 ? 'in' : 'out') : 'out');
  const [description, setDescription] = useState(tx?.description ?? '');
  const [type, setType] = useState<TxType>(tx?.type ?? 'expense');
  const [categoryId, setCategoryId] = useState<number | null>(tx?.categoryId ?? null);
  const [giftFrom, setGiftFrom] = useState(tx?.giftFrom ?? '');
  const [payer, setPayer] = useState(tx?.payer ?? '');
  const [notes, setNotes] = useState(tx?.notes ?? '');
  const [makeRule, setMakeRule] = useState(false);
  const [rulePattern, setRulePattern] = useState(firstWords(tx?.description ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Transaction[] | null>(null);
  const [pieces, setPieces] = useState<SplitPiece[]>(splits);
  const [splitting, setSplitting] = useState(false);
  const isSplit = pieces.length > 0;
  // Audit F-04: the two sides of a linked transfer must keep matching amounts (the server refuses changes too).
  const isLinked = !!tx && tx.transferGroupId !== null;
  // Splitting works on the saved amount and type, so unsaved changes to those come first.
  const savedAmount = tx ? formatCents(Math.abs(tx.amountCents)).slice(1) : '';
  const savedDirection = tx ? (tx.amountCents > 0 ? 'in' : 'out') : 'out';
  const amountOrTypeChanged = !!tx && (amount !== savedAmount || direction !== savedDirection || type !== tx.type);
  const canSplit = !!tx && !isSplit && (tx.type === 'income' || tx.type === 'expense') && tx.transferGroupId === null;

  // Keep category valid for the chosen type.
  useEffect(() => {
    const cat = categories.find((c) => c.id === categoryId);
    if (type === 'transfer' || type === 'gift' || (cat && cat.kind !== type)) setCategoryId(null);
  }, [type, categoryId, categories]);

  useEffect(() => {
    if (tx && type === 'transfer' && tx.transferGroupId === null) {
      api<{ candidates: Transaction[] }>('GET', `/api/transactions/${tx.id}/link-candidates`).then((r) => setCandidates(r.candidates));
    }
  }, [tx, type]);

  const accountName = (id: number) => accounts.find((a) => a.id === id)?.name ?? 'Account';

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      // A split keeps its amount, type and category (the pieces must keep adding up).
      const body = isSplit
        ? { date, description, giftFrom, payer, notes }
        : { date, amount, direction, description, type, categoryId, giftFrom, payer, notes };
      if (isNew) await api('POST', '/api/transactions', { ...body, accountId });
      else await api('PATCH', `/api/transactions/${tx.id}`, body);
      if (makeRule && rulePattern.trim() && !isSplit) {
        await api('POST', '/api/rules', {
          pattern: rulePattern.trim(),
          direction: direction,
          setType: type === 'transfer' || type === 'gift' ? type : null,
          setCategoryId: type === 'income' || type === 'expense' ? categoryId : null,
          setGiftFrom: type === 'gift' ? giftFrom : '',
        });
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    }
  }

  async function link(otherId: number) {
    await api('POST', `/api/transactions/${tx!.id}/link`, { otherId });
    onDone();
  }
  async function unlink() {
    await api('POST', `/api/transactions/${tx!.id}/unlink`);
    onDone();
  }
  async function removeSplit() {
    setError(null);
    try {
      const r = await api<{ transaction: Transaction }>('DELETE', `/api/transactions/${tx!.id}/split`);
      setPieces([]);
      setCategoryId(r.transaction.categoryId);
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the split.');
    }
  }
  async function remove() {
    if (!window.confirm('Delete this transaction?')) return;
    await api('DELETE', `/api/transactions/${tx!.id}`);
    onDone();
  }

  return (
    <form className="stack" onSubmit={save}>
      {isNew && (
        <label className="field">
          <span className="label">Account</span>
          <select className="input" aria-label="Account" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span className="label">Description</span>
        <input className="input" aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Venmo to Sam for pizza" />
      </label>
      {tx?.rawDescription && tx.rawDescription !== tx.description && <p className="hint">Bank text: {tx.rawDescription}</p>}

      <div className="form-row">
        <fieldset className="fieldset-contents" disabled={isSplit || splitting || isLinked}>
        <label className="field">
          <span className="label">Amount</span>
          <MoneyInput value={amount} onChange={setAmount} />
        </label>
        <div className="field">
          <span className="label">Direction</span>
          <Segmented
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'out', label: 'Money out' },
              { value: 'in', label: 'Money in' },
            ]}
          />
        </div>
        </fieldset>
        <label className="field">
          <span className="label">Date</span>
          <input className="input" type="date" aria-label="Date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {isLinked && <p className="hint">Linked as a transfer. Unlink first to change the amount or direction.</p>}
      <EditorWorkLine amount={amount} direction={direction} type={type} />

      <fieldset className="field fieldset-plain" disabled={isSplit || splitting}>
        <span className="label">Type</span>
        <Segmented value={type} onChange={setType} options={TX_TYPES.map((t) => ({ value: t, label: TX_TYPE_LABELS[t] }))} ariaLabel="Type" />
        <p className="hint">{isSplit ? 'This transaction is split. Remove the split to change its amount or type.' : TX_TYPE_HELP[type]}</p>
      </fieldset>

      {splitting && tx ? (
        <SplitEditor
          tx={tx}
          categories={categories}
          existing={pieces}
          onCancel={() => setSplitting(false)}
          onSaved={(saved) => {
            setPieces(saved);
            setSplitting(false);
            onChanged?.();
          }}
        />
      ) : isSplit ? (
        <div className="split-summary">
          <div className="split-head">
            <span className="label">
              <Scissors size={13} /> Split into {pieces.length} pieces
            </span>
            <span className="split-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setSplitting(true)}>
                Edit split
              </button>
              <button type="button" className="btn btn-ghost" onClick={removeSplit}>
                <Undo2 size={15} /> Remove split
              </button>
            </span>
          </div>
          <ol className="split-list">
            {pieces.map((p) => (
              <li key={p.id}>
                <CategoryBadge category={categories.find((c) => c.id === p.categoryId)} type={type} />
                <span className="split-note">{p.note}</span>
                <Amount cents={p.amountCents} type={type} />
              </li>
            ))}
          </ol>
        </div>
      ) : (
        (type === 'income' || type === 'expense') && (
          <div className="field">
            <span className="label">Category</span>
            <div className="category-row">
              <CategorySelect categories={categories} kind={type} value={categoryId} onChange={setCategoryId} />
              {canSplit && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setSplitting(true)}
                  disabled={amountOrTypeChanged}
                  title={amountOrTypeChanged ? 'Save your changes to the amount or type first' : 'Divide this into several categories'}
                >
                  <Scissors size={15} /> Split
                </button>
              )}
            </div>
            {canSplit && amountOrTypeChanged && <p className="hint">Save your changes to the amount or type first, then split.</p>}
          </div>
        )
      )}
      {type === 'gift' && (
        <label className="field">
          <span className="label">From (optional)</span>
          <input className="input" aria-label="Gift from" value={giftFrom} onChange={(e) => setGiftFrom(e.target.value)} placeholder="e.g. Mom" />
        </label>
      )}
      {type === 'income' && (
        <label className="field">
          <span className="label">Paid by (optional)</span>
          <input className="input" aria-label="Paid by" value={payer} onChange={(e) => setPayer(e.target.value)} placeholder="e.g. league or assignor" />
        </label>
      )}
      <label className="field">
        <span className="label">Notes</span>
        <input className="input" aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {tx && tx.transferGroupId !== null && (
        <div className="link-box">
          <Link2 size={16} /> Linked as a transfer.
          <button type="button" className="btn btn-ghost" onClick={unlink}>
            <Link2Off size={15} /> Unlink
          </button>
        </div>
      )}
      {tx && type === 'transfer' && tx.transferGroupId === null && candidates && candidates.length > 0 && (
        <div className="link-box column">
          <span>Link with the other side of this transfer:</span>
          {candidates.map((c) => (
            <button type="button" key={c.id} className="btn btn-ghost link-cand" onClick={() => link(c.id)}>
              <Link2 size={15} /> {accountName(c.accountId)} · {formatDate(c.date)} · {formatCents(c.amountCents, { sign: true })}
            </button>
          ))}
        </div>
      )}

      {!isSplit && !splitting && (
        <label className="check">
          <input type="checkbox" checked={makeRule} onChange={(e) => setMakeRule(e.target.checked)} />
          <span>Always do this for descriptions containing</span>
          <input className="input input-sm" aria-label="Rule text" value={rulePattern} onChange={(e) => setRulePattern(e.target.value)} disabled={!makeRule} />
        </label>
      )}

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {!splitting && (
      <div className="form-actions spread">
        {!isNew ? (
          <button type="button" className="btn btn-ghost danger" onClick={remove}>
            <Trash2 size={15} /> Delete
          </button>
        ) : (
          <span />
        )}
        <button className="btn btn-primary" disabled={!description.trim() || !amount.trim()}>
          {isNew ? 'Add transaction' : 'Save'}
        </button>
      </div>
      )}
    </form>
  );
}

/** "SPOTIFY USA NY" -> "SPOTIFY USA": a sensible starting point for a rule. */
function firstWords(s: string): string {
  return s.split(/\s+/).filter((w) => w.length > 1 && !/^\d+$/.test(w)).slice(0, 2).join(' ');
}

/**
 * Under the amount, live as it is typed: its work cost and the future-you line (each only when switched on).
 * Only for money out on an expense.
 */
function EditorWorkLine({ amount, direction, type }: { amount: string; direction: 'in' | 'out'; type: string }) {
  const rate = useWorkRate();
  const future = useFutureYouOn();
  if ((!rate && !future) || type !== 'expense' || direction !== 'out') return null;
  let cents: number;
  try {
    cents = parseMoneyToCents(amount);
  } catch {
    return null;
  }
  if (cents <= 0) return null;
  return (
    <div className="editor-extras">
      {rate && (
        <p className="editor-work">
          <span className="label">Work cost</span>
          <WorkCost costCents={cents} />
        </p>
      )}
      {future && (
        <p className="editor-future">
          <FutureYouLine costCents={cents} />
        </p>
      )}
    </div>
  );
}
