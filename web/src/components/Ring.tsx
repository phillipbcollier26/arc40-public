import { useId, type ReactNode } from 'react';

/**
 * Progress ring (0-100%). tone picks the metal: gold (default), silver, bronze, sage, garnet.
 * Over 100% fills fully. Children are centered inside.
 */
export function Ring({
  pct,
  size = 170,
  tone = 'gold',
  stroke = 9,
  children,
}: {
  pct: number;
  size?: number;
  tone?: 'gold' | 'silver' | 'bronze' | 'sage' | 'garnet';
  stroke?: number;
  children?: ReactNode;
}) {
  const id = `ring-${useId().replace(/:/g, '')}`;
  const stops: Record<string, [string, string]> = {
    gold: ['var(--gold-bright)', 'var(--bronze)'],
    silver: ['var(--platinum)', 'var(--pewter)'],
    bronze: ['var(--bronze)', 'var(--copper)'],
    sage: ['var(--sage)', 'var(--sage)'],
    garnet: ['var(--garnet)', 'var(--garnet)'],
  };
  const [a, b] = stops[tone]!;
  return (
    <div className="rate-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: a }} />
            <stop offset="100%" style={{ stopColor: b }} />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r="50" fill="none" strokeWidth={stroke} style={{ stroke: 'var(--line)' }} />
        <circle
          className="ring-anim"
          cx="60"
          cy="60"
          r="50"
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${Math.min(100, Math.max(0, pct))} 100`}
          transform="rotate(-90 60 60)"
          style={{ stroke: `url(#${id})` }}
        />
      </svg>
      <div className="rate-ring-text">{children}</div>
    </div>
  );
}
