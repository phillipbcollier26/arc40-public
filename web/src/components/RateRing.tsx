import { formatBasisPoints } from '../lib/format';

/**
 * Savings-rate ring. Fills clockwise in gold for 0-100%, garnet when negative.
 * null = no income that period, shown as text instead of a misleading 0%.
 */
export function RateRing({ bp, size = 168, label = 'Savings rate' }: { bp: number | null; size?: number; label?: string }) {
  const pct = bp === null ? 0 : Math.min(100, Math.abs(bp) / 100);
  const negative = bp !== null && bp < 0;
  return (
    <div className="rate-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id="rate-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--gold-bright)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--bronze)' }} />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r="50" fill="none" strokeWidth="9" style={{ stroke: 'var(--line)' }} />
        {bp !== null && (
          <circle
            className="ring-anim"
            cx="60"
            cy="60"
            r="50"
            fill="none"
            strokeWidth="9"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${pct} 100`}
            transform={negative ? 'rotate(-90 60 60) scale(1 -1) translate(0 -120)' : 'rotate(-90 60 60)'}
            style={{ stroke: negative ? 'var(--garnet)' : 'url(#rate-g)' }}
          />
        )}
      </svg>
      <div className="rate-ring-text">
        {bp === null ? (
          <span className="rate-none">No income this month</span>
        ) : (
          <span className={`rate-num num ${negative ? 'neg' : ''}`}>{formatBasisPoints(bp, { sign: false })}</span>
        )}
        <span className="label">{label}</span>
      </div>
    </div>
  );
}
