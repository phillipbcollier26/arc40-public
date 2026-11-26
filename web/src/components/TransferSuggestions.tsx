import { useEffect, useState } from 'react';
import { ArrowLeftRight, Link2, X } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { api, ApiError } from '../lib/api';
import type { Transaction } from '../lib/types';
import { Amount } from './TxBits';
import { formatDate } from '../lib/format';

interface Suggestion {
  out: Transaction;
  in: Transaction;
}

/**
 * "Possible transfers to review" (audit F-02). Automatic linking never re-types a row that has a category,
 * so a transfer that matches a categorized purchase or paycheck is listed here instead. Link = pair them by
 * hand (Unlink later restores the type and category); Not a pair = never suggested again. Renders nothing
 * when there is nothing to review.
 */
export function TransferSuggestions({
  accountName,
  onChanged,
  version,
}: {
  accountName: (id: number) => string;
  onChanged: () => void;
  /** Bumped by the page after any change, so the list follows edits made elsewhere on the page. */
  version: number;
}) {
  const { data, reload } = useApi<{ suggestions: Suggestion[] }>('/api/transfers/suggestions');
  useEffect(() => {
    if (version > 0) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = data?.suggestions ?? [];
  if (!list.length) return null;

  async function act(s: Suggestion, how: 'link' | 'dismiss') {
    setError(null);
    try {
      if (how === 'link') await api('POST', `/api/transactions/${s.out.id}/link`, { otherId: s.in.id });
      else await api('POST', '/api/transfers/suggestions/dismiss', { outId: s.out.id, inId: s.in.id });
      reload();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that.');
    }
  }

  const side = (t: Transaction) => (
    <span className="xfer-side">
      <span className="xfer-desc">{t.description}</span>
      <span className="muted">
        {accountName(t.accountId)} · {formatDate(t.date, { year: false })}
      </span>
      <Amount cents={t.amountCents} type={t.type} />
    </span>
  );

  return (
    <>
      <button className="notice-bar rise" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ArrowLeftRight size={16} /> {list.length} possible {list.length === 1 ? 'transfer' : 'transfers'} to review.{' '}
        {open ? 'Hide' : 'Show them'}
      </button>
      {open && (
        <section className="card xfer-review rise" aria-label="Possible transfers to review">
          <p className="muted">
            These look like the two sides of a move between your accounts, but one side has a category, so Arc40 did not link them
            on its own.
          </p>
          {error && <div className="notice-bar is-error">{error}</div>}
          {list.map((s) => (
            <div className="xfer-row" key={`${s.out.id}-${s.in.id}`}>
              {side(s.out)}
              <ArrowLeftRight size={15} className="muted" />
              {side(s.in)}
              <span className="xfer-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => act(s, 'link')}>
                  <Link2 size={14} /> Link
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => act(s, 'dismiss')}>
                  <X size={14} /> Not a pair
                </button>
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
