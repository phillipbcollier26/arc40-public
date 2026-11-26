import { useEffect, useRef, useState } from 'react';
import { formatBasisPoints, formatCents, splitCents } from '../lib/format';

/** Counts up to a cents value (integer steps only), then shows it exactly. */
function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    if (begin === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      from.current = target;
      return;
    }
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 4);
      setValue(p < 1 ? begin + Math.round((target - begin) * eased) : target);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

/** Headline money number: large dollars, small cents, animated. */
export function BigMoney({ cents, size = 'xl' }: { cents: number; size?: 'xl' | 'lg' | 'md' }) {
  const shown = useCountUp(cents);
  const p = splitCents(shown);
  return (
    <span className={`big-money big-money-${size} num`} aria-label={formatCents(cents)}>
      <span className="bm-sign">{p.sign}</span>
      <span className="bm-dollar">$</span>
      <span className="bm-whole">{p.dollars}</span>
      <span className="bm-cents">.{p.cents}</span>
    </span>
  );
}

/** "+$1,234.56 · +4.20%" pill colored by direction. */
export function ChangePill({ cents, basisPoints, suffix }: { cents: number; basisPoints?: number | null; suffix?: string }) {
  const dir = cents > 0 ? 'up' : cents < 0 ? 'down' : 'flat';
  const pct = basisPoints === undefined ? '' : formatBasisPoints(basisPoints);
  return (
    <span className={`change-pill change-${dir}`}>
      <span className="change-arrow" aria-hidden="true">
        {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '•'}
      </span>
      {formatCents(cents, { sign: true })}
      {pct && <span className="change-pct">{pct}</span>}
      {suffix && <span className="change-suffix">{suffix}</span>}
    </span>
  );
}

/** Tiny inline trend line. Values are cents; nulls (no data yet) are skipped. */
export function Sparkline({
  values,
  width = 120,
  height = 36,
  tone = 'gold',
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  tone?: 'gold' | 'silver' | 'bronze' | 'sage' | 'garnet';
}) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const sx = (x: number) => ((x - minX) / Math.max(1, maxX - minX)) * (width - 4) + 2;
  const sy = (y: number) => height - 3 - ((y - minY) / Math.max(1, maxY - minY)) * (height - 6);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');
  const area = `${d} L${sx(maxX).toFixed(1)},${height} L${sx(minX).toFixed(1)},${height} Z`;
  const id = `spark-${tone}`;
  return (
    <svg width={width} height={height} className={`sparkline tone-${tone}`} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="spark-stop-top" />
          <stop offset="100%" className="spark-stop-bottom" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={d} className="spark-line" fill="none" />
    </svg>
  );
}
