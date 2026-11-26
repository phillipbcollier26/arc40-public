import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowLeft, Plus, Trash2, Wand2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import type { AccountSummary, Category, Rule } from '../lib/types';
import { CategoryBadge, CategorySelect } from '../components/TxBits';
import { Segmented } from '../components/Controls';
import { CATEGORY_COLORS, TX_TYPE_LABELS, type TxType } from '../../../shared/transactions';

export function CategoriesPage() {
  const { data: cats, reload: reloadCats } = useApi<{ categories: Category[] }>('/api/categories');
  const { data: rules, reload: reloadRules } = useApi<{ rules: Rule[] }>('/api/rules');
  const { data: acc } = useApi<{ accounts: AccountSummary[] }>('/api/accounts');
  const categories = cats?.categories ?? [];
  const groups = [...new Set(categories.map((c) => c.group))];
  const [msg, setMsg] = useState<string | null>(null);

  async function patchCat(id: number, patch: Partial<Category>) {
    try {
      await api('PATCH', `/api/categories/${id}`, patch);
      reloadCats();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Could not save.');
    }
  }
  async function deleteCat(c: Category) {
    const note = c.transactionCount ? ` Its ${c.transactionCount} transactions become uncategorized.` : '';
    if (!window.confirm(`Delete "${c.name}"?${note}`)) return;
    await api('DELETE', `/api/categories/${c.id}`);
    reloadCats();
    reloadRules();
  }
  async function deleteRule(id: number) {
    await api('DELETE', `/api/rules/${id}`);
    reloadRules();
  }
  async function applyAll() {
    const r = await api<{ updated: number }>('POST', '/api/rules/apply');
    setMsg(`Rules categorized ${r.updated} transactions.`);
  }

  return (
    <div className="page">
      <Link to="/transactions" className="back-link rise">
        <ArrowLeft size={16} /> Transactions
      </Link>
      <header className="page-head rise">
        <div>
          <div className="label">Organize</div>
          <h1 className="page-title">Categories & rules</h1>
        </div>
      </header>
      {msg && <div className="notice-bar">{msg}</div>}

      <div className="grid-cats">
        <section className="card rise" style={{ animationDelay: '60ms' }}>
          <div className="label" style={{ marginBottom: 12 }}>
            Categories
          </div>
          {groups.map((g) => (
            <div key={g} className="cat-group">
              <h4>{g}</h4>
              {categories
                .filter((c) => c.group === g)
                .map((c) => (
                  <CategoryRow key={c.id} c={c} onPatch={(p) => patchCat(c.id, p)} onDelete={() => deleteCat(c)} />
                ))}
            </div>
          ))}
          <AddCategory groups={groups} onDone={reloadCats} />
        </section>

        <section className="card rise" style={{ animationDelay: '120ms' }}>
          <div className="card-head">
            <div className="label">Auto-categorize rules</div>
            <button className="btn btn-ghost" onClick={applyAll}>
              <Wand2 size={15} /> Run on uncategorized
            </button>
          </div>
          <p className="hint">First match wins. Your rules run before the built-in ones. Matching is plain text and ignores capital letters.</p>
          <AddRule categories={categories} accounts={acc?.accounts ?? []} onDone={(n) => (reloadRules(), setMsg(n ? `New rule categorized ${n} transactions.` : 'Rule saved.'))} />
          <ul className="rule-list">
            {(rules?.rules ?? []).map((r) => (
              <li key={r.id}>
                <span className="rule-match">
                  {r.matchType === 'contains' ? 'contains' : r.matchType === 'starts_with' ? 'starts with' : 'is'} <b>"{r.pattern}"</b>
                  {r.direction !== 'any' && <small> · money {r.direction}</small>}
                </span>
                <span className="rule-arrow">→</span>
                {r.setCategoryId === null && (r.setType === 'income' || r.setType === 'expense') ? (
                  <span className="cat-badge">{TX_TYPE_LABELS[r.setType]}</span>
                ) : (
                  <CategoryBadge category={categories.find((c) => c.id === r.setCategoryId)} type={(r.setType ?? categories.find((c) => c.id === r.setCategoryId)?.kind ?? 'expense') as TxType} />
                )}
                {r.priority > 0 && <span className="chip">built-in</span>}
                <button className="btn btn-ghost icon-btn" aria-label={`Delete rule ${r.pattern}`} onClick={() => deleteRule(r.id)}>
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function CategoryRow({ c, onPatch, onDelete }: { c: Category; onPatch: (p: Partial<Category>) => void; onDelete: () => void }) {
  const [name, setName] = useState(c.name);
  useEffect(() => setName(c.name), [c.name]);
  return (
    <div className={`cat-row ${c.archived ? 'is-archived' : ''}`}>
      <select className="color-pick" aria-label={`Color for ${c.name}`} value={c.color} onChange={(e) => onPatch({ color: e.target.value })} style={{ background: `var(--${c.color})` }}>
        {CATEGORY_COLORS.map((col) => (
          <option key={col} value={col}>
            {col}
          </option>
        ))}
      </select>
      <input className="input input-sm cat-name" aria-label={`Name of ${c.name}`} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== c.name && onPatch({ name })} />
      <span className="chip">{c.kind}</span>
      <span className="cat-count">{c.transactionCount}</span>
      <button className="btn btn-ghost icon-btn" aria-label={c.archived ? `Unarchive ${c.name}` : `Archive ${c.name}`} onClick={() => onPatch({ archived: !c.archived })}>
        {c.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
      </button>
      <button className="btn btn-ghost icon-btn danger" aria-label={`Delete ${c.name}`} onClick={onDelete}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function AddCategory({ groups, onDone }: { groups: string[]; onDone: () => void }) {
  const [name, setName] = useState('');
  const [group, setGroup] = useState('Other');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api('POST', '/api/categories', { name, group, kind });
      setName('');
      setError(null);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add.');
    }
  }
  return (
    <form className="add-cat" onSubmit={submit}>
      <input className="input" placeholder="New category" aria-label="New category name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" list="cat-groups" placeholder="Group" aria-label="New category group" value={group} onChange={(e) => setGroup(e.target.value)} />
      <datalist id="cat-groups">
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <Segmented value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]} />
      <button className="btn" disabled={!name.trim()}>
        <Plus size={15} /> Add
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}

function AddRule({ categories, accounts, onDone }: { categories: Category[]; accounts: AccountSummary[]; onDone: (applied: number) => void }) {
  const [pattern, setPattern] = useState('');
  const [direction, setDirection] = useState<'any' | 'in' | 'out'>('any');
  const [target, setTarget] = useState<'category' | 'transfer' | 'gift'>('category');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [giftFrom, setGiftFrom] = useState('');
  const [accountId, setAccountId] = useState<number | null>(null);
  const [test, setTest] = useState<{ matches: number; examples: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pattern.trim().length < 2) return setTest(null);
    const h = setTimeout(() => {
      api<{ matches: number; examples: string[] }>('POST', '/api/rules/test', { pattern, direction }).then(setTest).catch(() => {});
    }, 250);
    return () => clearTimeout(h);
  }, [pattern, direction]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ applied: number }>('POST', '/api/rules', {
        pattern,
        direction,
        accountId,
        setType: target === 'category' ? null : target,
        setCategoryId: target === 'category' ? categoryId : null,
        setGiftFrom: target === 'gift' ? giftFrom : '',
      });
      setPattern('');
      setError(null);
      onDone(r.applied);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the rule.');
    }
  }

  return (
    <form className="add-rule" onSubmit={submit}>
      <div className="form-row">
        <label className="field">
          <span className="label">When the description contains</span>
          <input className="input" aria-label="Rule text" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. OHSAA" />
        </label>
        <label className="field">
          <span className="label">Money</span>
          <select className="input" aria-label="Rule direction" value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
            <option value="any">In or out</option>
            <option value="out">Out only</option>
            <option value="in">In only</option>
          </select>
        </label>
        <label className="field">
          <span className="label">Account</span>
          <select className="input" aria-label="Rule account" value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Any account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-row">
        <div className="field">
          <span className="label">Then mark it as</span>
          <Segmented
            value={target}
            onChange={setTarget}
            options={[
              { value: 'category', label: 'A category' },
              { value: 'transfer', label: TX_TYPE_LABELS.transfer },
              { value: 'gift', label: TX_TYPE_LABELS.gift },
            ]}
          />
        </div>
        {target === 'category' && (
          <label className="field">
            <span className="label">Category</span>
            <CategorySelect categories={categories} kind="any" value={categoryId} onChange={setCategoryId} includeNone={false} ariaLabel="Rule category" />
          </label>
        )}
        {target === 'gift' && (
          <label className="field">
            <span className="label">From</span>
            <input className="input" aria-label="Rule gift from" value={giftFrom} onChange={(e) => setGiftFrom(e.target.value)} placeholder="e.g. Mom" />
          </label>
        )}
      </div>
      <div className="rule-foot">
        <span className="hint">
          {test ? `Matches ${test.matches} existing transactions${test.examples.length ? `, like "${test.examples[0]}"` : ''}.` : ' '}
        </span>
        <button className="btn btn-primary" disabled={pattern.trim().length < 2 || (target === 'category' && !categoryId)}>
          Save rule
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}
