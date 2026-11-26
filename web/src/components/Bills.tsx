import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Pencil, TriangleAlert, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import type { Bill, BillsMonth, Category, UpcomingBills } from '../lib/types';
import { formatCents, formatDate } from '../lib/format';
import { addMonths, daysInMonth, startOfMonth } from '../../../shared/dates';
import { CategoryBadge } from './TxBits';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Next due: Dec 7 [pencil]" that turns into a date box. Later dates follow the new one. */
export function DueDateEditor({ itemId, nextDue, onSaved }: { itemId: number; nextDue: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(nextDue);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api('PATCH', `/api/recurring/${itemId}`, { nextDue: value });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change the date.');
    }
  }
  if (!editing) {
    return (
      <button type="button" className="due-edit" onClick={() => setEditing(true)} aria-label={`Change next due date (${nextDue})`} title="Wrong date? Correct it">
        next {formatDate(nextDue, { year: false })} <Pencil size={11} />
      </button>
    );
  }
  return (
    <span className="due-edit-box">
      <input className="input input-sm" type="date" aria-label="Next due date" value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!value}>
        Save
      </button>
      <button type="button" className="btn btn-ghost icon-btn" onClick={() => setEditing(false)} aria-label="Cancel date change">
        <X size={14} />
      </button>
      {error && <span className="error-text">{error}</span>}
    </span>
  );
}

/** Next 30 days: total, the checking warning, and the bills in date order. `limit` shows only the first few. */
export function UpcomingList({ data, limit }: { data: UpcomingBills; limit?: number }) {
  // The Dashboard card (limit set) already says "Next 30 days" in its title.
  const label = limit ? 'Total due' : 'Due in the next 30 days';
  const shown = limit ? data.bills.slice(0, limit) : data.bills;
  return (
    <div className="upcoming">
      <div className="upcoming-total">
        <span className="label">{label}</span>
        <span className="upcoming-amount num">{formatCents(data.totalCents)}</span>
      </div>
      {data.overChecking && data.checking && (
        <p className="upcoming-warn" role="alert">
          <TriangleAlert size={14} /> That is more than your checking {data.checking.accounts === 1 ? 'account holds' : 'accounts hold'} today (
          {formatCents(data.checking.balanceCents)}).
        </p>
      )}
      {shown.length === 0 ? (
        <p className="muted">Nothing due in the next 30 days.</p>
      ) : (
        <ul className="upcoming-list">
          {shown.map((b) => (
            <li key={`${b.itemId}-${b.date}`}>
              <span className={`bill-dot dot-${b.tier ?? 'bronze'}`} />
              <span className="upcoming-date num">{formatDate(b.date, { year: false })}</span>
              <span className="upcoming-name">{b.name}</span>
              <span className="upcoming-cost num">{formatCents(b.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
      {limit && data.bills.length > limit && <p className="hint">+{data.bills.length - limit} more</p>}
    </div>
  );
}

/** Month grid of upcoming bills: metal chips on due days, click one for details. */
export function BillsCalendar({
  today,
  categories,
  version,
  nextDueOf,
  onChanged,
}: {
  today: string;
  categories: Category[];
  /** Bumped by the page when items change, so the calendar reloads. */
  version: number;
  /** The item's current next due date (for the "correct it" control). */
  nextDueOf: (itemId: number) => string | null;
  onChanged: () => void;
}) {
  const first = startOfMonth(today);
  const [month, setMonth] = useState(first);
  const [picked, setPicked] = useState<Bill | null>(null);
  const { data, reload } = useApi<BillsMonth>(`/api/recurring/calendar?month=${month}`);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  useEffect(() => {
    if (version > 0) reload();
    setPicked(null);
  }, [version, reload]);

  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = daysInMonth(y, m);
  const byDay = new Map<number, Bill[]>();
  for (const b of data?.bills ?? []) {
    const d = Number(b.date.slice(8, 10));
    byDay.set(d, [...(byDay.get(d) ?? []), b]);
  }
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const last = addMonths(first, 24);

  return (
    <div className="bills-cal">
      <div className="bills-cal-head">
        <button className="btn btn-ghost icon-btn" aria-label="Previous month" onClick={() => setMonth((x) => addMonths(x, -1))} disabled={month <= first}>
          <ChevronLeft size={18} />
        </button>
        <span className="bills-cal-title">
          {MONTHS[m - 1]} {y}
        </span>
        <button className="btn btn-ghost icon-btn" aria-label="Next month" onClick={() => setMonth((x) => addMonths(x, 1))} disabled={month >= last}>
          <ChevronRight size={18} />
        </button>
        <span className="bills-cal-total num push-right">{data ? `${formatCents(data.totalCents)} still due` : ''}</span>
      </div>
      <div className="bills-grid" role="grid" aria-label={`Bills in ${MONTHS[m - 1]} ${y}`}>
        {WEEKDAYS.map((w) => (
          <span key={w} className="bills-wd">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`x${i}`} className="bills-day is-blank" />;
          const iso = `${month.slice(0, 8)}${String(d).padStart(2, '0')}`;
          const list = byDay.get(d) ?? [];
          return (
            <div key={iso} className={`bills-day ${iso < today ? 'is-past' : ''} ${iso === today ? 'is-today' : ''}`} role="gridcell">
              <span className="bills-n num">{d}</span>
              {list.slice(0, 3).map((b, k) => (
                <button
                  key={b.itemId}
                  type="button"
                  className={`bill-chip chip-${b.tier ?? 'bronze'}`}
                  style={{ animationDelay: `${k * 40 + d * 8}ms` }}
                  onClick={() => setPicked(b)}
                  title={`${b.name} · ${formatCents(b.amountCents)}`}
                >
                  <span className="bill-chip-name">{b.name}</span>
                  <span className="bill-chip-amt num">{formatCents(b.amountCents)}</span>
                </button>
              ))}
              {list.length > 3 && <span className="bills-more">+{list.length - 3} more</span>}
            </div>
          );
        })}
      </div>
      {picked && (
        <div className="bill-detail" role="dialog" aria-label={`${picked.name} details`}>
          <div className="bill-detail-head">
            <span className={`bill-dot dot-${picked.tier ?? 'bronze'}`} />
            <b>{picked.name}</b>
            <button className="btn btn-ghost icon-btn push-right" aria-label="Close details" onClick={() => setPicked(null)}>
              <X size={15} />
            </button>
          </div>
          <p className="bill-detail-line num">
            <CalendarClock size={14} /> Due {formatDate(picked.date)} · {formatCents(picked.amountCents)} · {picked.scheduleLabel}
          </p>
          <div className="bill-detail-line">
            {picked.splitCategoryIds.length > 1 ? (
              <span className="sub-split">Split: {picked.splitCategoryIds.map((id) => catById.get(id)?.name ?? 'Uncategorized').join(' + ')}</span>
            ) : (
              <CategoryBadge category={picked.categoryId ? catById.get(picked.categoryId) : undefined} type="expense" />
            )}
            {nextDueOf(picked.itemId) && <DueDateEditor itemId={picked.itemId} nextDue={nextDueOf(picked.itemId)!} onSaved={onChanged} />}
          </div>
        </div>
      )}
    </div>
  );
}
