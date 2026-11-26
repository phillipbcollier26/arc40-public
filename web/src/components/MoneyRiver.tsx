/**
 * Money river (V2 Phase 4): Dashboard card + full-screen view.
 *
 * Drawing: the ribbons and labels are SVG (crisp, hoverable, keyboard reachable); the gems and metal
 * pieces flowing along them are ONE canvas on top. Smoothness:
 *   - each stone is pre-drawn once per theme (lib/gems.ts) and only copied each frame;
 *   - a hard cap on pieces (about 30 on the card, 80 full screen), shared by the streams by size;
 *   - the loop stops while the river is off screen (IntersectionObserver) or the tab is hidden;
 *   - canvas resolution is capped at 2x;
 *   - with reduced motion there are no pieces at all: the river is a still chart.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Maximize2, Waves, X } from 'lucide-react';
import { layoutRiver, linkTone, particleCounts, pointOnLink, type LaidLink, type RiverTone } from '../../../shared/riverLayout';
import type { RiverData, RiverNode, RiverRange } from '../lib/types';
import { useApi } from '../lib/useApi';
import { formatCents, formatDate } from '../lib/format';
import { buildSprites, paintIcon, RIBBON_TOKEN, TONE_LABEL } from '../lib/gems';
import { useChartTheme } from '../lib/themeMode';
import { Segmented } from './Controls';

export const RIVER_RANGE_LABEL: Record<RiverRange, string> = {
  month: 'This month',
  '3m': 'Last 3 months',
  ytd: 'Year to date',
  '12m': 'Last 12 months',
};
const RANGE_OPTIONS = (Object.keys(RIVER_RANGE_LABEL) as RiverRange[]).map((value) => ({ value, label: RIVER_RANGE_LABEL[value] }));

/** True when the person asked the system for less motion (follows the setting live). */
export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setReduced(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduced;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.floor(el.clientWidth)));
    ro.observe(el);
    setW(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Where a click on a node leads: spending categories open Transactions for that category and range. */
export function transactionsLink(categoryId: number | null, from: string, to: string): string {
  const p = new URLSearchParams({ categoryId: categoryId === null ? 'none' : String(categoryId), from, to });
  return `/transactions?${p}`;
}
const isPickable = (n: RiverNode) => n.kind === 'spending';

/** Shortens a label to fit `maxPx` (about 0.58 x font size per character); the hover shows it in full. */
export function fitLabel(label: string, maxPx: number, fontPx: number): string {
  const max = Math.max(4, Math.floor(maxPx / (fontPx * 0.58)));
  return label.length <= max ? label : `${label.slice(0, max - 1).trimEnd()}…`;
}

interface Hover {
  x: number;
  y: number;
  title: string;
  cents: number;
  members?: RiverNode['members'];
  hint?: string;
}

interface Particle {
  link: number;
  t: number;
  speed: number;
  lane: number;
  size: number;
  spin: number;
  phase: number;
}

export function RiverChart({
  data,
  height,
  compact = false,
  onPick,
}: {
  data: RiverData;
  height: number;
  compact?: boolean;
  /** Called for a pickable node (a spending category). Not used on the compact card. */
  onPick?: (n: RiverNode) => void;
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const theme = useChartTheme();
  const [hover, setHover] = useState<Hover | null>(null);
  const [active, setActive] = useState<{ link?: number; node?: string } | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const narrow = width < 640;
  const margins = compact || narrow ? { left: narrow ? 92 : 118, right: narrow ? 96 : 128 } : { left: 200, right: 220 };
  const layout = useMemo(
    () =>
      width > 0
        ? layoutRiver(data.nodes, data.links, { width, height, nodeWidth: compact ? 10 : 14, gap: compact ? 13 : 16, top: compact ? 14 : 22, bottom: 8, ...margins })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, width, height, compact, margins.left, margins.right],
  );
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);
  const tones = useMemo(() => (layout ? layout.links.map((l) => linkTone(l, byId)) : []), [layout, byId]);

  // ---------- particles ----------
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !layout || reduced || layout.links.length === 0) {
      if (cv) cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height);
      return;
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    let sprites: ReturnType<typeof buildSprites>;
    try {
      sprites = buildSprites();
    } catch {
      return; // never let a drawing problem take the Dashboard down: the river stays a still chart
    }
    const counts = particleCounts(
      layout.links.map((l) => l.cents),
      compact ? 30 : 80,
    );
    const pxPerSec = compact ? 34 : 46;
    // Repeatable spread: a tiny seeded generator, so the river looks the same each time it opens.
    let seed = 40;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const parts: Particle[] = [];
    layout.links.forEach((l: LaidLink, i) => {
      const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0) + 1;
      for (let k = 0; k < counts[i]!; k++) {
        const size = Math.min(compact ? 10 : 13, Math.max(compact ? 6 : 7, l.width * 0.55 + 3));
        parts.push({
          link: i,
          t: (k + rnd()) / counts[i]!,
          speed: (pxPerSec * (0.8 + rnd() * 0.4)) / len,
          lane: (rnd() - 0.5) * Math.max(0, l.width - size) * 0.9,
          size,
          spin: (rnd() - 0.5) * 1.2,
          phase: rnd() * Math.PI * 2,
        });
      }
    });

    let raf = 0;
    let last = 0;
    let onScreen = true;
    const frame = (ts: number) => {
      const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
      last = ts;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const act = activeRef.current;
      for (const p of parts) {
        p.t += p.speed * dt;
        if (p.t > 1) p.t -= 1;
        const l = layout.links[p.link]!;
        const pt = pointOnLink(l, p.t, p.lane);
        const fade = Math.min(1, p.t / 0.06, (1 - p.t) / 0.06);
        const dim = act && (act.link !== undefined ? act.link !== p.link : act.node !== l.source && act.node !== l.target);
        ctx.globalAlpha = fade * (dim ? 0.18 : 0.95);
        const tone = tones[p.link]!;
        const s = p.size;
        ctx.save();
        ctx.translate(pt.x, pt.y);
        if (tone === 'gold' || tone === 'silver' || tone === 'bronze') {
          // Metal pieces turn slowly, catching the light.
          ctx.scale(0.55 + 0.45 * Math.abs(Math.cos(p.phase + ts / 900)), 1);
        } else {
          ctx.rotate(p.spin * Math.sin(p.phase + ts / 1400));
        }
        ctx.drawImage(sprites[tone], -s / 2, -s / 2, s, s);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (raf || document.hidden || !onScreen) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const io = new IntersectionObserver(([e]) => {
      onScreen = !!e?.isIntersecting;
      if (onScreen) start();
      else stop();
    });
    io.observe(cv);
    const vis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', vis);
    start();
    return () => {
      stop();
      io.disconnect();
      document.removeEventListener('visibilitychange', vis);
    };
  }, [layout, tones, reduced, theme, width, height, compact]);

  const showHover = useCallback(
    (e: React.MouseEvent, h: Omit<Hover, 'x' | 'y'>, act: { link?: number; node?: string }) => {
      const box = wrapRef.current?.getBoundingClientRect();
      if (!box) return;
      setActive(act);
      setHover({ ...h, x: e.clientX - box.left, y: e.clientY - box.top });
    },
    [wrapRef],
  );
  const clear = () => {
    setHover(null);
    setActive(null);
  };

  if (data.nodes.length === 0) {
    return (
      <div className="river-empty" style={{ height }}>
        No money came in or went out in this range.
      </div>
    );
  }

  const laidNodes = layout ? new Map(layout.nodes.map((n) => [n.id, n])) : new Map();
  const ribbonOpacity = 'var(--river-ribbon-opacity)';
  const nodeLabel = (n: RiverNode) => `${n.label}, ${formatCents(n.cents)}`;
  return (
    <div ref={wrapRef} className={`river ${compact ? 'river-compact' : ''}`} style={{ height }} onMouseLeave={clear}>
      {layout && (
        <svg width={width} height={height} role="img" aria-label={`Money river from ${formatDate(data.from)} to ${formatDate(data.to)}`}>
          {layout.links.map((l, i) => {
            const on = active ? (active.link !== undefined ? active.link === i : active.node === l.source || active.node === l.target) : false;
            const s = byId.get(l.source)!;
            const t = byId.get(l.target)!;
            return (
              <path
                key={`${l.source}>${l.target}`}
                className="river-ribbon"
                data-link={`${s.label} > ${t.label}`}
                d={l.d}
                style={{ fill: `var(${RIBBON_TOKEN[tones[i]!]})`, fillOpacity: on ? 'var(--river-ribbon-hover)' : active ? 'calc(var(--river-ribbon-opacity) * 0.45)' : ribbonOpacity }}
                onMouseMove={(e) => showHover(e, { title: `${s.label} → ${t.label}`, cents: l.cents }, { link: i })}
                onClick={() => !compact && onPick && (isPickable(t) ? onPick(t) : isPickable(s) ? onPick(s) : undefined)}
              />
            );
          })}
          {data.nodes.map((n) => {
            const g = laidNodes.get(n.id);
            if (!g) return null;
            const pick = !compact && onPick && isPickable(n);
            const tone = n.column === 1 ? 'gold' : linkTone(n.column === 0 ? { source: n.id, target: '' } : { source: '', target: n.id }, byId);
            const labelX = n.column === 0 ? g.x - 8 : n.column === 2 ? g.x + g.w + 8 : g.x + g.w / 2;
            const labelY = n.column === 1 ? g.y - 6 : g.y + g.h / 2;
            const anchor = n.column === 0 ? 'end' : n.column === 2 ? 'start' : 'middle';
            const twoLines = !compact && n.column !== 1 && g.h + 16 >= 30;
            const room = n.column === 0 ? margins.left - 12 : n.column === 2 ? margins.right - 12 : (compact || narrow ? 150 : 220);
            const shown = fitLabel(n.label, room, compact ? 11.5 : 12.5);
            const hint = pick ? 'Click to see these transactions' : undefined;
            return (
              <g
                key={n.id}
                className={`river-node ${pick ? 'is-pickable' : ''}`}
                data-node={n.label}
                role={pick ? 'link' : undefined}
                tabIndex={pick ? 0 : undefined}
                aria-label={pick ? `${nodeLabel(n)}. Open these transactions` : undefined}
                onMouseMove={(e) => showHover(e, { title: n.label, cents: n.cents, members: n.members, hint }, { node: n.id })}
                onClick={() => pick && onPick!(n)}
                onKeyDown={(e: ReactKeyboardEvent) => pick && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick!(n))}
              >
                <rect x={n.column === 0 ? g.x - margins.left + 4 : n.column === 2 ? g.x : g.x - 40} y={g.y - 2} width={n.column === 1 ? 80 + g.w : (n.column === 0 ? margins.left : margins.right) - 4 + g.w} height={g.h + 4} className="river-hit" />
                <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={Math.min(3, g.w / 2)} style={{ fill: `var(${RIBBON_TOKEN[tone]})` }} className="river-bar" />
                <text x={labelX} y={labelY} textAnchor={anchor} dominantBaseline={n.column === 1 ? 'auto' : twoLines ? 'auto' : 'middle'} className={`river-label ${n.column === 1 ? 'river-label-acct' : ''}`}>
                  {shown}
                </text>
                {twoLines && (
                  <text x={labelX} y={labelY + 15} textAnchor={anchor} className="river-amount num">
                    {formatCents(n.cents)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      <canvas ref={canvasRef} className="river-canvas" style={{ width, height }} aria-hidden="true" />
      {hover && (
        <div
          className={`river-tip ${hover.y > height - 150 ? 'is-above' : ''}`}
          role="status"
          style={{ left: Math.min(hover.x + 14, Math.max(0, width - 240)), top: hover.y > height - 150 ? hover.y - 12 : hover.y + 18 }}
        >
          <div className="river-tip-title">{hover.title}</div>
          <div className="river-tip-num num">{formatCents(hover.cents)}</div>
          {hover.members && (
            <ul className="river-tip-list">
              {hover.members.map((m) => (
                <li key={m.label}>
                  <span>{m.label}</span>
                  <span className="num">{formatCents(m.cents)}</span>
                </li>
              ))}
            </ul>
          )}
          {hover.hint && <div className="river-tip-hint">{hover.hint}</div>}
        </div>
      )}
    </div>
  );
}

function GemIcon({ tone }: { tone: RiverTone }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useChartTheme();
  useEffect(() => {
    try {
      if (ref.current) paintIcon(ref.current, tone, 18);
    } catch {
      /* the legend text still says what the stone means */
    }
  }, [tone, theme]);
  return <canvas ref={ref} className="gem-icon" style={{ width: 18, height: 18 }} aria-hidden="true" />;
}

function RiverTotals({ data }: { data: RiverData }) {
  const t = data.totals;
  const items: [string, number, string][] = [
    ['Came in', t.incomeCents + t.giftCents, 'gold'],
    ['Spent', t.spendingCents, 'ruby'],
    ['Invested', t.investedCents, 'emerald'],
    ['Kept as cash', t.keptCents, 'diamond'],
  ];
  if (t.fromEarlierCents > 0) items.push(['From money you already had', t.fromEarlierCents, 'silver']);
  return (
    <div className="river-totals">
      {items.map(([label, cents, tone]) => (
        <div key={label} className={`river-total river-total-${tone}`}>
          <span className="label">{label}</span>
          <b className="num">{formatCents(cents)}</b>
        </div>
      ))}
    </div>
  );
}

function RiverNotes({ data }: { data: RiverData }) {
  const notes: string[] = [];
  if (data.totals.fromEarlierCents > 0) notes.push('More went out than came in, so part of it came from money you already had.');
  if (data.matchedTransfers > 0)
    notes.push(
      `${data.matchedTransfers === 1 ? '1 transfer that is not linked was' : `${data.matchedTransfers} transfers that are not linked were`} matched by amount and date or by the bank's description. Nothing was changed.`,
    );
  if (data.unknownTransfers > 0)
    notes.push(
      `${data.unknownTransfers === 1 ? '1 transfer' : `${data.unknownTransfers} transfers`} could not be matched to the other side. Link ${data.unknownTransfers === 1 ? 'it' : 'them'} on Transactions to show where the money went.`,
    );
  notes.push('Transfers between your own accounts are never counted as income or spending.');
  return (
    <ul className="river-notes">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

function RiverLegend({ data }: { data: RiverData }) {
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const used = new Set(data.links.map((l) => linkTone(l, byId)));
  const order: RiverTone[] = ['gold', 'bronze', 'topaz', 'silver', 'ruby', 'amber', 'emerald', 'diamond'];
  return (
    <div className="river-legend" aria-label="What the stones mean">
      {order
        .filter((t) => used.has(t))
        .map((t) => (
          <span key={t} className="river-legend-item">
            <GemIcon tone={t} /> {TONE_LABEL[t]}
          </span>
        ))}
    </div>
  );
}

/** Full-screen river: range switch, the big river, totals, notes and what "Other" holds. Esc closes. */
function RiverFullScreen({ range, setRange, data, onClose }: { range: RiverRange; setRange: (r: RiverRange) => void; data: RiverData | null; onClose: () => void }) {
  const navigate = useNavigate();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [h, setH] = useState(() => Math.max(360, window.innerHeight - 300));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onResize = () => setH(Math.max(360, window.innerHeight - 300));
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  const pick = (n: RiverNode) => {
    if (!data) return;
    onClose();
    navigate(transactionsLink(n.categoryId ?? null, data.from, data.to));
  };
  const other = data?.nodes.find((n) => n.kind === 'other' && n.column === 2);
  return createPortal(
    <div className="river-full" role="dialog" aria-modal="true" aria-label="Money flow">
      <div className="river-full-head">
        <div>
          <div className="label dash-label">
            <Waves size={13} /> Money flow
          </div>
          <h2 className="river-full-title">{RIVER_RANGE_LABEL[range]}</h2>
          {data && (
            <div className="card-sub">
              {formatDate(data.from)} to {formatDate(data.to)}
            </div>
          )}
        </div>
        <div className="river-full-tools">
          <Segmented ariaLabel="River range" value={range} onChange={setRange} options={RANGE_OPTIONS} />
          <button ref={closeRef} className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close full screen">
            <X size={20} />
          </button>
        </div>
      </div>
      {data ? (
        <>
          <RiverTotals data={data} />
          <div className="river-full-chart">
            <RiverChart data={data} height={h} onPick={pick} />
          </div>
          <RiverLegend data={data} />
          {other?.members && (
            <div className="river-other">
              <span className="label">Other spending</span>
              {other.members.map((m) => (
                <button key={m.label} className="btn btn-ghost btn-sm" onClick={() => (onClose(), navigate(transactionsLink(m.categoryId, data.from, data.to)))}>
                  {m.label} <span className="num">{formatCents(m.cents)}</span>
                </button>
              ))}
            </div>
          )}
          <RiverNotes data={data} />
        </>
      ) : (
        <div className="skeleton" style={{ height: h }} />
      )}
    </div>,
    document.body,
  );
}

/** Dashboard card: a small live river. Clicking it (or the expand button) opens the full-screen view. */
export function MoneyRiverCard() {
  const [range, setRange] = useState<RiverRange>('3m');
  const [full, setFull] = useState(false);
  const { data } = useApi<RiverData>(`/api/river?range=${range}`);
  const open = () => setFull(true);
  const close = useCallback(() => setFull(false), []);
  return (
    <section className="card river-card">
      <div className="card-head">
        <div>
          <div className="label dash-label">
            <Waves size={13} /> Money flow · {RIVER_RANGE_LABEL[range].toLowerCase()}
          </div>
          <div className="card-sub">Where your money came from, where it landed and where it went</div>
        </div>
        <div className="river-card-tools">
          <Segmented ariaLabel="River range" value={range} onChange={setRange} options={RANGE_OPTIONS} />
          <button className="btn btn-ghost icon-btn" onClick={open} aria-label="Open the money flow full screen" title="Full screen">
            <Maximize2 size={16} />
          </button>
        </div>
      </div>
      <div className="river-card-body" role="button" tabIndex={0} aria-label="Open the money flow full screen" onClick={open} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}>
        {data ? <RiverChart data={data} height={330} compact /> : <div className="skeleton" style={{ height: 330 }} />}
      </div>
      {data && <RiverTotals data={data} />}
      {full && <RiverFullScreen range={range} setRange={setRange} data={data} onClose={close} />}
    </section>
  );
}
