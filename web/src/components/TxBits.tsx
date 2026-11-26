import { ArrowLeftRight, Gift } from 'lucide-react';
import type { Category } from '../lib/types';
import type { TxType } from '../../../shared/transactions';
import { formatCents } from '../lib/format';

/** Colored category label. Colors are token names (var(--gold) etc.). */
export function CategoryBadge({ category, type }: { category: Category | undefined; type: TxType }) {
  if (type === 'transfer') {
    return (
      <span className="cat-badge cat-transfer">
        <ArrowLeftRight size={12} /> Transfer
      </span>
    );
  }
  if (type === 'gift') {
    return (
      <span className="cat-badge cat-gift">
        <Gift size={12} /> Gift
      </span>
    );
  }
  if (!category) return <span className="cat-badge cat-none">Uncategorized</span>;
  return (
    <span className="cat-badge">
      <span className="cat-dot" style={{ background: `var(--${category.color})` }} />
      {category.name}
    </span>
  );
}

/** Signed amount: money in is sage with a +, money out is plain. Transfers are muted. */
export function Amount({ cents, type }: { cents: number; type?: TxType }) {
  const cls = type === 'transfer' ? 'amt amt-muted' : cents > 0 ? 'amt amt-in' : 'amt';
  return <span className={`${cls} num`}>{formatCents(cents, { sign: cents > 0 })}</span>;
}

/** Category <select> grouped by group name, limited to one kind. */
export function CategorySelect({
  categories,
  kind,
  value,
  onChange,
  ariaLabel = 'Category',
  includeNone = true,
}: {
  categories: Category[];
  kind: 'income' | 'expense' | 'any';
  value: number | null;
  onChange: (id: number | null) => void;
  ariaLabel?: string;
  includeNone?: boolean;
}) {
  const list = categories.filter((c) => !c.archived && (kind === 'any' || c.kind === kind));
  const groups = [...new Set(list.map((c) => c.group))];
  return (
    <select
      className="input"
      aria-label={ariaLabel}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      {includeNone ? (
        <option value="">Uncategorized</option>
      ) : (
        <option value="" disabled>
          Pick a category
        </option>
      )}
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {list
            .filter((c) => c.group === g)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
