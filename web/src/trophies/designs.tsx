/**
 * Trophy designs (Trophies Round 1): the picture on each trophy, drawn in a 100 x 100 box with the trophy's own
 * metal (Paint). One function per design family; `step` grows the design as a ladder climbs.
 * Rounds 2 to 4 add families here (one small function each) and nothing else changes. Round 2: Investing (trees and
 * growth) and Refereeing (whistles, flags and stripes). Round 3: Emergency fund and savings (umbrellas and jars) and
 * Spending habits (flames, jars, targets and scissors). Round 4: Keeping things tidy (ledgers, receipts, gears and
 * locked boxes), The long game (tree rings, flags, stars, ribbons and the case) and The Arc.
 */
import type { ReactNode } from 'react';
import type { Paint } from './materials';

export interface DesignInput {
  step: number;
  p: Paint;
  /** Short amount for the Arc40 design ("$2M"). */
  caption?: string;
}

const ENGRAVE = { stroke: 'var(--tr-engrave)' } as const;
const EDGE = { strokeWidth: 0.8, ...ENGRAVE };

// ------------------------------------------------------------------ small parts

/** One coin seen from the side, top face at (cx, y). */
function flatCoin(key: string | number, cx: number, y: number, rx: number, p: Paint): ReactNode {
  const ry = rx * 0.32;
  return (
    <g key={key}>
      <path d={`M${cx - rx} ${y} v4 a${rx} ${ry} 0 0 0 ${rx * 2} 0 v-4`} fill={p.bodyR} style={EDGE} />
      <ellipse cx={cx} cy={y} rx={rx} ry={ry} fill={p.face} style={EDGE} />
      <ellipse cx={cx} cy={y} rx={rx * 0.66} ry={ry * 0.62} fill="none" strokeWidth="0.6" style={ENGRAVE} />
    </g>
  );
}

/** A gold bar standing on (x, y), width w. */
function bar(key: string | number, x: number, y: number, w: number, p: Paint): ReactNode {
  const h = w * 0.3;
  return (
    <g key={key}>
      <polygon points={`${x},${y} ${x + w},${y} ${x + w - 4},${y - h} ${x + 4},${y - h}`} fill={p.body} style={EDGE} />
      <polygon points={`${x + 4},${y - h} ${x + w - 4},${y - h} ${x + w - 7},${y - h - 3} ${x + 7},${y - h - 3}`} fill={p.face} style={EDGE} />
    </g>
  );
}

function shieldPath(cx: number, top: number, w: number): string {
  const h = w * 1.18;
  const l = cx - w / 2;
  const r = cx + w / 2;
  return `M${l} ${top} H${r} V${top + h * 0.45} C${r} ${top + h * 0.78} ${cx + w * 0.22} ${top + h * 0.92} ${cx} ${top + h} C${cx - w * 0.22} ${top + h * 0.92} ${l} ${top + h * 0.78} ${l} ${top + h * 0.45} Z`;
}

function letter(text: string, x: number, y: number, size: number, extra?: object): ReactNode {
  return (
    <text x={x} y={y} textAnchor="middle" className="tr-letter" fontSize={size} style={{ fill: 'var(--tr-engrave)', ...extra }}>
      {text}
    </text>
  );
}

// ------------------------------------------------------------------ Net worth

function nwCoins({ step, p, caption }: DesignInput): ReactNode {
  switch (step) {
    case 1: // a single coin
      return (
        <g>
          <circle cx="50" cy="50" r="30" fill={p.face} style={EDGE} />
          <circle cx="50" cy="50" r="23" fill="none" strokeWidth="1" style={ENGRAVE} />
          {letter('$', 50, 61, 30)}
        </g>
      );
    case 2: // a stack
    case 3: // a taller stack
    case 4: {
      // a coin tower
      const n = step === 2 ? 3 : step === 3 ? 6 : 10;
      const rx = step === 4 ? 17 : 24;
      const gap = step === 4 ? 6.5 : 7.5;
      return <g>{Array.from({ length: n }, (_, i) => flatCoin(i, 50, 84 - i * gap, rx, p))}</g>;
    }
    case 5: // six coins in an arc
      return (
        <g>
          {Array.from({ length: 6 }, (_, i) => {
            const a = Math.PI * (1 - i / 5);
            const cx = 50 + Math.cos(a) * 34;
            const cy = 70 - Math.sin(a) * 34;
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r="11" fill={p.face} style={EDGE} />
                <circle cx={cx} cy={cy} r="7.5" fill="none" strokeWidth="0.6" style={ENGRAVE} />
              </g>
            );
          })}
          {letter('$', 50, 76, 22)}
        </g>
      );
    case 6: // one gold bar
      return <g>{bar(0, 18, 66, 64, p)}</g>;
    case 7: // a stack of bars
      return <g>{[bar(0, 10, 80, 40, p), bar(1, 50, 80, 40, p), bar(2, 30, 64, 40, p)]}</g>;
    case 8: // a pyramid of bars
    case 9: {
      const rows = step === 8 ? 3 : 4;
      const w = step === 8 ? 28 : 22;
      const out: ReactNode[] = [];
      for (let r = 0; r < rows; r++)
        for (let i = 0; i < rows - r; i++) out.push(bar(`${r}-${i}`, 50 - ((rows - r) * w) / 2 + i * w, 88 - r * (w * 0.3 + 3), w, p));
      return <g>{out}</g>;
    }
    case 10: // a diamond-cut "1M"
      return (
        <g>
          <polygon points="50,8 86,34 50,92 14,34" fill={p.trim} style={EDGE} />
          <polygon points="50,8 86,34 14,34" fill={p.face} style={EDGE} />
          <path d="M14 34 L50 92 L86 34 M32 34 L50 8 L68 34 M32 34 L50 92 L68 34" fill="none" strokeWidth="0.6" style={ENGRAVE} />
          {letter('1M', 50, 30, 14, { fill: 'var(--tr-engrave)' })}
        </g>
      );
    default: // the Arc40 ring closing around the amount
      return (
        <g>
          <circle cx="50" cy="50" r="36" fill="none" strokeWidth="5" style={{ stroke: 'var(--tr-gold-lo)', strokeOpacity: 0.5 }} />
          <circle cx="50" cy="50" r="36" fill="none" stroke={p.body} strokeWidth="6" strokeLinecap="round" strokeDasharray="190 226" transform="rotate(-210 50 50)" />
          {letter(caption ?? '', 50, 57, caption && caption.length > 3 ? 18 : 22)}
        </g>
      );
  }
}

/** One rising arrow from the lower left to the upper right. */
function arrow(key: number, x: number, y: number, len: number, p: Paint): ReactNode {
  return (
    <g key={key} transform={`translate(${x} ${y}) rotate(-40)`}>
      <rect x="0" y="-3" width={len - 10} height="6" rx="1" fill={p.body} style={EDGE} />
      <polygon points={`${len - 12},-9 ${len},0 ${len - 12},9`} fill={p.face} style={EDGE} />
    </g>
  );
}

function nwArrows({ step, p }: DesignInput): ReactNode {
  const n = Math.max(1, Math.min(6, step));
  return (
    <g>
      <path d="M8 90 H92" strokeWidth="1.2" style={ENGRAVE} />
      {Array.from({ length: n }, (_, i) => arrow(i, 12 + (i * 60) / Math.max(1, n), 86 - (i % 2) * 6, 44 + (n === 1 ? 20 : 0), p))}
    </g>
  );
}

function nwPeak({ p }: DesignInput): ReactNode {
  return (
    <g>
      <polygon points="6,90 38,40 52,58 68,22 94,90" fill={p.body} style={EDGE} />
      <polygon points="68,22 76,42 70,38 64,44 60,40" fill={p.hi} style={EDGE} />
      <path d="M68 22 V4" strokeWidth="1.6" style={ENGRAVE} />
      <polygon points="68,4 86,9 68,14" fill={p.face} style={EDGE} />
    </g>
  );
}

function nwCrownCalendar({ p }: DesignInput): ReactNode {
  return (
    <g>
      <polygon points="26,30 32,12 42,24 50,8 58,24 68,12 74,30" fill={p.face} style={EDGE} />
      <rect x="18" y="32" width="64" height="58" rx="5" fill={p.body} style={EDGE} />
      <rect x="18" y="32" width="64" height="12" rx="4" fill={p.bodyR} style={EDGE} />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={24 + (i % 4) * 14} y={50 + Math.floor(i / 4) * 12} width="9" height="7" rx="1" fill="none" strokeWidth="0.7" style={ENGRAVE} />
      ))}
    </g>
  );
}

function nwComeback({ p }: DesignInput): ReactNode {
  return (
    <g>
      <path d="M6 30 H94" strokeWidth="1" strokeDasharray="4 3" style={ENGRAVE} />
      <path d="M8 34 C 20 30, 26 40, 34 66 S 50 84, 60 60 S 74 26, 88 14" fill="none" strokeWidth="9" strokeLinecap="round" stroke={p.body} />
      <path d="M8 34 C 20 30, 26 40, 34 66 S 50 84, 60 60 S 74 26, 88 14" fill="none" strokeWidth="1" strokeLinecap="round" style={ENGRAVE} />
      <polygon points="80,8 96,8 92,24" fill={p.face} style={EDGE} />
      <path d="M6 92 H94" strokeWidth="1.2" style={ENGRAVE} />
    </g>
  );
}

// ------------------------------------------------------------------ Roth

function rothShield({ step, p }: DesignInput): ReactNode {
  return (
    <g>
      <path d={shieldPath(50, 8, 64)} fill={p.face} style={EDGE} />
      <path d={shieldPath(50, 14, 52)} fill="none" strokeWidth="0.8" style={ENGRAVE} />
      {letter('R', 50, 60, 38)}
      {step === 2 && <path d="M30 76 Q50 86 70 76" fill="none" strokeWidth="1.6" strokeDasharray="3 3" style={ENGRAVE} />}
      {step === 3 && <path d="M50 70 L53 77 L60 78 L55 83 L56 90 L50 86 L44 90 L45 83 L40 78 L47 77 Z" fill={p.hi} style={EDGE} />}
    </g>
  );
}

const SHIELD_COUNT: Record<number, number> = { 2: 2, 3: 5, 4: 10, 5: 15, 6: 20 };

function rothShields({ step, p }: DesignInput): ReactNode {
  const n = SHIELD_COUNT[step] ?? 2;
  const perRow = n <= 2 ? 2 : 5;
  const rows = Math.ceil(n / perRow);
  const w = n <= 2 ? 36 : n <= 5 ? 18 : 15;
  const out: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / perRow);
    const c = i % perRow;
    const cx = 50 + (c - (perRow - 1) / 2) * (w + 2);
    const top = 50 - (rows * (w * 1.18 + 4)) / 2 + r * (w * 1.18 + 4);
    out.push(<path key={i} d={shieldPath(cx, top, w)} fill={p.face} style={EDGE} />);
  }
  return <g>{out}</g>;
}

/** A round vault door marked "R"; `step` makes it heavier (more bolts, a thicker ring). */
function vaultDoor(cx: number, cy: number, r: number, step: number, p: Paint, sx = 1): ReactNode {
  const bolts = 6 + step * 2;
  return (
    <g transform={`translate(${cx} ${cy}) scale(${sx} 1)`}>
      <circle r={r} fill={p.bodyR} style={EDGE} />
      <circle r={r - 3 - step * 0.8} fill={p.face} style={EDGE} />
      {Array.from({ length: bolts }, (_, i) => {
        const a = (i / bolts) * Math.PI * 2;
        return <circle key={i} cx={Math.cos(a) * (r - 1.6 - step * 0.4)} cy={Math.sin(a) * (r - 1.6 - step * 0.4)} r={1.1 + step * 0.15} fill={p.hi} style={EDGE} />;
      })}
      {Array.from({ length: 3 }, (_, i) => (
        <path key={i} d={`M0 0 L${Math.cos((i * 2 * Math.PI) / 3) * r * 0.55} ${Math.sin((i * 2 * Math.PI) / 3) * r * 0.55}`} strokeWidth="3" strokeLinecap="round" stroke={p.bodyR} />
      ))}
      <circle r={r * 0.24} fill={p.body} style={EDGE} />
      {letter('R', 0, r * 0.13, r * 0.36)}
    </g>
  );
}

function rothVault({ step, p }: DesignInput): ReactNode {
  return <g>{vaultDoor(50, 50, 40, step, p)}</g>;
}

function rothVaultOpen({ step, p }: DesignInput): ReactNode {
  const open = Math.min(6, Math.max(1, step));
  const sx = 1 - open * 0.12; // the door turns away as it opens
  return (
    <g>
      <circle cx="50" cy="50" r="40" fill={p.bodyR} style={EDGE} />
      <circle cx="50" cy="50" r="34" fill="var(--tr-obsidian)" />
      <circle cx="50" cy="50" r="34" fill={p.glow} style={{ opacity: 0.25 + open * 0.12 }} />
      {flatCoin('a', 50, 62, 12, p)}
      {flatCoin('b', 50, 56, 12, p)}
      {vaultDoor(50 - 40 * (1 - sx) - 6, 50, 38, Math.min(5, open), p, sx)}
    </g>
  );
}

function rothSeed({ p }: DesignInput): ReactNode {
  return (
    <g>
      <path d={shieldPath(50, 6, 72)} fill={p.bodyR} style={EDGE} />
      <path d={shieldPath(50, 12, 60)} fill={p.face} style={EDGE} />
      <path d="M50 80 C 50 66, 48 56, 50 44" fill="none" strokeWidth="3" strokeLinecap="round" stroke={p.lo} />
      <path d="M50 54 C 40 52, 34 44, 34 36 C 44 36, 50 44, 50 54 Z" fill={p.hi} style={EDGE} />
      <path d="M50 48 C 58 44, 66 38, 68 30 C 58 30, 52 38, 50 48 Z" fill={p.hi} style={EDGE} />
      <ellipse cx="50" cy="82" rx="8" ry="5" fill={p.body} style={EDGE} />
    </g>
  );
}

// ------------------------------------------------------------------ Investing (Round 2): trees and growth

/** A tree standing on (cx, base): trunk height h, canopy radius r. `gold` adds gold leaves. */
function tree(key: string | number, cx: number, base: number, h: number, r: number, p: Paint, gold = false, ancient = false): ReactNode {
  const tw = ancient ? r * 0.42 : Math.max(2.4, r * 0.22);
  const top = base - h;
  return (
    <g key={key}>
      {ancient && (
        <path
          d={`M${cx - tw * 1.7} ${base} C ${cx - tw} ${base - 4}, ${cx - tw / 2} ${base - 8}, ${cx - tw / 2} ${base - 14} M${cx + tw * 1.7} ${base} C ${cx + tw} ${base - 4}, ${cx + tw / 2} ${base - 8}, ${cx + tw / 2} ${base - 14}`}
          fill="none"
          strokeWidth="2.4"
          strokeLinecap="round"
          stroke={p.bodyR}
        />
      )}
      <path d={`M${cx - tw / 2} ${base} L${cx - tw / 3} ${top} H${cx + tw / 3} L${cx + tw / 2} ${base} Z`} fill={p.bodyR} style={EDGE} />
      <circle cx={cx - r * 0.55} cy={top + r * 0.15} r={r * 0.62} fill={p.body} style={EDGE} />
      <circle cx={cx + r * 0.55} cy={top + r * 0.15} r={r * 0.62} fill={p.body} style={EDGE} />
      <circle cx={cx} cy={top - r * 0.35} r={r * 0.75} fill={p.face} style={EDGE} />
      {gold &&
        [
          [-0.6, 0],
          [0.5, -0.1],
          [0, -0.6],
          [-0.2, 0.2],
          [0.7, 0.35],
          [-0.75, 0.4],
        ].map(([dx, dy], i) => <circle key={i} cx={cx + dx! * r} cy={top + dy! * r} r={r * 0.13} style={{ fill: 'var(--tr-gold-hi)', stroke: 'var(--tr-gold-lo)', strokeWidth: 0.5 }} />)}
    </g>
  );
}

/** A straight metal rod from (x1, y1) to (x2, y2). Drawn as a thin bar: a gradient paint cannot fill a perfectly straight
 *  stroked line (its box has no width or height), so the line would vanish. */
function rod(key: string | number, x1: number, y1: number, x2: number, y2: number, w: number, fill: string): ReactNode {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const a = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return <rect key={key} x={0} y={-w / 2} width={len} height={w} rx={w / 2} fill={fill} transform={`translate(${x1} ${y1}) rotate(${a})`} style={EDGE} />;
}

function ground(y = 90): ReactNode {
  return <path d={`M8 ${y} H92`} strokeWidth="1.2" style={ENGRAVE} />;
}

function sprout(cx: number, base: number, size: number, p: Paint): ReactNode {
  return (
    <g>
      <path d={`M${cx} ${base} C ${cx} ${base - size * 0.5}, ${cx - 1} ${base - size * 0.8}, ${cx} ${base - size}`} fill="none" strokeWidth={Math.max(1.6, size * 0.08)} strokeLinecap="round" stroke={p.lo} />
      <path d={`M${cx} ${base - size * 0.62} C ${cx - size * 0.5} ${base - size * 0.66}, ${cx - size * 0.7} ${base - size}, ${cx - size * 0.72} ${base - size * 1.1} C ${cx - size * 0.3} ${base - size * 1.08}, ${cx} ${base - size * 0.9}, ${cx} ${base - size * 0.62} Z`} fill={p.hi} style={EDGE} />
      <path d={`M${cx} ${base - size * 0.8} C ${cx + size * 0.4} ${base - size * 0.86}, ${cx + size * 0.66} ${base - size * 1.16}, ${cx + size * 0.7} ${base - size * 1.28} C ${cx + size * 0.3} ${base - size * 1.26}, ${cx} ${base - size * 1.06}, ${cx} ${base - size * 0.8} Z`} fill={p.hi} style={EDGE} />
    </g>
  );
}

function invTrees({ step, p, caption }: DesignInput): ReactNode {
  switch (step) {
    case 1: // a sapling
      return (
        <g>
          {ground(88)}
          <ellipse cx="50" cy="88" rx="16" ry="4" fill={p.bodyR} style={EDGE} />
          {sprout(50, 86, 44, p)}
        </g>
      );
    case 2: // a young tree
      return <g>{ground()}{tree(0, 50, 90, 30, 18, p)}</g>;
    case 3: // a full tree
      return <g>{ground()}{tree(0, 50, 90, 34, 28, p)}</g>;
    case 4: // a tree with gold leaves
      return <g>{ground()}{tree(0, 50, 90, 34, 28, p, true)}</g>;
    case 5: // three trees
      return <g>{ground()}{tree(0, 24, 90, 22, 15, p)}{tree(1, 76, 90, 22, 15, p)}{tree(2, 50, 90, 32, 21, p)}</g>;
    case 6: // a small forest
      return (
        <g>
          {ground()}
          {tree(0, 16, 86, 18, 11, p)}
          {tree(1, 84, 86, 18, 11, p)}
          {tree(2, 34, 90, 24, 15, p)}
          {tree(3, 66, 90, 24, 15, p)}
          {tree(4, 50, 92, 32, 19, p, true)}
        </g>
      );
    case 7: // an ancient tree
      return (
        <g>
          {ground(94)}
          {tree(0, 50, 94, 34, 40, p, true, true)}
        </g>
      );
    default: // inside the Arc40 ring (the ring itself comes with the rank)
      return (
        <g>
          {tree(0, 50, 80, 28, 22, p, true)}
          {caption && letter(caption, 50, 95, 11)}
        </g>
      );
  }
}

/** Compounding: a sprout out of a coin, then a snowball rolling downhill that gets bigger at each step. */
function invSnowball({ step, p }: DesignInput): ReactNode {
  if (step <= 1)
    return (
      <g>
        {flatCoin('c', 50, 74, 26, p)}
        {sprout(50, 72, 40, p)}
      </g>
    );
  const r = 8 + step * 3.4; // step 2..7 -> 14.8 .. 31.8
  const t = (step - 2) / 5; // further down the hill as it grows
  const cx = 30 + t * 30;
  const cy = 16 + cx * 0.62 - r * 0.9;
  return (
    <g>
      <path d="M4 14 L96 72 V96 H4 Z" fill={p.bodyR} style={EDGE} />
      <path d="M4 14 L96 72" strokeWidth="1.2" style={ENGRAVE} />
      {Array.from({ length: 3 }, (_, i) => (
        <path key={i} d={`M${cx - r - 8 - i * 7} ${cy + r * 0.3 - i * 4.3} h-6`} strokeWidth="1" strokeLinecap="round" style={ENGRAVE} />
      ))}
      <circle cx={cx} cy={cy} r={r} fill={p.face} style={EDGE} />
      {/* a rolling spiral (how compounding builds on itself) and a few frost specks */}
      <path
        d={`M${cx} ${cy} m${r * 0.12} 0 a${r * 0.12} ${r * 0.12} 0 1 0 ${-r * 0.24} 0 a${r * 0.3} ${r * 0.3} 0 1 0 ${r * 0.54} 0 a${r * 0.5} ${r * 0.5} 0 1 0 ${-r * 0.92} 0 a${r * 0.7} ${r * 0.7} 0 1 0 ${r * 1.32} 0`}
        fill="none"
        strokeWidth="0.9"
        style={ENGRAVE}
      />
      {[
        [-0.55, -0.55],
        [0.6, -0.45],
        [0.5, 0.6],
      ].map(([dx, dy], i) => (
        <circle key={i} cx={cx + dx! * r} cy={cy + dy! * r} r={Math.max(1, r * 0.07)} fill={p.hi} />
      ))}
    </g>
  );
}

/** One chain link at (x, y), turned by `a` degrees. */
function link(key: string | number, x: number, y: number, a: number, len: number, p: Paint): ReactNode {
  return (
    <g key={key} transform={`translate(${x} ${y}) rotate(${a})`}>
      <rect x={-len / 2} y={-len * 0.3} width={len} height={len * 0.6} rx={len * 0.3} fill="none" strokeWidth={len * 0.22} stroke={p.body} />
      <rect x={-len / 2} y={-len * 0.3} width={len} height={len * 0.6} rx={len * 0.3} fill="none" strokeWidth="0.6" style={ENGRAVE} />
    </g>
  );
}

function chainRing(cx: number, cy: number, r: number, n: number, of: number, len: number, p: Paint, key: string): ReactNode[] {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 - Math.PI * 0.75 + (i / of) * Math.PI * 2;
    return link(`${key}${i}`, cx + Math.cos(a) * r, cy + Math.sin(a) * r, (a * 180) / Math.PI + 90, len, p);
  });
}

/** A chain that gains links and closes into a full ring at 12 months. */
function invChain({ step, p }: DesignInput): ReactNode {
  if (step <= 1) return <g>{chainRing(50, 52, 34, 6, 12, 16, p, 'a')}</g>; // 6 links: half a ring
  const out = chainRing(50, 50, 36, 12, 12, 17, p, 'a');
  if (step >= 3) out.push(...chainRing(50, 50, 20, step >= 4 ? 8 : 6, 8, 12, p, 'b'));
  if (step >= 4) out.push(<circle key="core" cx="50" cy="50" r={step >= 5 ? 9 : 6} fill={p.face} style={EDGE} />);
  if (step >= 5) out.push(<circle key="core2" cx="50" cy="50" r="4" fill={p.trim} style={EDGE} />);
  return <g>{out}</g>;
}

function invSeedling({ p }: DesignInput): ReactNode {
  return (
    <g>
      <path d="M18 90 C 26 74, 74 74, 82 90 Z" fill={p.bodyR} style={EDGE} />
      {sprout(50, 80, 50, p)}
    </g>
  );
}

/** A balance beam on a post, tipped `tilt` degrees (positive = the left pan lower). */
function scale(tilt: number, left: ReactNode, right: ReactNode, p: Paint): ReactNode {
  const rad = (tilt * Math.PI) / 180;
  const lx = 50 - Math.cos(rad) * 36;
  const ly = 22 + Math.sin(rad) * 36;
  const rx = 50 + Math.cos(rad) * 36;
  const ry = 22 - Math.sin(rad) * 36;
  const pan = (x: number, y: number, k: string, load: ReactNode) => (
    <g key={k}>
      <path d={`M${x} ${y} L${x - 12} ${y + 26} M${x} ${y} L${x + 12} ${y + 26}`} strokeWidth="0.8" style={ENGRAVE} />
      <g transform={`translate(${x} ${y + 26})`}>{load}</g>
      <path d={`M${x - 15} ${y + 26} H${x + 15} C ${x + 12} ${y + 33}, ${x - 12} ${y + 33}, ${x - 15} ${y + 26} Z`} fill={p.body} style={EDGE} />
    </g>
  );
  return (
    <g>
      {rod('post', 50, 22, 50, 88, 4, p.bodyR)}
      <path d="M34 92 H66 L60 86 H40 Z" fill={p.body} style={EDGE} />
      {rod('beam', lx, ly, rx, ry, 3.2, p.body)}
      <circle cx="50" cy="22" r="4" fill={p.face} style={EDGE} />
      {pan(lx, ly, 'l', left)}
      {pan(rx, ry, 'r', right)}
    </g>
  );
}

/** A small rising chart drawn above (0, 0). */
function miniChart(p: Paint, w = 22): ReactNode {
  return (
    <g>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={-w / 2 + i * (w / 3) + 1} y={-(6 + i * 6)} width={w / 3 - 2} height={6 + i * 6} fill={p.face} style={EDGE} />
      ))}
      <path d={`M${-w / 2} -6 L${w / 2} -22`} strokeWidth="1.4" strokeLinecap="round" stroke={p.lo} />
    </g>
  );
}

function invScaleChart({ p }: DesignInput): ReactNode {
  const cash = (
    <g>
      {[0, 1].map((i) => (
        <rect key={i} x={-9 + i * 2} y={-5 - i * 4} width="16" height="4" rx="0.8" fill={p.face} style={EDGE} />
      ))}
    </g>
  );
  return scale(14, miniChart(p), cash, p);
}

function invScaleReceipt({ p }: DesignInput): ReactNode {
  const receipt = (
    <g>
      <path d="M-8 -20 H8 V-2 L5 0 L2 -2 L-1 0 L-4 -2 L-8 0 Z" fill={p.face} style={EDGE} />
      {[0, 1, 2].map((i) => (
        <path key={i} d={`M-5 ${-16 + i * 4.5} H5`} strokeWidth="0.7" style={ENGRAVE} />
      ))}
    </g>
  );
  return scale(16, miniChart(p, 26), receipt, p);
}

function invBars({ p }: DesignInput): ReactNode {
  return (
    <g>
      {ground(88)}
      <rect x="20" y="58" width="22" height="30" rx="2" fill={p.bodyR} style={EDGE} />
      <rect x="56" y="22" width="22" height="66" rx="2" fill={p.face} style={EDGE} />
      {letter('IN', 31, 78, 9)}
      <polygon points="67,6 77,18 57,18" fill={p.hi} style={EDGE} />
    </g>
  );
}

function invAnchor({ p }: DesignInput): ReactNode {
  return (
    <g>
      <circle cx="50" cy="16" r="6" fill="none" strokeWidth="3.4" stroke={p.body} />
      {rod('shaft', 50, 21, 50, 76, 5.4, p.body)}
      {rod('stock', 36, 32, 64, 32, 4.4, p.bodyR)}
      <path d="M24 56 C 26 72, 38 78, 50 78 C 62 78, 74 72, 76 56" fill="none" strokeWidth="5" strokeLinecap="round" stroke={p.body} />
      <polygon points="18,58 30,52 28,64" fill={p.face} style={EDGE} />
      <polygon points="82,58 70,52 72,64" fill={p.face} style={EDGE} />
      {[0, 1].map((i) => (
        <path
          key={i}
          d={`M4 ${84 + i * 8} q 8 -7 16 0 t 16 0 t 16 0 t 16 0 t 16 0 t 16 0`}
          fill="none"
          strokeWidth={i ? 1.6 : 2.4}
          strokeLinecap="round"
          stroke={i ? p.lo : p.hi}
        />
      ))}
    </g>
  );
}

function invCircles({ p }: DesignInput): ReactNode {
  return (
    <g>
      <circle cx="36" cy="40" r="22" fill={p.body} fillOpacity="0.85" style={EDGE} />
      <circle cx="64" cy="40" r="22" fill={p.face} fillOpacity="0.85" style={EDGE} />
      <circle cx="50" cy="64" r="22" fill={p.bodyR} fillOpacity="0.85" style={EDGE} />
      <circle cx="50" cy="48" r="5" fill={p.hi} style={EDGE} />
    </g>
  );
}

function invLightning({ p }: DesignInput): ReactNode {
  return (
    <g>
      {ground(90)}
      <path d="M8 84 L28 74 L42 78 L60 60 L74 64 L92 44" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" stroke={p.bodyR} />
      <polygon points="56,4 30,48 48,48 40,86 72,36 54,36 66,4" fill={p.face} style={EDGE} />
      <polygon points="56,4 66,4 54,36 48,36" fill={p.hi} />
    </g>
  );
}

// ------------------------------------------------------------------ Refereeing (Round 2): whistles, flags and stripes

/** A whistle, mouthpiece to the left; (cx, cy) is the round chamber, s its scale. */
function whistle(cx: number, cy: number, s: number, p: Paint, ring = true): ReactNode {
  return (
    <g transform={`translate(${cx} ${cy}) scale(${s})`}>
      {ring && <circle cx="14" cy="-14" r="5" fill="none" strokeWidth="2.2" stroke={p.bodyR} />}
      <path d="M-34 -9 H-6 V5 H-34 C -37 5, -38 3, -38 -2 C -38 -7, -37 -9, -34 -9 Z" fill={p.body} style={EDGE} />
      <rect x="-14" y="-12" width="9" height="5" rx="1" fill={p.bodyR} style={EDGE} />
      <circle cx="4" cy="2" r="14" fill={p.face} style={EDGE} />
      <circle cx="4" cy="2" r="8" fill="none" strokeWidth="0.7" style={ENGRAVE} />
      <circle cx="-1" cy="-3" r="2.6" fill={p.hi} />
    </g>
  );
}

/** A linesman's flag: pole from (x, y) up `h`, the cloth split on the diagonal. */
function flag(key: string, x: number, y: number, h: number, angle: number, p: Paint): ReactNode {
  return (
    <g key={key} transform={`rotate(${angle} ${x} ${y})`}>
      {rod('pole', x, y, x, y - h, 2.8, p.bodyR)}
      <rect x={x} y={y - h} width={h * 0.5} height={h * 0.38} fill={p.face} style={EDGE} />
      <polygon points={`${x},${y - h} ${x + h * 0.5},${y - h} ${x},${y - h * 0.62}`} fill={p.trim} style={EDGE} />
    </g>
  );
}

/** A striped referee jersey centred on (50, cy). */
function jersey(cy: number, s: number, p: Paint, crest = false): ReactNode {
  const path = 'M-14 -22 L-30 -14 L-38 2 L-28 8 L-22 -2 L-22 26 H22 L22 -2 L28 8 L38 2 L30 -14 L14 -22 C 10 -16, -10 -16, -14 -22 Z';
  return (
    <g transform={`translate(50 ${cy}) scale(${s})`}>
      <path d={path} fill={p.face} />
      {/* stripes inside the body only (no clip path: ids would repeat across trophies on one page) */}
      {[-19, -7, 5, 16].map((x) => (
        <rect key={x} x={x} y="-15" width="6" height="41" style={{ fill: 'var(--tr-obsidian)' }} />
      ))}
      <path d={path} fill="none" style={EDGE} />
      <path d="M-14 -22 C -10 -14, 10 -14, 14 -22" fill="none" strokeWidth="1.6" stroke={p.body} />
      {crest && (
        <g>
          <path d={shieldPath(10, -10, 11)} fill={p.body} style={EDGE} />
          <path d="M10 -6 L11.5 -3 L14.5 -2.7 L12.2 -0.6 L12.9 2.4 L10 0.9 L7.1 2.4 L7.8 -0.6 L5.5 -2.7 L8.5 -3 Z" fill={p.hi} />
        </g>
      )}
    </g>
  );
}

function refWhistle({ step, p }: DesignInput): ReactNode {
  switch (step) {
    case 1: // a whistle
      return <g>{whistle(56, 52, 1.15, p)}</g>;
    case 2: // a whistle and a flag
      return <g>{flag('f', 24, 92, 64, -8, p)}{whistle(62, 66, 0.9, p)}</g>;
    case 3: // crossed flags
      return <g>{flag('a', 30, 92, 72, 22, p)}{flag('b', 70, 92, 72, -22, p)}</g>;
    case 4: // a striped ref jersey
      return <g>{jersey(52, 1.15, p)}</g>;
    case 5: // a jersey with a crest
      return <g>{jersey(52, 1.15, p, true)}</g>;
    default: // a golden whistle on a stand
      return (
        <g>
          <path d="M28 94 H72 L66 84 H34 Z" fill={p.bodyR} style={EDGE} />
          <path d="M44 84 L47 64 H53 L56 84 Z" fill={p.body} style={EDGE} />
          {rod('bar', 34, 62, 66, 62, 2.4, p.bodyR)}
          {whistle(56, 44, 1.05, p)}
        </g>
      );
  }
}

/** A whistle with the month's amount on its cord. */
function refCord({ step, p, caption }: DesignInput): ReactNode {
  return (
    <g>
      <path d="M68 34 C 92 50, 88 86, 50 90 C 14 92, 6 60, 22 42" fill="none" strokeWidth={2 + step} strokeLinecap="round" stroke={p.bodyR} />
      <path d="M68 34 C 92 50, 88 86, 50 90 C 14 92, 6 60, 22 42" fill="none" strokeWidth="0.6" strokeDasharray="2 2" style={ENGRAVE} />
      {whistle(54, 30, 0.9, p)}
      <rect x="32" y="78" width="36" height="18" rx="4" fill={p.face} style={EDGE} />
      {letter(caption ?? '', 50, 91.5, 11)}
    </g>
  );
}

/** A scorecard filling with checks: 6, 12, then 24. */
function refScorecard({ step, p }: DesignInput): ReactNode {
  const n = step <= 1 ? 6 : step === 2 ? 12 : 24;
  const cols = n === 24 ? 6 : n === 12 ? 4 : 3;
  const rows = n / cols;
  const cw = 62 / cols;
  const ch = 58 / rows;
  return (
    <g>
      <rect x="16" y="10" width="68" height="84" rx="5" fill={p.face} style={EDGE} />
      <rect x="16" y="10" width="68" height="14" rx="4" fill={p.bodyR} style={EDGE} />
      <path d="M40 17 H60" strokeWidth="1.4" style={ENGRAVE} />
      {Array.from({ length: n }, (_, i) => {
        const x = 19 + (i % cols) * cw;
        const y = 30 + Math.floor(i / cols) * ch;
        return (
          <g key={i}>
            <rect x={x} y={y} width={cw - 3} height={ch - 3} rx="1" fill="none" strokeWidth="0.6" style={ENGRAVE} />
            <path d={`M${x + cw * 0.18} ${y + ch * 0.48} L${x + cw * 0.4} ${y + ch * 0.68} L${x + cw * 0.72} ${y + ch * 0.2}`} fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" stroke={p.lo} />
          </g>
        );
      })}
    </g>
  );
}

function refCalendar({ p }: DesignInput): ReactNode {
  return (
    <g>
      <rect x="12" y="12" width="62" height="70" rx="5" fill={p.body} style={EDGE} />
      <rect x="12" y="12" width="62" height="14" rx="4" fill={p.bodyR} style={EDGE} />
      {[24, 62].map((x) => (
        <rect key={x} x={x} y="6" width="4" height="12" rx="1.5" fill={p.face} style={EDGE} />
      ))}
      {Array.from({ length: 15 }, (_, i) => (
        <rect key={i} x={17 + (i % 5) * 11} y={32 + Math.floor(i / 5) * 12} width="8" height="7" rx="1" fill="none" strokeWidth="0.7" style={ENGRAVE} />
      ))}
      {whistle(66, 72, 0.72, p)}
    </g>
  );
}

function refJerseyCrown({ p }: DesignInput): ReactNode {
  return (
    <g>
      <polygon points="30,24 35,8 44,18 50,4 56,18 65,8 70,24" fill={p.face} style={EDGE} />
      {rod('band', 30, 24, 70, 24, 2.4, p.bodyR)}
      {jersey(62, 1, p)}
    </g>
  );
}

function refWhistleArrow({ p }: DesignInput): ReactNode {
  return (
    <g>
      {ground(92)}
      {arrow(0, 14, 82, 74, p)}
      {whistle(48, 74, 0.8, p)}
    </g>
  );
}

function refCap({ p }: DesignInput): ReactNode {
  return (
    <g>
      <path d="M18 62 C 18 30, 82 30, 82 62 Z" fill={p.body} style={EDGE} />
      <path d="M50 30 V62 M34 36 C 40 46, 40 56, 38 62 M66 36 C 60 46, 60 56, 62 62" fill="none" strokeWidth="0.7" style={ENGRAVE} />
      <circle cx="50" cy="30" r="3" fill={p.bodyR} style={EDGE} />
      <path d="M14 62 H86 C 92 62, 96 70, 88 74 C 70 80, 30 80, 12 74 C 6 70, 8 62, 14 62 Z" fill={p.bodyR} style={EDGE} />
      <rect x="34" y="40" width="32" height="18" rx="3" fill={p.face} style={EDGE} />
      {letter('10x', 50, 54, 13)}
    </g>
  );
}

function refRoof({ p }: DesignInput): ReactNode {
  return (
    <g>
      <polygon points="50,8 94,46 84,46 50,18 16,46 6,46" fill={p.face} style={EDGE} />
      <path d="M22 44 V90 H78 V44" fill="none" strokeWidth="2.4" stroke={p.bodyR} />
      <rect x="66" y="16" width="8" height="16" fill={p.bodyR} style={EDGE} />
      {ground(90)}
      {whistle(56, 70, 0.78, p)}
    </g>
  );
}

/** Statuette designs stand on the base: moves a drawing down so its lowest part reaches y = 98 of its box. */
function standing(f: (d: DesignInput) => ReactNode, dy: number) {
  return (d: DesignInput): ReactNode => <g transform={`translate(0 ${dy})`}>{f(d)}</g>;
}

// ------------------------------------------------------------------ registry

// ------------------------------------------------------------------ Emergency fund and savings (Round 3): umbrellas and jars

/** An umbrella: canopy centred on cx with its top at `top`, width w, handle down to `bottom`. */
function umbrella(cx: number, top: number, w: number, bottom: number, p: Paint): ReactNode {
  const l = cx - w / 2;
  const r = cx + w / 2;
  const rim = top + w * 0.36;
  const sc = w / 4; // four scallops along the rim
  const scallops = [0, 1, 2, 3].map((i) => `Q ${r - sc * i - sc / 2} ${rim - w * 0.06}, ${r - sc * (i + 1)} ${rim}`).join(' ');
  return (
    <g>
      {rod('shaft', cx, top + 2, cx, bottom - 4, Math.max(1.8, w * 0.04), p.bodyR)}
      <path d={`M${cx} ${bottom - 4} C ${cx} ${bottom + 2}, ${cx - w * 0.14} ${bottom + 2}, ${cx - w * 0.14} ${bottom - 3}`} fill="none" strokeWidth={Math.max(1.8, w * 0.04)} strokeLinecap="round" stroke={p.lo} />
      <path d={`M${l} ${rim} C ${l} ${top + w * 0.06}, ${r} ${top + w * 0.06}, ${r} ${rim} ${scallops} Z`} fill={p.face} style={EDGE} />
      <path d={`M${cx} ${top + w * 0.02} C ${cx - w * 0.2} ${top + w * 0.12}, ${cx - w * 0.24} ${rim - 4}, ${cx - w * 0.25} ${rim - 1}`} fill="none" strokeWidth="0.7" style={ENGRAVE} />
      <path d={`M${cx} ${top + w * 0.02} C ${cx + w * 0.2} ${top + w * 0.12}, ${cx + w * 0.24} ${rim - 4}, ${cx + w * 0.25} ${rim - 1}`} fill="none" strokeWidth="0.7" style={ENGRAVE} />
      <circle cx={cx} cy={top + 1} r={Math.max(1.4, w * 0.03)} fill={p.hi} />
    </g>
  );
}

/** Rain drops: `n` small drops in a seeded spread over the top band of the box. */
function rain(n: number, p: Paint, y0 = 4, y1 = 26): ReactNode {
  return Array.from({ length: n }, (_, i) => {
    const x = 10 + ((i * 37) % 80);
    const y = y0 + ((i * 23) % Math.max(1, y1 - y0));
    return <path key={`d${i}`} d={`M${x} ${y} c -2.6 4.2, -2.6 6.8, 0 6.8 c 2.6 0, 2.6 -2.6, 0 -6.8 Z`} fill={p.lo} style={EDGE} />;
  });
}

function emUmbrella({ step, p }: DesignInput): ReactNode {
  const house = (window: boolean) => (
    <g>
      <path d="M30 94 V68 L50 52 L70 68 V94 Z" fill={p.body} style={EDGE} />
      <rect x="44" y="76" width="12" height="18" fill={p.bodyR} style={EDGE} />
      {window && <rect x="58" y="68" width="8" height="7" fill={p.hi} />}
    </g>
  );
  switch (step) {
    case 1: // light rain
      return <g>{rain(3, p)}{umbrella(50, 26, 62, 90, p)}</g>;
    case 2: // steady rain
      return <g>{rain(6, p)}{umbrella(50, 24, 72, 92, p)}</g>;
    case 3: // a big umbrella over a small house
      return <g>{rain(7, p, 2, 10)}{umbrella(50, 16, 84, 94, p)}{house(false)}</g>;
    case 4: // heavy rain, the house kept dry
      return <g>{rain(11, p, 0, 8)}{umbrella(50, 14, 92, 94, p)}{house(true)}</g>;
    default: // a storm: lightning and rain, the house safe under the umbrella
      return (
        <g>
          {rain(12, p, 0, 8)}
          <polygon points="14,0 4,20 12,20 6,36 22,12 14,12 20,0" fill={p.hi} style={EDGE} />
          <polygon points="88,0 78,20 86,20 80,34 96,12 88,12 94,0" fill={p.hi} style={EDGE} />
          {umbrella(50, 16, 92, 94, p)}
          {house(true)}
        </g>
      );
  }
}

/** An arc of the ring around (50, 50), radius r, from the top clockwise by `frac` of a turn. */
function ringArc(frac: number, r: number): string {
  if (frac >= 1) return `M50 ${50 - r} A ${r} ${r} 0 1 1 49.99 ${50 - r} Z`;
  const a = frac * 2 * Math.PI;
  const x = 50 + r * Math.sin(a);
  const y = 50 - r * Math.cos(a);
  return `M50 ${50 - r} A ${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
}

function emUmbrellaRing({ step, p }: DesignInput): ReactNode {
  const frac = Math.min(step, 3) / 3; // one third, two thirds, full
  return (
    <g>
      <circle cx="50" cy="50" r="42" fill="none" strokeWidth="6" style={{ stroke: 'var(--tr-engrave)', strokeOpacity: 0.35 }} />
      <path d={ringArc(frac, 42)} fill="none" strokeWidth="6" strokeLinecap="round" stroke={p.hi} />
      {umbrella(50, 20, 62, 82, p)}
    </g>
  );
}

/** A savings jar standing on `base`, centred on cx, filled `fill` (0..1) with coins. */
function jar(key: string | number, cx: number, base: number, w: number, h: number, fill: number, p: Paint): ReactNode {
  const top = base - h;
  const inner = Math.max(0, Math.min(1, fill)) * (h - 10);
  return (
    <g key={key}>
      <rect x={cx - w / 2} y={top + 6} width={w} height={h - 6} rx={w * 0.18} fill={p.face} style={EDGE} />
      {inner > 0 && <rect x={cx - w / 2 + 3} y={base - 3 - inner} width={w - 6} height={inner} rx={w * 0.12} fill={p.body} />}
      {inner > 0 && <path d={`M${cx - w / 2 + 4} ${base - 3 - inner} Q ${cx} ${base - 6 - inner}, ${cx + w / 2 - 4} ${base - 3 - inner}`} fill="none" strokeWidth="0.7" style={ENGRAVE} />}
      <rect x={cx - w * 0.36} y={top} width={w * 0.72} height="7" rx="2" fill={p.bodyR} style={EDGE} />
      <rect x={cx - w * 0.14} y={top + 2.6} width={w * 0.28} height="1.8" rx="0.9" style={{ fill: 'var(--tr-engrave)' }} />
      <path d={`M${cx - w / 2 + 4} ${top + 12} V${base - 8}`} strokeWidth="1.2" strokeLinecap="round" style={{ stroke: 'var(--tr-sheen)' }} />
    </g>
  );
}

function emJars({ step, p }: DesignInput): ReactNode {
  switch (step) {
    case 1:
      return <g>{jar('a', 50, 94, 54, 80, 0.34, p)}</g>;
    case 2:
      return <g>{jar('a', 50, 94, 56, 82, 0.67, p)}</g>;
    case 3:
      return <g>{jar('a', 50, 94, 58, 84, 1, p)}</g>;
    case 4: // two jars
      return <g>{jar('a', 29, 92, 40, 72, 1, p)}{jar('b', 71, 92, 40, 72, 0.75, p)}</g>;
    default: // a row of jars
      return <g>{jar('a', 18, 90, 30, 60, 1, p)}{jar('b', 50, 94, 34, 72, 1, p)}{jar('c', 82, 90, 30, 60, 1, p)}</g>;
  }
}

/** A four-point sparkle. */
function sparkle(key: string | number, x: number, y: number, s: number, p: Paint): ReactNode {
  return <polygon key={key} points={`${x},${y - s} ${x + s * 0.28},${y - s * 0.28} ${x + s},${y} ${x + s * 0.28},${y + s * 0.28} ${x},${y + s} ${x - s * 0.28},${y + s * 0.28} ${x - s},${y} ${x - s * 0.28},${y - s * 0.28}`} fill={p.hi} />;
}

/** A percent sign centred on (cx, cy). */
function percent(cx: number, cy: number, s: number, p: Paint): ReactNode {
  return (
    <g>
      <circle cx={cx - s * 0.5} cy={cy - s * 0.5} r={s * 0.24} fill="none" strokeWidth={s * 0.14} stroke={p.lo} />
      <circle cx={cx + s * 0.5} cy={cy + s * 0.5} r={s * 0.24} fill="none" strokeWidth={s * 0.14} stroke={p.lo} />
      {rod('slash', cx + s * 0.62, cy - s * 0.78, cx - s * 0.62, cy + s * 0.78, s * 0.16, p.bodyR)}
    </g>
  );
}

function emInterest({ step, p }: DesignInput): ReactNode {
  const spots: [number, number, number][] = [
    [14, 16, 8],
    [86, 18, 7],
    [87, 84, 8],
    [13, 84, 6],
  ];
  return (
    <g>
      <circle cx="50" cy="50" r="34" fill={p.face} style={EDGE} />
      <circle cx="50" cy="50" r="28" fill="none" strokeWidth="0.8" style={ENGRAVE} />
      {percent(50, 50, 20, p)}
      {spots.slice(0, Math.max(0, step - 1)).map(([x, y, sz], i) => sparkle(i, x, y, sz, p))}
      {step >= 5 && [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5].map((a) => <path key={a} d="M50 12 v-6" transform={`rotate(${a} 50 50)`} strokeWidth="1.4" style={ENGRAVE} />)}
    </g>
  );
}

function emRefill({ p }: DesignInput): ReactNode {
  // A drop with a circular arrow around it; the drop stands on the base.
  return (
    <g>
      <path d="M50 30 A 34 34 0 1 1 22 46" fill="none" strokeWidth="5" strokeLinecap="round" stroke={p.lo} />
      <polygon points="14,36 30,38 20,52" fill={p.body} style={EDGE} />
      <path d="M50 44 C 41 58, 34 67, 34 78 C 34 89, 41 97, 50 97 C 59 97, 66 89, 66 78 C 66 67, 59 58, 50 44 Z" fill={p.face} style={EDGE} />
      <path d="M42 80 C 42 73, 45 67, 47 63" fill="none" strokeWidth="2" strokeLinecap="round" stroke={p.hi} />
    </g>
  );
}

// ------------------------------------------------------------------ Spending habits (Round 3): flames, jars, targets and scissors

/** A flame standing on (cx, base), height h. */
function flame(key: string | number, cx: number, base: number, h: number, p: Paint): ReactNode {
  const w = h * 0.42;
  return (
    <g key={key}>
      {/* outer flame with a tongue on each side */}
      <path
        d={`M${cx} ${base - h} C ${cx + w * 0.15} ${base - h * 0.78}, ${cx + w * 0.55} ${base - h * 0.7}, ${cx + w * 0.5} ${base - h * 0.5} C ${cx + w * 0.78} ${base - h * 0.6}, ${cx + w * 0.82} ${base - h * 0.72}, ${cx + w * 0.78} ${base - h * 0.82} C ${cx + w * 1.2} ${base - h * 0.55}, ${cx + w * 1.15} ${base - h * 0.15}, ${cx + w * 0.7} ${base - h * 0.02} C ${cx + w * 0.3} ${base + h * 0.04}, ${cx - w * 0.3} ${base + h * 0.04}, ${cx - w * 0.7} ${base - h * 0.02} C ${cx - w * 1.15} ${base - h * 0.15}, ${cx - w * 1.2} ${base - h * 0.5}, ${cx - w * 0.86} ${base - h * 0.74} C ${cx - w * 0.8} ${base - h * 0.6}, ${cx - w * 0.7} ${base - h * 0.52}, ${cx - w * 0.5} ${base - h * 0.48} C ${cx - w * 0.55} ${base - h * 0.68}, ${cx - w * 0.2} ${base - h * 0.8}, ${cx} ${base - h} Z`}
        fill={p.body}
        style={EDGE}
      />
      <path d={`M${cx} ${base - h * 0.6} C ${cx + w * 0.5} ${base - h * 0.4}, ${cx + w * 0.55} ${base - h * 0.08}, ${cx} ${base - h * 0.03} C ${cx - w * 0.55} ${base - h * 0.08}, ${cx - w * 0.5} ${base - h * 0.36}, ${cx} ${base - h * 0.6} Z`} fill={p.face} style={EDGE} />
      <path d={`M${cx} ${base - h * 0.34} C ${cx + w * 0.22} ${base - h * 0.22}, ${cx + w * 0.22} ${base - h * 0.06}, ${cx} ${base - h * 0.05} C ${cx - w * 0.22} ${base - h * 0.06}, ${cx - w * 0.22} ${base - h * 0.2}, ${cx} ${base - h * 0.34} Z`} fill={p.hi} />
    </g>
  );
}

function spFlame({ step, p }: DesignInput): ReactNode {
  const h = [56, 64, 72, 80, 80, 84][Math.min(step, 6) - 1]!;
  const embers = step >= 5 ? (step >= 6 ? 10 : 6) : 0;
  return (
    <g>
      {Array.from({ length: embers }, (_, i) => {
        const a = (Math.PI * (i + 0.5)) / embers + Math.PI;
        return <circle key={i} cx={50 + Math.cos(a) * 42} cy={58 + Math.sin(a) * 42} r={3.2} fill={p.hi} style={EDGE} />;
      })}
      {flame('f', 50, 94, h, p)}
    </g>
  );
}

const RATE_MONTH_STEPS = [20, 30, 50, 70];
const RATE_YEAR_STEPS = [25, 40, 50];

function spJar({ step, p }: DesignInput): ReactNode {
  const pctN = RATE_MONTH_STEPS[Math.min(step, 4) - 1]!;
  return (
    <g>
      {jar('a', 50, 94, 58, 84, pctN / 100, p)}
      <text x="50" y="58" textAnchor="middle" className="tr-letter" fontSize="19" style={{ fill: 'var(--tr-engrave)' }}>{`${pctN}%`}</text>
    </g>
  );
}

/** A calendar page: top left (x, y), width w, height h, with rings and a grid of days. */
function calendarPage(key: string, x: number, y: number, w: number, h: number, p: Paint): ReactNode {
  const rows = 3;
  const cols = 4;
  return (
    <g key={key}>
      <rect x={x} y={y} width={w} height={h} rx="3" fill={p.face} style={EDGE} />
      <rect x={x} y={y} width={w} height={h * 0.24} rx="3" fill={p.body} style={EDGE} />
      {rod(`${key}-r1`, x + w * 0.3, y - 3, x + w * 0.3, y + 4, 2.4, p.bodyR)}
      {rod(`${key}-r2`, x + w * 0.7, y - 3, x + w * 0.7, y + 4, 2.4, p.bodyR)}
      {Array.from({ length: rows * cols }, (_, i) => (
        <rect key={i} x={x + w * 0.12 + (i % cols) * (w * 0.2)} y={y + h * 0.36 + Math.floor(i / cols) * (h * 0.19)} width={w * 0.12} height={h * 0.1} rx="0.8" style={{ fill: 'var(--tr-engrave)', fillOpacity: 0.5 }} />
      ))}
    </g>
  );
}

function spJarCalendar({ step, p }: DesignInput): ReactNode {
  const pctN = RATE_YEAR_STEPS[Math.min(step, 3) - 1]!;
  return (
    <g>
      {calendarPage('cal', 6, 62, 88, 34, p)}
      {jar('a', 50, 72, 48, 66, pctN / 100, p)}
      <text x="50" y="46" textAnchor="middle" className="tr-letter" fontSize="15" style={{ fill: 'var(--tr-engrave)' }}>{`${pctN}%`}</text>
    </g>
  );
}

/** An arrow stuck in the target at (x, y), coming in at `angle` degrees. */
function targetArrow(key: string | number, x: number, y: number, angle: number, p: Paint): ReactNode {
  return (
    <g key={key} transform={`rotate(${angle} ${x} ${y})`}>
      {rod('shaft', x, y, x + 34, y, 2.2, p.bodyR)}
      <polygon points={`${x + 30},${y} ${x + 38},${y - 5} ${x + 40},${y - 5} ${x + 34},${y}`} fill={p.body} style={EDGE} />
      <polygon points={`${x + 30},${y} ${x + 38},${y + 5} ${x + 40},${y + 5} ${x + 34},${y}`} fill={p.body} style={EDGE} />
    </g>
  );
}

function crown(cx: number, top: number, w: number, p: Paint): ReactNode {
  const l = cx - w / 2;
  const h = w * 0.5;
  return (
    <g>
      <path d={`M${l} ${top + h} L${l} ${top + h * 0.3} L${l + w * 0.25} ${top + h * 0.6} L${cx} ${top} L${l + w * 0.75} ${top + h * 0.6} L${l + w} ${top + h * 0.3} L${l + w} ${top + h} Z`} fill={p.body} style={EDGE} />
      <circle cx={cx} cy={top + h * 0.72} r={w * 0.07} fill={p.hi} />
    </g>
  );
}

function spBullseye({ step, p }: DesignInput): ReactNode {
  const arrows = Math.min(3, step);
  const angles = [-30, -150, -90];
  const crowned = step >= 4;
  const cy = crowned ? 60 : 52;
  const r = crowned ? 36 : 42;
  return (
    <g>
      <circle cx="50" cy={cy} r={r} fill={p.face} style={EDGE} />
      <circle cx="50" cy={cy} r={r * 0.7} fill={p.body} style={EDGE} />
      <circle cx="50" cy={cy} r={r * 0.4} fill={p.face} style={EDGE} />
      <circle cx="50" cy={cy} r={r * 0.14} fill={p.hi} style={EDGE} />
      {angles.slice(0, arrows).map((a, i) => targetArrow(i, 50 + i * 1.5, cy - i, a, p))}
      {crowned && crown(50, 2, step >= 5 ? 38 : 30, p)}
    </g>
  );
}

/** Scissors, blades up and to the right, pivot at (44, 56). */
function scissors(p: Paint): ReactNode {
  return (
    <g>
      <polygon points="44,56 86,18 90,22 50,60" fill={p.body} style={EDGE} />
      <polygon points="44,56 88,40 88,46 48,62" fill={p.bodyR} style={EDGE} />
      <circle cx="28" cy="70" r="11" fill="none" strokeWidth="5" stroke={p.lo} />
      <circle cx="40" cy="82" r="9" fill="none" strokeWidth="5" stroke={p.lo} />
      {rod('h1', 35, 63, 45, 57, 4, p.bodyR)}
      {rod('h2', 43, 75, 47, 61, 4, p.bodyR)}
      <circle cx="46" cy="58" r="2.6" fill={p.hi} style={EDGE} />
    </g>
  );
}

function spScissors({ step, p }: DesignInput): ReactNode {
  // One more cut loop of ribbon per step, falling away from the blades.
  const loops: [number, number, number][] = [
    [76, 74, 0],
    [88, 56, 30],
    [60, 90, -20],
    [88, 90, 50],
  ];
  return (
    <g transform="translate(50 50) scale(1.18) translate(-50 -50)">
      {loops.slice(0, Math.min(step, 4)).map(([x, y, a], i) => (
        <g key={i} transform={`rotate(${a} ${x} ${y})`}>
          <path d={`M${x - 9} ${y + 2} C ${x - 10} ${y - 9}, ${x + 9} ${y - 10}, ${x + 9} ${y} C ${x + 9} ${y + 6}, ${x + 2} ${y + 7}, ${x + 1} ${y + 2}`} fill="none" strokeWidth="3.4" strokeLinecap="round" stroke={p.lo} />
          <path d={`M${x - 9} ${y + 2} l -3 4 M${x + 1} ${y + 2} l 3 4`} fill="none" strokeWidth="1.6" strokeLinecap="round" style={ENGRAVE} />
        </g>
      ))}
      {scissors(p)}
    </g>
  );
}

/** A small arrow pointing down, centred on cx. */
function downArrow(cx: number, top: number, h: number, p: Paint): ReactNode {
  return (
    <g>
      {rod('stem', cx, top, cx, top + h * 0.6, 3, p.bodyR)}
      <polygon points={`${cx - 6},${top + h * 0.55} ${cx + 6},${top + h * 0.55} ${cx},${top + h}`} fill={p.body} style={EDGE} />
    </g>
  );
}

function spCalendars({ p }: DesignInput): ReactNode {
  return (
    <g>
      {calendarPage('big', 4, 36, 48, 60, p)}
      {downArrow(58, 40, 26, p)}
      {calendarPage('small', 64, 62, 32, 34, p)}
    </g>
  );
}

/** A receipt: top left (x, y), width w, height h, zigzag bottom. */
function receipt(key: string, x: number, y: number, w: number, h: number, p: Paint): ReactNode {
  const teeth = 5;
  const t = w / teeth;
  const zig = Array.from({ length: teeth }, (_, i) => `L${x + w - t * i - t / 2} ${y + h - 4} L${x + w - t * (i + 1)} ${y + h}`).join(' ');
  return (
    <g key={key}>
      <path d={`M${x} ${y} H${x + w} V${y + h} ${zig} Z`} fill={p.face} style={EDGE} />
      {[0.2, 0.34, 0.48, 0.62].map((f, i) => (
        <rect key={i} x={x + w * 0.14} y={y + h * f} width={w * (i === 3 ? 0.4 : 0.72)} height={Math.max(1.2, h * 0.04)} rx="0.6" style={{ fill: 'var(--tr-engrave)', fillOpacity: 0.55 }} />
      ))}
    </g>
  );
}

function spReceipt({ p }: DesignInput): ReactNode {
  return (
    <g>
      {receipt('long', 10, 14, 40, 84, p)}
      {downArrow(58, 36, 26, p)}
      {receipt('short', 64, 58, 30, 40, p)}
    </g>
  );
}

function spLasso({ p }: DesignInput): ReactNode {
  return (
    <g>
      <path d="M30 76 C 18 82, 10 90, 16 96 C 20 99, 30 98, 34 95" fill="none" strokeWidth="3.2" strokeLinecap="round" stroke={p.lo} />
      <polygon points="36,48 68,48 80,68 68,88 36,88" fill={p.face} style={EDGE} />
      <circle cx="68" cy="68" r="4" fill={p.bodyR} style={EDGE} />
      <text x="51" y="75" textAnchor="middle" className="tr-letter" fontSize="18" style={{ fill: 'var(--tr-engrave)' }}>$</text>
      <ellipse cx="56" cy="66" rx="38" ry="28" fill="none" strokeWidth="3.6" stroke={p.lo} transform="rotate(-12 56 66)" />
    </g>
  );
}

// ------------------------------------------------------------------ Keeping things tidy (Round 4): ledgers, receipts, gears and locked boxes

/** A check mark with its short arm starting at (x, y), size s. */
function check(key: string | number, x: number, y: number, s: number, p: Paint): ReactNode {
  return <path key={key} d={`M${x} ${y} l ${s * 0.36} ${s * 0.38} l ${s * 0.64} ${-s * 0.78}`} fill="none" strokeWidth={Math.max(1.4, s * 0.2)} strokeLinecap="round" strokeLinejoin="round" stroke={p.lo} />;
}

const LEDGER_CHECKS = [1, 3, 6, 9];

function tdLedger({ step, p }: DesignInput): ReactNode {
  // An open ledger book; every line on its pages gains a check mark as the run grows.
  const n = LEDGER_CHECKS[Math.min(step, 4) - 1]!;
  const rows = [36, 48, 60, 72, 84];
  const spots: [number, number][] = [];
  for (const x of [14, 56]) for (const y of rows) spots.push([x, y]);
  return (
    <g>
      <path d="M50 24 C 38 18, 20 18, 6 22 V92 C 20 88, 38 88, 50 94 Z" fill={p.face} style={EDGE} />
      <path d="M50 24 C 62 18, 80 18, 94 22 V92 C 80 88, 62 88, 50 94 Z" fill={p.face} style={EDGE} />
      {rod('spine', 50, 24, 50, 94, 2.2, p.bodyR)}
      {spots.map(([x, y], i) => (
        <rect key={`l${i}`} x={x + 12} y={y - 1} width={20} height={1.6} rx="0.8" style={{ fill: 'var(--tr-engrave)', fillOpacity: 0.5 }} />
      ))}
      {spots.slice(0, n).map(([x, y], i) => check(i, x, y - 3, 9, p))}
    </g>
  );
}

/** One calendar page with 12 small check marks, one per month. */
function checkCalendar(key: string, x: number, y: number, w: number, h: number, p: Paint): ReactNode {
  return (
    <g key={key}>
      <rect x={x} y={y} width={w} height={h} rx="3" fill={p.face} style={EDGE} />
      <rect x={x} y={y} width={w} height={h * 0.2} rx="3" fill={p.body} style={EDGE} />
      {rod(`${key}-r1`, x + w * 0.3, y - 3, x + w * 0.3, y + 4, 2.2, p.bodyR)}
      {rod(`${key}-r2`, x + w * 0.7, y - 3, x + w * 0.7, y + 4, 2.2, p.bodyR)}
      {Array.from({ length: 12 }, (_, i) => check(i, x + w * 0.1 + (i % 4) * (w * 0.21), y + h * 0.36 + Math.floor(i / 4) * (h * 0.2), Math.min(w, h) * 0.13, p))}
    </g>
  );
}

function tdCalendarChecks({ step, p }: DesignInput): ReactNode {
  // One calendar full of checks per year of imports.
  switch (Math.min(step, 3)) {
    case 1:
      return <g>{checkCalendar('a', 14, 18, 72, 74, p)}</g>;
    case 2:
      return <g>{checkCalendar('a', 4, 14, 56, 60, p)}{checkCalendar('b', 40, 34, 56, 60, p)}</g>;
    default:
      return <g>{checkCalendar('a', 2, 8, 48, 50, p)}{checkCalendar('b', 50, 8, 48, 50, p)}{checkCalendar('c', 26, 44, 48, 50, p)}</g>;
  }
}

function tdReceipts({ step, p }: DesignInput): ReactNode {
  // A receipt, then a stack, then a pile, then a mountain of receipts.
  const piles: [number, number, number, number, number][][] = [
    [[30, 12, 40, 82, 0]],
    [[22, 22, 36, 70, -10], [42, 20, 36, 72, 8], [32, 14, 36, 80, 0]],
    [[8, 40, 30, 52, -14], [62, 40, 30, 52, 14], [20, 30, 30, 60, -6], [50, 28, 30, 62, 6], [35, 18, 30, 72, 0]],
    [[2, 56, 26, 40, -18], [72, 56, 26, 40, 18], [14, 44, 26, 50, -10], [60, 44, 26, 50, 10], [26, 32, 26, 60, -5], [48, 32, 26, 60, 5], [37, 12, 26, 82, 0]],
  ];
  return (
    <g>
      {piles[Math.min(step, 4) - 1]!.map(([x, y, w, h, a], i) => (
        <g key={i} transform={`rotate(${a} ${x + w / 2} ${y + h})`}>{receipt(`r${i}`, x, y, w, h, p)}</g>
      ))}
    </g>
  );
}

/** A gear centred on (cx, cy), radius r, with `teeth` teeth, turned by `turn` degrees. */
function gear(key: string | number, cx: number, cy: number, r: number, teeth: number, p: Paint, turn = 0): ReactNode {
  const pts: string[] = [];
  for (let i = 0; i < teeth * 4; i++) {
    const a = ((i / (teeth * 4)) * 360 + turn) * (Math.PI / 180);
    const rr = i % 4 === 1 || i % 4 === 2 ? r : r * 0.8;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`);
  }
  return (
    <g key={key}>
      <polygon points={pts.join(' ')} fill={p.body} style={EDGE} />
      <circle cx={cx} cy={cy} r={r * 0.56} fill={p.face} style={EDGE} />
      <circle cx={cx} cy={cy} r={r * 0.2} fill={p.bodyR} style={EDGE} />
    </g>
  );
}

function tdGears({ step, p }: DesignInput): ReactNode {
  switch (Math.min(step, 3)) {
    case 1:
      return <g>{gear('a', 50, 50, 46, 10, p)}</g>;
    case 2:
      return <g>{gear('a', 36, 38, 36, 9, p)}{gear('b', 70, 72, 28, 8, p, 22)}</g>;
    default:
      return <g>{gear('a', 30, 32, 30, 9, p)}{gear('b', 74, 32, 22, 7, p, 18)}{gear('c', 56, 74, 26, 8, p, 10)}</g>;
  }
}

/** An arrow from (x, y) pointing right and turned by `a` degrees. */
function sortArrow(key: string | number, x: number, y: number, len: number, a: number, p: Paint): ReactNode {
  return (
    <g key={key} transform={`rotate(${a} ${x} ${y})`}>
      {rod('s', x, y, x + len - 8, y, 4.2, p.bodyR)}
      <polygon points={`${x + len - 11},${y - 7.5} ${x + len},${y} ${x + len - 11},${y + 7.5}`} fill={p.body} style={EDGE} />
    </g>
  );
}

function tdSortGear({ step, p }: DesignInput): ReactNode {
  // A gear sending things off in sorted directions: one more arrow per step.
  const angles = [[-30, 30], [-40, 0, 40], [-54, -18, 18, 54]][Math.min(step, 3) - 1]!;
  return (
    <g>
      {angles.map((a, i) => sortArrow(i, 46, 52, 54, a, p))}
      {gear('g', 28, 52, 32, 9, p)}
    </g>
  );
}

/** A small locked box standing on (x, base), width w. */
function lockBox(key: string | number, x: number, base: number, w: number, p: Paint): ReactNode {
  const h = w * 0.78;
  const top = base - h;
  return (
    <g key={key}>
      <path d={`M${x + w * 0.32} ${top + 2} V${top - w * 0.12} A ${w * 0.18} ${w * 0.18} 0 0 1 ${x + w * 0.68} ${top - w * 0.12} V${top + 2}`} fill="none" strokeWidth={Math.max(1.6, w * 0.08)} stroke={p.lo} />
      <rect x={x} y={top} width={w} height={h} rx={w * 0.08} fill={p.face} style={EDGE} />
      <rect x={x} y={top + h * 0.32} width={w} height={h * 0.12} fill={p.body} />
      <circle cx={x + w / 2} cy={top + h * 0.62} r={w * 0.08} style={{ fill: 'var(--tr-engrave)' }} />
      <rect x={x + w / 2 - w * 0.03} y={top + h * 0.64} width={w * 0.06} height={h * 0.16} style={{ fill: 'var(--tr-engrave)' }} />
    </g>
  );
}

function tdBoxes({ step, p }: DesignInput): ReactNode {
  // Locked boxes lined up: a row of three, then two rows of six.
  if (step <= 1) return <g>{[0, 1, 2].map((i) => lockBox(i, 6 + i * 31, 82, 26, p))}</g>;
  return (
    <g>
      {[0, 1, 2].map((i) => lockBox(`t${i}`, 10 + i * 28, 52, 22, p))}
      {[0, 1, 2].map((i) => lockBox(`b${i}`, 10 + i * 28, 92, 22, p))}
    </g>
  );
}

function tdTornReceipt({ p }: DesignInput): ReactNode {
  // A receipt torn into three pieces, drifting apart; it stands on the base.
  const piece = (key: string, d: string, a: number, ox: number, oy: number) => (
    <g key={key} transform={`translate(${ox} ${oy}) rotate(${a} 50 60)`}>
      <path d={d} fill={p.face} style={EDGE} />
    </g>
  );
  return (
    <g>
      {piece('a', 'M30 20 H70 V40 L64 44 L58 39 L52 45 L46 39 L40 44 L34 39 L30 42 Z', -8, -4, 0)}
      {piece('b', 'M30 48 L34 45 L40 50 L46 45 L52 51 L58 45 L64 50 L70 46 V66 L64 70 L58 65 L52 71 L46 65 L40 70 L34 65 L30 68 Z', 4, 3, 2)}
      {piece('c', 'M30 74 L34 71 L40 76 L46 71 L52 77 L58 71 L64 76 L70 72 V94 L64 98 L58 94 L52 98 L46 94 L40 98 L34 94 L30 98 Z', -3, 0, 0)}
      {[26, 30, 56, 60, 82, 86].map((y, i) => (
        <rect key={i} x={i % 2 ? 38 : 36} y={y} width={i % 2 ? 18 : 26} height="1.6" rx="0.8" style={{ fill: 'var(--tr-engrave)', fillOpacity: 0.55 }} />
      ))}
    </g>
  );
}

function tdChainLink({ p }: DesignInput): ReactNode {
  // Two links joined: every transfer has its other side. The lower link stands on the base.
  return (
    <g>
      <rect x="22" y="18" width="34" height="58" rx="17" fill="none" strokeWidth="8" stroke={p.lo} transform="rotate(-24 39 47)" />
      <rect x="22" y="18" width="34" height="58" rx="17" fill="none" strokeWidth="4.4" stroke={p.hi} transform="rotate(-24 39 47)" />
      <rect x="46" y="40" width="34" height="58" rx="17" fill="none" strokeWidth="8" stroke={p.lo} transform="rotate(-24 63 69)" />
      <rect x="46" y="40" width="34" height="58" rx="17" fill="none" strokeWidth="4.4" stroke={p.hi} transform="rotate(-24 63 69)" />
    </g>
  );
}

function tdBox({ p }: DesignInput): ReactNode {
  return <g>{lockBox('box', 22, 98, 56, p)}</g>;
}

function tdMagnifier({ p }: DesignInput): ReactNode {
  // A magnifying glass with a check mark in the lens; the handle rests on the base.
  return (
    <g>
      {rod('handle', 62, 66, 84, 96, 9, p.bodyR)}
      <circle cx="44" cy="46" r="30" fill={p.face} style={EDGE} />
      <circle cx="44" cy="46" r="30" fill="none" strokeWidth="6" stroke={p.lo} />
      <circle cx="44" cy="46" r="23" fill="none" strokeWidth="0.7" style={ENGRAVE} />
      {check('c', 30, 46, 26, p)}
      <path d="M28 30 C 32 26, 38 24, 42 24" fill="none" strokeWidth="2" strokeLinecap="round" style={{ stroke: 'var(--tr-sheen)' }} />
    </g>
  );
}

// ------------------------------------------------------------------ The long game (Round 4): tree rings, flags, stars, ribbons and the case

const RING_YEARS = [1, 3, 5, 10, 20];

function lgRings({ step, p }: DesignInput): ReactNode {
  // A slice of a tree trunk: one ring per year of history shown.
  const n = RING_YEARS[Math.min(step, 5) - 1]!;
  const outer = 40;
  return (
    <g>
      <circle cx="50" cy="50" r={outer} fill={p.face} style={EDGE} />
      <circle cx="50" cy="50" r={outer} fill="none" strokeWidth="4" stroke={p.lo} />
      {Array.from({ length: n }, (_, i) => {
        const r = ((i + 1) / (n + 0.6)) * (outer - 4);
        return <circle key={i} cx={50 + (i % 2 ? 0.8 : -0.6)} cy={50 + (i % 3 ? 0.6 : -0.5)} r={r} fill="none" strokeWidth={n > 10 ? 0.6 : 0.9} style={ENGRAVE} />;
      })}
      <circle cx="50" cy="50" r="2.2" fill={p.bodyR} />
    </g>
  );
}

/** A pennant on a pole standing at (x, y), height h. */
function pennant(key: string | number, x: number, y: number, h: number, p: Paint): ReactNode {
  return (
    <g key={key}>
      {rod('pole', x, y, x, y - h, Math.max(2.6, h * 0.06), p.bodyR)}
      <polygon points={`${x + 1},${y - h} ${x + h * 0.72},${y - h * 0.78} ${x + 1},${y - h * 0.54}`} fill={p.face} style={EDGE} />
    </g>
  );
}

function lgFlags({ step, p }: DesignInput): ReactNode {
  switch (Math.min(step, 5)) {
    case 1: // a flag planted in the ground
      return (
        <g>
          <path d="M6 94 C 26 82, 74 82, 94 94 Z" fill={p.bodyR} style={EDGE} />
          {pennant('f', 36, 88, 82, p)}
        </g>
      );
    case 2: // a flag on a summit
      return (
        <g>
          <path d="M4 94 L50 26 L96 94 Z" fill={p.body} style={EDGE} />
          <path d="M38 44 L50 26 L62 44 L56 40 L50 46 L44 40 Z" fill={p.face} style={EDGE} />
          {pennant('f', 50, 28, 26, p)}
        </g>
      );
    default: {
      // a ridge with more flags: 3, 5, 7
      const peaks = Math.min(step, 5) === 3 ? [[24, 52], [52, 34], [80, 50]] : step === 4 ? [[12, 60], [32, 44], [52, 30], [72, 44], [90, 58]] : [[6, 66], [20, 52], [36, 42], [52, 28], [68, 42], [82, 52], [95, 64]];
      const d = `M0 96 ${peaks.map(([x, y], i) => `L${x} ${y}${i < peaks.length - 1 ? ` L${(x! + peaks[i + 1]![0]!) / 2} ${Math.max(y!, peaks[i + 1]![1]!) + 12}` : ''}`).join(' ')} L100 96 Z`;
      return (
        <g>
          <path d={d} fill={p.body} style={EDGE} />
          {peaks.map(([x, y], i) => pennant(i, x!, y! + 1, step >= 5 ? 22 : step === 4 ? 25 : 30, p))}
        </g>
      );
    }
  }
}

/** The perfect-month star: four points, each holding one of the four parts (a flame, a bullseye, a ledger check, a sprout). */
function perfectStar(cx: number, cy: number, r: number, p: Paint, glow: number): ReactNode {
  const pts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    const rr = i % 2 ? r * 0.5 : r;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`);
  }
  const d = r * 0.55; // icon centres, inside each point
  const k = r / 46; // icons are drawn about 14 wide around (0, 0), then scaled with the star
  const at = (key: string, x: number, y: number, node: ReactNode) => (
    <g key={key} transform={`translate(${x} ${y}) scale(${k})`}>
      {node}
    </g>
  );
  return (
    <g>
      {glow >= 1 && <circle cx={cx} cy={cy} r={r * 0.95} fill={p.glow} className="tr-core-glow" />}
      {glow >= 3 &&
        Array.from({ length: 4 }, (_, i) => <path key={`ray${i}`} d={`M${cx} ${cy - r * 0.62} v-${r * 0.3}`} transform={`rotate(${45 + i * 90} ${cx} ${cy})`} strokeWidth="1.6" strokeLinecap="round" style={ENGRAVE} />)}
      <polygon points={pts.join(' ')} fill={p.face} style={EDGE} />
      <circle cx={cx} cy={cy} r={r * 0.2} fill={p.body} style={EDGE} />
      <circle cx={cx} cy={cy} r={r * 0.08} fill={p.hi} />
      {at('flame', cx, cy - d, flame('fl', 0, 8, 16, p))}
      {at('target', cx + d, cy, <g><circle r="7.5" fill={p.body} style={EDGE} /><circle r="4.4" fill={p.face} style={EDGE} /><circle r="1.8" fill={p.hi} /></g>)}
      {at('check', cx, cy + d, check('ck', -7, 0, 14, p))}
      {at('sprout', cx - d, cy, sprout(0, 8, 12, p))}
      {glow >= 2 && [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dx, dy], i) => sparkle(`sp${i}`, cx + dx! * r * 0.66, cy + dy! * r * 0.66, r * 0.1, p))}
    </g>
  );
}

function lgStar({ step, p }: DesignInput): ReactNode {
  // The star gains glow, then sparkles, then rays as the count climbs.
  return <g>{perfectStar(50, 50, 48, p, Math.min(step, 4) - 1)}</g>;
}

function lgStarCup({ p }: DesignInput): ReactNode {
  return <g>{perfectStar(50, 50, 46, p, 2)}</g>;
}

/** A gift box standing on (cx, base), width w, with `ribbons` ribbons (1 or 2) and a bow. */
function giftBox(key: string, cx: number, base: number, w: number, ribbons: number, p: Paint): ReactNode {
  const h = w * 0.72;
  const top = base - h;
  const lid = h * 0.24;
  return (
    <g key={key}>
      <rect x={cx - w / 2} y={top + lid} width={w} height={h - lid} fill={p.face} style={EDGE} />
      <rect x={cx - w / 2 - 3} y={top} width={w + 6} height={lid} rx="1.5" fill={p.body} style={EDGE} />
      <rect x={cx - w * 0.07} y={top} width={w * 0.14} height={h} fill={p.trim} style={EDGE} />
      {ribbons >= 2 && <rect x={cx - w / 2} y={top + lid + (h - lid) * 0.42} width={w} height={w * 0.12} fill={p.trim} style={EDGE} />}
      <path d={`M${cx} ${top} C ${cx - w * 0.36} ${top - w * 0.34}, ${cx - w * 0.42} ${top + 1}, ${cx} ${top} C ${cx + w * 0.42} ${top + 1}, ${cx + w * 0.36} ${top - w * 0.34}, ${cx} ${top} Z`} fill={p.trim} style={EDGE} />
      <circle cx={cx} cy={top} r={w * 0.05} fill={p.hi} style={EDGE} />
    </g>
  );
}

function lgRibbonBox({ step, p }: DesignInput): ReactNode {
  switch (Math.min(step, 3)) {
    case 1:
      return <g>{giftBox('a', 50, 90, 80, 1, p)}</g>;
    case 2:
      return <g>{giftBox('a', 50, 92, 88, 2, p)}</g>;
    default:
      return <g>{giftBox('a', 50, 98, 84, 2, p)}{giftBox('b', 50, 44, 54, 2, p)}</g>;
  }
}

function lgAnniversary({ p }: DesignInput): ReactNode {
  // The Arc40 arc (the ring, open at the bottom) with its gem core at the top and a ribbon across.
  return (
    <g>
      <path d="M20 84 A 38 38 0 1 1 80 84" fill="none" strokeWidth="12" strokeLinecap="round" stroke={p.lo} />
      <path d="M20 84 A 38 38 0 1 1 80 84" fill="none" strokeWidth="7" strokeLinecap="round" stroke={p.hi} />
      <circle cx="50" cy="52" r="12" fill={p.glow} className="tr-core-glow" />
      <circle cx="50" cy="52" r="5" style={{ fill: 'var(--tr-arc-core)', stroke: 'var(--tr-gold-lo)', strokeWidth: 0.6 }} />
    </g>
  );
}

/** A tiny trophy cup on (cx, base). */
function tinyCup(key: string | number, cx: number, base: number, s: number, fill: string): ReactNode {
  return (
    <path
      key={key}
      d={`M${cx - s} ${base - s * 2.2} H${cx + s} C ${cx + s} ${base - s * 1.1}, ${cx + s * 0.4} ${base - s * 0.9}, ${cx + s * 0.25} ${base - s * 0.6} V${base - s * 0.25} H${cx + s * 0.7} V${base} H${cx - s * 0.7} V${base - s * 0.25} H${cx - s * 0.25} V${base - s * 0.6} C ${cx - s * 0.4} ${base - s * 0.9}, ${cx - s} ${base - s * 1.1}, ${cx - s} ${base - s * 2.2} Z`}
      fill={fill}
      style={EDGE}
    />
  );
}

function lgCase({ step, p }: DesignInput): ReactNode {
  // A tiny trophy case that fills up shelf by shelf; the last one is full and glowing.
  const s = Math.min(step, 4);
  const shelves = [36, 62, 88];
  const filled = s >= 3 ? 3 : s;
  return (
    <g>
      {s >= 4 && <rect x="2" y="0" width="96" height="100" rx="8" fill={p.glow} className="tr-core-glow" />}
      <rect x="8" y="4" width="84" height="94" rx="4" fill={p.bodyR} style={EDGE} />
      <rect x="14" y="10" width="72" height="82" rx="2" fill={p.face} style={EDGE} />
      {shelves.map((y, i) => rod(`sh${i}`, 14, y + 1, 86, y + 1, 2.8, p.body))}
      {shelves.slice(0, filled).map((y, r) => [25, 42, 58, 75].map((x, i) => tinyCup(`c${r}-${i}`, x, y, 5.6, r === 0 && s === 1 && i > 1 ? p.face : p.hi)))}
      {s >= 4 && [[20, 16], [80, 16]].map(([x, y], i) => sparkle(`s${i}`, x!, y!, 4.5, p))}
      <path d="M20 14 L30 30" strokeWidth="1.4" strokeLinecap="round" style={{ stroke: 'var(--tr-sheen)' }} />
    </g>
  );
}

// ------------------------------------------------------------------ The Arc (Round 4)

function theArcDesign({ p }: DesignInput): ReactNode {
  // The Arc40 ring opened up like a doorway: thick gold with a darker edge, fine dashed engraving on the inner edge, and a
  // glowing diamond-cut gem floating in the opening. The legs reach the bottom of the box, onto the base.
  const cx = 50;
  const cy = 44;
  const ro = 44;
  const ri = 32;
  const door = `M${cx - ro} 100 V${cy} A ${ro} ${ro} 0 0 1 ${cx + ro} ${cy} V100 H${cx + ri} V${cy} A ${ri} ${ri} 0 0 0 ${cx - ri} ${cy} V100 Z`; // legs reach the base
  const inner = `M${cx - ri - 2.6} 96 V${cy} A ${ri + 2.6} ${ri + 2.6} 0 0 1 ${cx + ri + 2.6} ${cy} V96`; // on the band, by its inner edge
  const gy = 60;
  return (
    <g>
      <path d={door} fill={p.body} />
      <path d={door} fill="none" strokeWidth="1.6" stroke={p.lo} />
      <path d={inner} fill="none" strokeWidth="0.8" strokeDasharray="1.6 2.2" style={ENGRAVE} />
      <path d={`M${cx - ro + 4} 96 V${cy} A ${ro - 4} ${ro - 4} 0 0 1 ${cx} ${cy - ro + 4}`} fill="none" strokeWidth="1.6" strokeLinecap="round" style={{ stroke: 'var(--tr-sheen)', strokeOpacity: 0.6 }} />
      <circle cx={cx} cy={gy} r="18" fill={p.glow} className="tr-core-glow" />
      <polygon points={`${cx - 12},${gy - 4} ${cx - 6},${gy - 12} ${cx + 6},${gy - 12} ${cx + 12},${gy - 4} ${cx},${gy + 14}`} style={{ fill: 'var(--tr-arc-core)', stroke: 'var(--tr-gold-lo)', strokeWidth: 0.8 }} />
      <polygon points={`${cx - 12},${gy - 4} ${cx - 6},${gy - 12} ${cx + 6},${gy - 12} ${cx + 12},${gy - 4}`} fill={p.hi} style={EDGE} />
      <path d={`M${cx - 6} ${gy - 12} L${cx - 3} ${gy - 4} L${cx} ${gy + 14} L${cx + 3} ${gy - 4} L${cx + 6} ${gy - 12} M${cx - 12} ${gy - 4} H${cx + 12}`} fill="none" strokeWidth="0.6" style={ENGRAVE} />
      <circle cx={cx - 4} cy={gy - 8} r="1.4" style={{ fill: 'var(--tr-sheen)' }} />
    </g>
  );
}

const DESIGNS: Record<string, (d: DesignInput) => ReactNode> = {
  'nw-coins': nwCoins,
  'nw-arrows': nwArrows,
  'nw-peak': nwPeak,
  'nw-crown-calendar': nwCrownCalendar,
  'nw-comeback': nwComeback,
  'roth-shield': rothShield,
  'roth-shields': rothShields,
  'roth-vault': rothVault,
  'roth-vault-open': rothVaultOpen,
  'roth-seed': rothSeed,
  'inv-trees': invTrees,
  'inv-snowball': invSnowball,
  'inv-chain': invChain,
  'inv-seedling': standing(invSeedling, 8),
  'inv-scale-chart': standing(invScaleChart, 6),
  'inv-bars': standing(invBars, 10),
  'inv-scale-receipt': standing(invScaleReceipt, 6),
  'inv-anchor': standing(invAnchor, 5),
  'inv-circles': standing(invCircles, 11),
  'inv-lightning': invLightning,
  'ref-whistle': refWhistle,
  'ref-cord': refCord,
  'ref-scorecard': refScorecard,
  'ref-calendar': refCalendar,
  'ref-jersey-crown': refJerseyCrown,
  'ref-whistle-arrow': standing(refWhistleArrow, 6),
  'ref-cap': standing(refCap, 20),
  'ref-roof': standing(refRoof, 8),
  'em-umbrella': emUmbrella,
  'em-umbrella-ring': emUmbrellaRing,
  'em-jars': emJars,
  'em-interest': emInterest,
  'em-refill': emRefill,
  'sp-flame': spFlame,
  'sp-jar': spJar,
  'sp-jar-calendar': spJarCalendar,
  'sp-bullseye': spBullseye,
  'sp-scissors': spScissors,
  'sp-calendars': spCalendars,
  'sp-receipt': spReceipt,
  'sp-lasso': spLasso,
  'td-ledger': tdLedger,
  'td-calendar-checks': tdCalendarChecks,
  'td-receipts': tdReceipts,
  'td-gears': tdGears,
  'td-sort-gear': tdSortGear,
  'td-boxes': tdBoxes,
  'td-torn-receipt': tdTornReceipt,
  'td-chain-link': tdChainLink,
  'td-box': tdBox,
  'td-magnifier': tdMagnifier,
  'lg-rings': lgRings,
  'lg-flags': lgFlags,
  'lg-star': lgStar,
  'lg-star-cup': lgStarCup,
  'lg-ribbon-box': lgRibbonBox,
  'lg-anniversary': lgAnniversary,
  'lg-case': lgCase,
  'the-arc': theArcDesign,
};

export const DESIGN_NAMES = Object.keys(DESIGNS);

/** The design drawn in a 100 x 100 box; unknown designs draw nothing. */
export function Design({ name, ...input }: DesignInput & { name: string }) {
  const f = DESIGNS[name];
  return <>{f ? f(input) : null}</>;
}
