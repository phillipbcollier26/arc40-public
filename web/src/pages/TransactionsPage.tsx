import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, ChevronLeft, ChevronRight, Plus, Scissors, Search, Tags, Upload } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import type { AccountSummary, Category, Transaction, TxList } from '../lib/types';
import { Modal } from '../components/Modal';
import { Segmented } from '../components/Controls';
import { TransactionEditor } from '../components/TransactionEditor';
import { Amount, CategoryBadge, CategorySelect } from '../components/TxBits';
import { WorkCost } from '../components/WorkCost';
import { TransferSuggestions } from '../components/TransferSuggestions';
import { useWorkRate } from '../lib/workCost';
import { FutureYouLine, useFutureYouOn } from '../components/FutureYou';
import { formatCents, formatDate, todayIso } from '../lib/format';
import type { TxType } from '../../../shared/transactions';
import { addMonths, endOfMonth, isValidIsoDate, startOfMonth } from '../../../shared/dates';

const PAGE = 100;
/**
 * Filters a link can set (the money river opens "/transactions?categoryId=5&from=...&to=..."). Anything
 * invalid is ignored, never guessed.
 */
function readLinkFilters(params: URLSearchParams): { categoryId: number | 'none' | null; span: { from: string; to: string } | null } {
  const c = params.get('categoryId');
  const categoryId = c === 'none' ? 'none' : c && /^\d{1,9}$/.test(c) ? Number(c) : null;
  const from = params.get('from');
  const to = params.get('to');
  const span = from && to && isValidIsoDate(from) && isValidIsoDate(to) && from <= to ? { from, to } : null;
  return { categoryId, span };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function TransactionsPage() {
  const [params] = useSearchParams();
  const linked = useMemo(() => readLinkFilters(params), [params]);
  const [month, setMonth] = useState<string | null>(null); // 'YYYY-MM-01' or null = all time
  // A date range from a link (e.g. the money river). Cleared as soon as the month arrows are used.
  const [span, setSpan] = useState<{ from: string; to: string } | null>(linked.span);
  const [accountId, setAccountId] = useState<number | ''>('');
  const [type, setType] = useState<TxType | 'all'>('all');
  const [categoryId, setCategoryId] = useState<number | 'none' | ''>(linked.categoryId ?? '');
  useEffect(() => {
    // Following a new link while the page is open applies its filters too.
    if (linked.span) {
      setSpan(linked.span);
      setMonth(null);
    }
    if (linked.categoryId !== null) setCategoryId(linked.categoryId);
  }, [linked]);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const query = useMemo(() => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (span) {
      p.set('from', span.from);
      p.set('to', span.to);
    } else if (month) {
      p.set('from', month);
      p.set('to', endOfMonth(month));
    }
    if (accountId) p.set('accountId', String(accountId));
    if (type !== 'all') p.set('type', type);
    if (categoryId !== '') p.set('categoryId', String(categoryId));
    if (q.trim()) p.set('q', q.trim());
    return `/api/transactions?${p}`;
  }, [month, span, accountId, type, categoryId, q, limit]);

  const { data, reload } = useApi<TxList>(query);
  const { data: uncategorized, reload: reloadUncat } = useApi<TxList>('/api/transactions?categoryId=none&limit=1');
  const { data: acc } = useApi<{ accounts: AccountSummary[] }>('/api/accounts?archived=1');
  const { data: cats } = useApi<{ categories: Category[] }>('/api/categories');
  const accounts = acc?.accounts ?? [];
  const categories = cats?.categories ?? [];
  const catById = new Map(categories.map((c) => [c.id, c]));
  const accName = new Map(accounts.map((a) => [a.id, a.name]));

  const [version, setVersion] = useState(0);
  const refresh = () => {
    reload();
    reloadUncat();
    setVersion((v) => v + 1);
    setSelected(new Set());
  };

  async function setCategoryFor(tx: Transaction, id: number | null) {
    await api('PATCH', `/api/transactions/${tx.id}`, { categoryId: id });
    refresh();
  }

  async function bulk(patch: { type?: TxType; categoryId?: number | null }) {
    await api('POST', '/api/transactions/bulk', { ids: [...selected], ...patch });
    refresh();
  }

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const shiftMonth = (by: number) => {
    const base = span ? startOfMonth(span.to) : null;
    setSpan(null);
    setMonth((m) => addMonths(base ?? m ?? startOfMonth(todayIso()), by));
  };
  const monthLabel = span
    ? `${formatDate(span.from)} to ${formatDate(span.to)}`
    : month
      ? `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
      : 'All time';
  const list = data?.transactions ?? [];

  return (
    <div className="page">
      <header className="page-head rise">
        <div>
          <div className="label">Money</div>
          <h1 className="page-title">Transactions</h1>
        </div>
        <div className="head-actions">
          <Link to="/categories" className="btn btn-ghost">
            <Tags size={16} /> Categories & rules
          </Link>
          <Link to="/import" className="btn">
            <Upload size={16} /> Import CSV
          </Link>
          <button className="btn btn-primary" onClick={() => setEditing('new')} disabled={!accounts.length}>
            <Plus size={16} /> Add transaction
          </button>
        </div>
      </header>

      <section className="summary-strip card rise" style={{ animationDelay: '60ms' }}>
        <div className="summary-item tone-sage">
          <div className="label">Income</div>
          <div className="summary-num num">{formatCents(data?.sums.incomeCents ?? 0)}</div>
        </div>
        <div className="summary-item tone-garnet">
          <div className="label">Spending</div>
          <div className="summary-num num">{formatCents(data?.sums.spendingCents ?? 0)}</div>
        </div>
        <div className="summary-item tone-gold">
          <div className="label">Gifts received</div>
          <div className="summary-num num">{formatCents(data?.sums.giftCents ?? 0)}</div>
        </div>
        <div className="summary-item tone-silver">
          <div className="label">Moved between accounts</div>
          <div className="summary-num num">{formatCents(data?.sums.transferCents ?? 0)}</div>
        </div>
        <div className="summary-item summary-total">
          <div className="label">{monthLabel}</div>
          <div className="summary-num num">{data?.total ?? 0} transactions</div>
        </div>
      </section>

      {(uncategorized?.total ?? 0) > 0 && categoryId !== 'none' && (
        <button className="notice-bar rise" onClick={() => setCategoryId('none')}>
          <Tags size={16} /> {uncategorized!.total} transactions need a category. Show them
        </button>
      )}

      <TransferSuggestions accountName={(id) => accName.get(id) ?? 'Account'} onChanged={refresh} version={version} />

      <section className="card filters rise" style={{ animationDelay: '100ms' }}>
        <div className="month-nav">
          <button className="btn btn-ghost icon-btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
            <ChevronLeft size={18} />
          </button>
          <button className="btn btn-ghost month-label" onClick={() => (span ? setSpan(null) : setMonth(month ? null : startOfMonth(todayIso())))}>
            {monthLabel}
          </button>
          <button className="btn btn-ghost icon-btn" aria-label="Next month" onClick={() => shiftMonth(1)} disabled={span ? startOfMonth(span.to) >= startOfMonth(todayIso()) : !month || month >= startOfMonth(todayIso())}>
            <ChevronRight size={18} />
          </button>
        </div>
        <select className="input" aria-label="Filter by account" value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Filter by category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value === 'none' ? 'none' : e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">All categories</option>
          <option value="none">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Segmented
          ariaLabel="Filter by type"
          value={type}
          onChange={setType}
          options={[
            { value: 'all', label: 'All' },
            { value: 'income', label: 'Income' },
            { value: 'expense', label: 'Expense' },
            { value: 'transfer', label: 'Transfer' },
            { value: 'gift', label: 'Gift' },
          ]}
        />
        <div className="search">
          <Search size={15} />
          <input className="input" aria-label="Search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </section>

      {selected.size > 0 && (
        <div className="bulk-bar card">
          <span>{selected.size} selected</span>
          <CategorySelect categories={categories} kind="any" value={null} onChange={(id) => id && bulk({ categoryId: id, type: catById.get(id)!.kind })} ariaLabel="Set category for selected" />
          <button className="btn btn-ghost" onClick={() => bulk({ type: 'transfer' })}>
            <ArrowLeftRight size={15} /> Mark as transfer
          </button>
          <button className="btn btn-ghost" onClick={() => bulk({ type: 'gift' })}>
            Mark as gift
          </button>
          <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <section className="card rise" style={{ animationDelay: '140ms', padding: 0 }}>
        {data && list.length === 0 ? (
          <div className="empty">
            <h3>No transactions here yet</h3>
            <p className="muted">
              Import a CSV from your bank or add one by hand. Cash, Venmo, Cash App and Zelle payments that are not in a bank file can be added
              with <b>Add transaction</b>.
            </p>
            <Link to="/import" className="btn btn-primary" style={{ marginTop: 14 }}>
              <Upload size={16} /> Import CSV
            </Link>
          </div>
        ) : (
          <table className="table tx-table">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th className="num-col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {list.map((tx) => (
                <tr key={`${tx.id}-${tx.split?.position ?? 0}`} className={`tx-row ${tx.split ? 'is-piece' : ''}`} onClick={() => setEditing(tx)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    {/* Pieces are changed in the edit window, so they are not part of bulk actions. */}
                    {!tx.split && (
                      <input type="checkbox" aria-label={`Select ${tx.description}`} checked={selected.has(tx.id)} onChange={() => toggle(tx.id)} />
                    )}
                  </td>
                  <td className="tx-date">{formatDate(tx.date, { year: false })}</td>
                  <td>
                    <div className="tx-desc">
                      {tx.description}
                      {tx.split && (
                        <button
                          type="button"
                          className="split-chip"
                          title="Part of a split. Opens the whole transaction."
                          aria-label={`Split ${tx.split.position} of ${tx.split.count}: open the whole transaction`}
                        >
                          <Scissors size={11} /> Split {tx.split.position} of {tx.split.count}
                        </button>
                      )}
                    </div>
                    <div className="tx-sub">
                      {tx.split?.note && `${tx.split.note} · `}
                      {tx.split && `of ${formatCents(Math.abs(tx.split.totalCents))} · `}
                      {accName.get(tx.accountId)}
                      {tx.giftFrom && ` · from ${tx.giftFrom}`}
                      {tx.payer && ` · paid by ${tx.payer}`}
                      {tx.notes && ` · ${tx.notes}`}
                    </div>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} className="tx-cat">
                    {tx.split ? (
                      <CategoryBadge category={tx.categoryId ? catById.get(tx.categoryId) : undefined} type={tx.type} />
                    ) : tx.type === 'income' || tx.type === 'expense' ? (
                      <label className="cat-picker">
                        <CategoryBadge category={tx.categoryId ? catById.get(tx.categoryId) : undefined} type={tx.type} />
                        <CategorySelect categories={categories} kind={tx.type} value={tx.categoryId} onChange={(id) => setCategoryFor(tx, id)} ariaLabel={`Category for ${tx.description}`} />
                      </label>
                    ) : (
                      <CategoryBadge category={undefined} type={tx.type} />
                    )}
                  </td>
                  <td className="num-col">
                    <Amount cents={tx.amountCents} type={tx.type} />
                    <TxHover amountCents={tx.amountCents} type={tx.type} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.total > list.length && (
          <div className="load-more">
            <button className="btn btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({data.total - list.length} left)
            </button>
          </div>
        )}
      </section>

      {editing && (
        <Modal title={editing === 'new' ? 'Add transaction' : 'Edit transaction'} onClose={() => setEditing(null)}>
          <TransactionEditor
            tx={editing === 'new' ? null : editing}
            accounts={accounts.filter((a) => !a.archived)}
            categories={categories}
            defaultAccountId={accountId || undefined}
            onDone={() => {
              setEditing(null);
              refresh();
            }}
            onChanged={refresh}
          />
        </Modal>
      )}
    </div>
  );
}

/**
 * Shown while an expense row is hovered: its work cost and the future-you line (each only when switched on in
 * Settings). Nothing for income, transfers, gifts or refunds, and no empty box when both are off.
 */
function TxHover({ amountCents, type }: { amountCents: number; type: string }) {
  const rate = useWorkRate();
  const future = useFutureYouOn();
  if ((!rate && !future) || type !== 'expense' || amountCents >= 0) return null;
  return (
    <span className="tx-hover" role="tooltip">
      <WorkCost amountCents={amountCents} type={type} />
      <FutureYouLine amountCents={amountCents} type={type} />
    </span>
  );
}
