/**
 * One trophy, drawn as flat SVG with metal shading (Trophies Round 1).
 *
 *   Off     a flat silhouette, barely visible
 *   On      the silhouette with a thin outline in the rank's color; the design shows faintly as line art
 *   Earned  fully lit, a soft light on the shelf below it, and a sheen that sweeps across at random times
 *
 * Hover (earned or not): tilts toward the mouse, the sheen follows the cursor, the shelf glows in the rank's color and a
 * small label shows the rank and date. Reduced motion: no tilt, no sweep (CSS), soft fades only.
 * Drawing = material (rank) + shape + design + engraving; see materials.tsx, shapes.tsx, designs.tsx.
 */
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { formatCents } from '../../../shared/money';
import { TROPHY_GROUPS, rankInfo, trophyDef, type RankId, type Shape, type TrophyGroup, type TrophyRule, type TrophyState } from '../../../shared/trophies';
import { useReducedMotion } from '../components/MoneyRiver';
import { Design } from './designs';
import { MaterialDefs, materialFor, paintFor } from './materials';
import { drawShape } from './shapes';

/** What a trophy needs to be drawn (a subset of the server's trophy view). */
export interface TrophyLook {
  key: string;
  id: string;
  name: string;
  group: TrophyGroup;
  rank: RankId;
  stars: number;
  rankLabel: string;
  shape: Shape;
  design: string;
  designStep: number;
  engraving: string;
  state: TrophyState;
  year: number | null;
  earnedOn: string | null;
  records?: { period: string; amountCents: number; setOn: string }[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(d: string): string {
  return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
}
const wholeMoney = (c: number) => formatCents(c).replace(/\.00$/, '');
const period = (p: string) =>
  p.length === 7
    ? `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`
    : p.length === 10 // a day record (Best day ever): "Oct 14 2026"
      ? `${MONTHS[Number(p.slice(5, 7)) - 1]} ${Number(p.slice(8, 10))} ${p.slice(0, 4)}`
      : p;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

export function stateWord(t: Pick<TrophyLook, 'state' | 'earnedOn'>): string {
  return t.state === 'earned' ? `Earned ${t.earnedOn ? shortDate(t.earnedOn) : ''}`.trim() : t.state === 'on' ? 'Watching' : 'Off';
}

/** Five-point star centered at (cx, cy). */
function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`);
  }
  return pts.join(' ');
}

/** One lip notch per unit of a streak (drawShape caps it at 24). */
function streakNotches(rule: TrophyRule | undefined): number {
  switch (rule?.kind) {
    case 'roth_years_maxed':
      return rule.inARow ? rule.count : 0;
    case 'inv_month_streak':
    case 'ref_month_streak':
    case 'em_funded_streak':
    case 'sp_earn_streak':
    case 'sp_budget_streak':
    case 'td_clean_streak':
    case 'td_import_streak':
    case 'td_backup_streak':
      return rule.months;
    case 'lg_perfect_year':
      return 12;
    default:
      return 0;
  }
}

export function TrophyArt({ t, size = 120, idPrefix }: { t: TrophyLook; size?: number; idPrefix?: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9-]/g, '');
  const id = `tr-${idPrefix ?? ''}${reactId}`;
  const spec = materialFor(t.rank);
  const p = paintFor(id, spec);
  const level = rankInfo(t.rank).level;
  const rule = trophyDef(t.id)?.rule;
  const caption = /\$[\d.]+[kM]/.exec(t.name)?.[0];
  const design = <Design name={t.design} step={t.designStep} p={p} caption={caption} />;
  const out = drawShape(t.shape, {
    id,
    p,
    design,
    engraving: t.engraving,
    level,
    notches: streakNotches(rule),
    year: t.year,
    labelBelow:
      t.group === 'roth' ? 'ROTH IRA' : t.group === 'emergency' ? 'SAVINGS' : t.group === 'tidy' ? 'TIDY BOOKS' : t.group === 'long_game' ? 'LONG GAME' : TROPHY_GROUPS.find((g) => g.id === t.group)?.label.toUpperCase(),
    records: (t.records ?? []).map((r) => ({ amount: wholeMoney(r.amountCents), when: period(r.period) })),
  });
  const { cx, cy, r } = out.focus;
  const ring = spec.arc && t.shape !== 'arc' ? (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth="2.4" style={{ stroke: 'var(--tr-gold-lo)', strokeOpacity: 0.55 }} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={p.body} strokeWidth="3.4" strokeLinecap="round" strokeDasharray={`${2 * Math.PI * r * 0.74} ${2 * Math.PI * r}`} transform={`rotate(-210 ${cx} ${cy})`} />
      <circle cx={cx} cy={cy - r} r={r > 30 ? 10 : 7} fill={p.glow} className="tr-core-glow" />
      <circle cx={cx} cy={cy - r} r={r > 30 ? 3.4 : 2.4} style={{ fill: 'var(--tr-arc-core)' }} />
    </g>
  ) : null;
  const stars =
    t.stars > 0 ? (
      <g>
        {Array.from({ length: t.stars }, (_, i) => (
          <polygon key={i} points={star(60 + (i - (t.stars - 1) / 2) * 11, out.starsY, 4.6)} strokeWidth="0.7" style={{ fill: 'var(--tr-arc-core)', stroke: 'var(--tr-gold-lo)' }} />
        ))}
      </g>
    ) : null;
  const art = (
    <>
      {out.art}
      {ring}
      {stars}
    </>
  );
  return (
    <svg viewBox="0 0 120 160" width={size} height={(size * 160) / 120} aria-hidden="true" className="tr-svg">
      <defs>
        <MaterialDefs id={id} spec={spec} />
        <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x="-10" y="-10" width="140" height="180">
          <g className="tr-maskpaint">{art}</g>
        </mask>
      </defs>
      {t.state === 'earned' ? (
        <>
          <g className="tr-art">{art}</g>
          <g mask={`url(#${id}-mask)`} className="tr-sheen-wrap">
            <rect className="tr-sheen" x="-40" y="-20" width="40" height="200" fill={p.sheen} transform="skewX(-18)" />
          </g>
        </>
      ) : (
        <>
          <rect x="-10" y="-10" width="140" height="180" mask={`url(#${id}-mask)`} className="tr-ghost" />
          {t.state === 'on' && <g className="tr-line">{art}</g>}
        </>
      )}
    </svg>
  );
}

/**
 * A trophy on a shelf: the drawing, its shelf light, hover tilt and label. Clickable when `onOpen` is given
 * (keyboard: Enter / Space). The accessible name is "name, rank, state".
 */
export function Trophy({ t, size = 120, onOpen, isNew }: { t: TrophyLook; size?: number; onOpen?: () => void; isNew?: boolean }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const accent = materialFor(t.rank).accent;
  const h = hash(t.key);
  const style = {
    '--tr-accent': `var(${accent})`,
    '--tr-delay': `${-(h % 9000) / 1000}s`,
    '--tr-period': `${9 + (h % 6)}s`,
    width: size,
  } as CSSProperties;

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced || !ref.current) return;
    const b = ref.current.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width - 0.5;
    const y = (e.clientY - b.top) / b.height - 0.5;
    ref.current.style.setProperty('--tr-ry', `${(x * 18).toFixed(1)}deg`);
    ref.current.style.setProperty('--tr-rx', `${(-y * 14).toFixed(1)}deg`);
    ref.current.style.setProperty('--tr-sx', `${((x + 0.5) * 170 - 40).toFixed(0)}px`);
  };
  const leave = () => {
    setHover(false);
    ref.current?.style.setProperty('--tr-rx', '0deg');
    ref.current?.style.setProperty('--tr-ry', '0deg');
  };
  const key = (e: KeyboardEvent) => {
    if (onOpen && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onOpen();
    }
  };
  const label = `${t.name}, ${t.rankLabel}, ${stateWord(t)}`;
  return (
    <div
      ref={ref}
      className={`trophy is-${t.state}${hover ? ' is-hover' : ''}${onOpen ? ' is-clickable' : ''}`}
      style={style}
      role={onOpen ? 'button' : 'img'}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={label}
      title={label}
      onPointerEnter={() => setHover(true)}
      onPointerMove={move}
      onPointerLeave={leave}
      onFocus={() => setHover(true)}
      onBlur={leave}
      onClick={onOpen}
      onKeyDown={key}
    >
      {isNew && <span className="tr-new">NEW</span>}
      <div className="tr-tilt">
        <TrophyArt t={t} size={size} />
      </div>
      <div className="tr-floor" />
      <span className="tr-tip" aria-hidden="true">
        {rankInfo(t.rank).label}
        {t.stars ? ` ${'★'.repeat(t.stars)}` : ''} · {t.state === 'earned' && t.earnedOn ? shortDate(t.earnedOn) : t.state === 'on' ? 'Watching' : 'Off'}
      </span>
    </div>
  );
}
