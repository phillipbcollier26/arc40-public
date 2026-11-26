import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { WorkCost } from '../components/WorkCost';
import { useWorkRate } from '../lib/workCost';
import { BellRing, Check, CircleSlash, Plus, Repeat, RotateCcw, Sparkles, Trash2, TrendingUp, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import type { Category, RecurringItem, RecurringOverview, RecurringSuggestion, Schedule, UpcomingBills } from '../lib/types';
import { BillsCalendar, DueDateEditor, UpcomingList } from '../components/Bills';
import { Chart } from '../components/Chart';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/AccountForm';
import { BigMoney } from '../components/Money';
import { CategoryBadge, CategorySelect } from '../components/TxBits';
import { recurringDonutOption } from '../lib/charts';
import { formatCents, formatDate } from '../lib/format';
import { useChartTheme } from '../lib/themeMode';

const SCHEDULE_OPTIONS: { value: Schedule; label: string }[] = [
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Every month' },
  { value: 'quarterly', label: 'Every 3 months' },
  { value: 'yearly', label: 'Every year' },
];

/** "$11.99/month · $143.88/year" */
function Costs({ monthlyCents, yearlyCents }: { monthlyCents: number; yearlyCents: number }) {
  return (
    <span className="sub-costs num">
      <b>{formatCents(monthlyCents)}</b>/month <span className="sub-dot">·</span> {formatCents(yearlyCents)}/year
    </span>
  );
}

/** Work cost of one charge and of a year of it ("0.2 games a charge · 2.4 games a year"); nothing when Off. */
function SubWork({ chargeCents, yearlyCents }: { chargeCents: number; yearlyCents: number }) {
  const rate = useWorkRate();
  if (!rate || chargeCents <= 0) return null;
  return (
    <div className="sub-work" aria-label="Work cost">
      <WorkCost costCents={chargeCents} suffix="a charge" />
      <WorkCost costCents={yearlyCents} suffix="a year" className="work-cost-year" />
    </div>
  );
}

function CategoryLine({ item, catById }: { item: RecurringItem | RecurringSuggestion; catById: Map<number, Category> }) {
  if (item.splitCategoryIds.length > 1) {
    return (
      <span className="sub-split" title="The newest charge is split across these categories">
        Split: {item.splitCategoryIds.map((id) => catById.get(id)?.name ?? 'Uncategorized').join(' + ')}
      </span>
    );
  }
  return <CategoryBadge category={item.categoryId ? catById.get(item.categoryId) : undefined} type="expense" />;
}

function Flags({ item }: { item: RecurringItem | RecurringSuggestion }) {
  return (
    <>
      {item.isNew && (
        <span className="sub-flag flag-new" title="First charged in the last 60 days">
          <Sparkles size={11} /> New
        </span>
      )}
      {item.priceIncrease && (
        <span className="sub-flag flag-up" title="The newest charge is at least 5% and $0.50 above the usual amount">
          <TrendingUp size={11} /> Up from {formatCents(item.priceIncrease.fromCents)}
        </span>
      )}
    </>
  );
}

export function RecurringPage() {
  const { data, reload: reloadOverview } = useApi<RecurringOverview>('/api/recurring');
  const { data: upcoming, reload: reloadUpcoming } = useApi<UpcomingBills>('/api/recurring/upcoming');
  // Bumped after every change so the calendar reloads too.
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => {
    reloadOverview();
    reloadUpcoming();
    setVersion((v) => v + 1);
  }, [reloadOverview, reloadUpcoming]);
  const { data: cats } = useApi<{ categories: Category[] }>('/api/categories');
  const categories = cats?.categories ?? [];
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<{ name: string; cents: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The saving message is shown once, then fades away on its own.
  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(null), 10_000);
    return () => window.clearTimeout(t);
  }, [saved]);

  const chartTheme = useChartTheme();
  const donut = useMemo(
    () =>
      data && data.items.length
        ? recurringDonutOption(data.items.map((i) => ({ name: i.name, cents: i.yearlyCents, tier: i.tier ?? 'bronze' })))
        : null,
    [data, chartTheme],
  );

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    }
  };
  const confirm = (s: RecurringSuggestion) => act(() => api('POST', '/api/recurring/confirm', { key: s.key }));
  const dismiss = (s: RecurringSuggestion) => act(() => api('POST', '/api/recurring/dismiss', { key: s.key }));
  const restore = (i: RecurringItem) => act(() => api('POST', `/api/recurring/${i.id}/restore`));
  const remove = (i: RecurringItem) => act(() => api('DELETE', `/api/recurring/${i.id}`));
  const cancel = (i: RecurringItem) =>
    act(async () => {
      const r = await api<{ savedPerYearCents: number }>('POST', `/api/recurring/${i.id}/cancel`);
      // Shown once, right now. It is not stored and not shown again.
      setSaved({ name: i.name, cents: r.savedPerYearCents });
    });

  const next = data?.items.filter((i) => i.nextDue).sort((a, b) => (a.nextDue! < b.nextDue! ? -1 : 1))[0];

  return (
    <div className="page">
      <header className="page-head rise">
        <div>
          <div className="label">Plan</div>
          <h1 className="page-title">Recurring</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Plus size={16} /> Add recurring expense
        </button>
      </header>

      {saved && (
        <div className="notice-bar save-toast" role="status">
          <Sparkles size={16} />
          <span>
            You'll save <b className="num">{formatCents(saved.cents)}</b> a year by cancelling {saved.name}.
          </span>
          <button className="btn btn-ghost icon-btn push-right" aria-label="Close message" onClick={() => setSaved(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      {error && (
        <div className="notice-bar is-error" role="alert">
          {error}
        </div>
      )}

      <section className="card sub-hero rise" style={{ animationDelay: '60ms' }}>
        <div className="sub-hero-main">
          <div className="label">
            <Repeat size={13} /> Subscriptions and bills
          </div>
          <p className="sub-headline">
            cost you <BigMoney cents={data?.totals.yearlyCents ?? 0} size="lg" /> a year
          </p>
          <p className="sub-hero-sub num">
            About {formatCents(data?.totals.monthlyCents ?? 0)} a month · {data?.totals.count ?? 0} active
            {next && (
              <>
                {' '}
                · next: {next.name} on {formatDate(next.nextDue!, { year: false })}
              </>
            )}
          </p>
          {data && data.suggestions.length > 0 && (
            <a href="#review" className="sub-review-link">
              <BellRing size={14} /> {data.suggestions.length} to review below
            </a>
          )}
        </div>
        <div className="sub-hero-chart">
          {donut ? <Chart option={donut} height={220} ariaLabel="Yearly cost by subscription" /> : <p className="hint">Confirm a suggestion or add one by hand to see the breakdown.</p>}
        </div>
      </section>

      {data && data.suggestions.length > 0 && (
        <section className="rise" id="review" style={{ animationDelay: '120ms' }}>
          <h2 className="section-title">
            Suggestions to review <span className="count-chip">{data.suggestions.length}</span>
          </h2>
          <p className="hint">Arc40 found these repeating charges in your transactions. Confirm the real ones; dismissed ones stay dismissed.</p>
          <div className="sub-suggestions">
            {data.suggestions.map((s, i) => (
              <article key={s.key} className="card sub-suggestion rise" style={{ animationDelay: `${160 + i * 50}ms` }}>
                <div className="sub-card-top">
                  <h3 className="sub-name">{s.name}</h3>
                  <Flags item={s} />
                </div>
                <Costs monthlyCents={s.monthlyCents} yearlyCents={s.yearlyCents} />
                <p className="sub-meta">
                  {s.scheduleLabel} · {s.chargeCount} charges since {formatDate(s.firstSeen!, { year: true })}
                  {s.varies && ` · varies ${formatCents(s.varies.lowCents)} to ${formatCents(s.varies.highCents)}`}
                </p>
                <div className="sub-actions">
                  <CategoryLine item={s} catById={catById} />
                  <span className="push-right" />
                  <button className="btn btn-ghost" onClick={() => dismiss(s)} aria-label={`Dismiss ${s.name}`}>
                    <X size={15} /> Dismiss
                  </button>
                  <button className="btn btn-primary" onClick={() => confirm(s)} aria-label={`Confirm ${s.name}`}>
                    <Check size={15} /> Confirm
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {data && data.items.length > 0 && (
        <section className="rise" style={{ animationDelay: '150ms' }}>
          <h2 className="section-title">Upcoming bills</h2>
          <div className="bills-layout">
            <div className="card">
              <BillsCalendar
                today={data.today}
                categories={categories}
                version={version}
                nextDueOf={(id) => data.items.find((i) => i.id === id)?.nextDue ?? null}
                onChanged={reload}
              />
            </div>
            <div className="card">{upcoming && <UpcomingList data={upcoming} />}</div>
          </div>
        </section>
      )}

      <section className="rise" style={{ animationDelay: '180ms' }}>
        <h2 className="section-title">Your recurring charges</h2>
        {data && data.items.length === 0 ? (
          <div className="card empty">
            <p>Nothing confirmed yet. Confirm a suggestion above, or add a bill by hand.</p>
          </div>
        ) : (
          <div className="sub-grid">
            {data?.items.map((item, rank) => (
              <article key={item.id} className={`card sub-card tier-${item.tier}`} style={{ animationDelay: `${220 + rank * 55}ms` }}>
                <span className={`sub-rank rank-${item.tier}`} aria-label={`Rank ${rank + 1}, ${item.tier}`}>
                  {rank + 1}
                </span>
                <div className="sub-card-top">
                  <h3 className="sub-name">{item.name}</h3>
                  <Flags item={item} />
                </div>
                <Costs monthlyCents={item.monthlyCents} yearlyCents={item.yearlyCents} />
                <SubWork chargeCents={item.amountCents} yearlyCents={item.yearlyCents} />
                <p className="sub-meta">
                  {item.scheduleLabel}
                  {item.nextDue && (
                    <>
                      {' · '}
                      <DueDateEditor itemId={item.id} nextDue={item.nextDue} onSaved={reload} />
                    </>
                  )}
                  {item.source === 'manual' && ' · added by hand'}
                  {item.varies && ` · varies ${formatCents(item.varies.lowCents)} to ${formatCents(item.varies.highCents)}`}
                </p>
                <div className="sub-actions">
                  <CategoryLine item={item} catById={catById} />
                  <span className="push-right" />
                  <button className="btn btn-ghost" onClick={() => cancel(item)} aria-label={`Cancel ${item.name}`}>
                    <CircleSlash size={15} /> Cancel
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {data && data.cancelled.length > 0 && (
        <section className="rise" style={{ animationDelay: '240ms' }}>
          <h2 className="section-title">Cancelled</h2>
          <div className="card sub-cancelled">
            {data.cancelled.map((item) => (
              <div key={item.id} className="sub-cancelled-row">
                <span className="sub-name">{item.name}</span>
                <span className="sub-meta">
                  Cancelled {item.cancelledOn ? formatDate(item.cancelledOn) : ''} · was {formatCents(item.yearlyCents)}/year
                </span>
                <span className="push-right" />
                <button className="btn btn-ghost" onClick={() => restore(item)} aria-label={`Restore ${item.name}`}>
                  <RotateCcw size={14} /> Restore
                </button>
                {item.source === 'manual' && (
                  <button className="btn btn-ghost icon-btn" onClick={() => remove(item)} aria-label={`Delete ${item.name}`}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {adding && (
        <Modal title="Add a recurring expense" onClose={() => setAdding(false)}>
          <ManualForm
            categories={categories}
            onDone={() => {
              setAdding(false);
              reload();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function ManualForm({ categories, onDone }: { categories: Category[]; onDone: () => void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [schedule, setSchedule] = useState<Schedule>('monthly');
  const [nextDue, setNextDue] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('POST', '/api/recurring', { name, amount, schedule, nextDue, categoryId });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    }
  }

  return (
    <form className="stack" onSubmit={save}>
      <label className="field">
        <span className="label">Name</span>
        <input className="input" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Renters insurance" maxLength={80} />
      </label>
      <div className="form-row">
        <label className="field">
          <span className="label">Amount each time</span>
          <MoneyInput value={amount} onChange={setAmount} />
        </label>
        <label className="field">
          <span className="label">How often</span>
          <select className="input select-flush" aria-label="How often" value={schedule} onChange={(e) => setSchedule(e.target.value as Schedule)}>
            {SCHEDULE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-row">
        <label className="field">
          <span className="label">Next due</span>
          <input className="input" type="date" aria-label="Next due" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Category</span>
          <CategorySelect categories={categories} kind="expense" value={categoryId} onChange={setCategoryId} />
        </label>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={!name.trim() || !amount.trim() || !nextDue}>
          Add
        </button>
      </div>
    </form>
  );
}
