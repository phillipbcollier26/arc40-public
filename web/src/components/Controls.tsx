import type { Range } from '../lib/types';

/** Pill-style toggle between a few options. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'is-on' : ''}
          onClick={() => onChange(o.value)}
          type="button"
          disabled={o.disabled}
          title={o.title}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function RangeTabs({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <Segmented
      ariaLabel="Time range"
      value={value}
      onChange={onChange}
      options={[
        { value: '1m', label: '1M' },
        { value: '3m', label: '3M' },
        { value: '6m', label: '6M' },
        { value: '1y', label: '1Y' },
        { value: 'all', label: 'All' },
      ]}
    />
  );
}
