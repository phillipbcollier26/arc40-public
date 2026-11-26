/**
 * The trophy shapes (five from Trophies Round 1, The Arc's own from Round 4), drawn in a 120 x 160 box so every trophy stands on the same shelf line.
 * Each shape gets the trophy's paint, its design (already drawn in a 100 x 100 box) and its engraving, and returns
 * the drawing plus its focus circle (where an Arc40 ring goes).
 *
 *   coin       amount and count ladders: a thick coin on an angled stand, the amount engraved around the rim; the rim
 *              gets fancier with the rank (plain, notched, laurel, fine inner engraving)
 *   cup        anything "in a row": two handles, a stepped base, one notch on the lip per unit of the streak
 *   plaque     records: a shield with the current record and its date, older records struck through below
 *   banner     yearly: hangs from a crossbar with round end caps, the year large in the middle
 *   statuette  one-offs: the design itself is the sculpture, on a round base with a nameplate
 *   arc        The Arc only (Round 4): the doorway on a stepped dark base with a gold plate
 */
import type { ReactNode } from 'react';
import type { Shape } from '../../../shared/trophies';
import type { Paint } from './materials';

export interface ShapeInput {
  id: string;
  p: Paint;
  design: ReactNode;
  engraving: string;
  /** Rank level 1..12 (fancier coin rims). */
  level: number;
  /** Streak length for the cup's notches. */
  notches?: number;
  year?: number | null;
  /** Second banner label (under the design). */
  labelBelow?: string;
  /** Record plaque: newest first, text already formatted. */
  records?: { amount: string; when: string }[];
}

export interface ShapeOut {
  art: ReactNode;
  focus: { cx: number; cy: number; r: number };
  /** Where stars go (Arc40 star levels). */
  starsY: number;
}

const EDGE = { strokeWidth: 0.8, stroke: 'var(--tr-engrave)' } as const;

/** Places a 100 x 100 design centered at (cx, cy), `size` wide. */
export function place(design: ReactNode, cx: number, cy: number, size: number): ReactNode {
  return <g transform={`translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 100})`}>{design}</g>;
}

function engraved(text: string, x: number, y: number, size: number, extra: object = {}): ReactNode {
  return (
    <text x={x} y={y} textAnchor="middle" className="tr-engraving" fontSize={size} style={{ fill: 'var(--tr-engrave)', ...extra }}>
      {text}
    </text>
  );
}

function coin({ id, p, design, engraving, level }: ShapeInput): ShapeOut {
  const cx = 60;
  const cy = 62;
  const r = 46;
  const rim: ReactNode[] = [];
  if (level >= 4 && level <= 5)
    // notched rim (lower half; the engraving runs along the top)
    for (let i = 0; i <= 30; i++) {
      const a = (i / 30) * Math.PI;
      rim.push(<line key={i} x1={cx + Math.cos(a) * (r - 0.5)} y1={cy + Math.sin(a) * (r - 0.5)} x2={cx + Math.cos(a) * (r - 3.2)} y2={cy + Math.sin(a) * (r - 3.2)} strokeWidth="0.7" style={{ stroke: 'var(--tr-engrave)' }} />);
    }
  if (level >= 6)
    // laurel border on the lower half of the rim
    for (let i = 0; i < 18; i++) {
      const a = Math.PI * (0.08 + (i / 17) * 0.84);
      const lx = cx + Math.cos(a) * (r - 4.2);
      const ly = cy + Math.sin(a) * (r - 4.2);
      rim.push(<ellipse key={`l${i}`} cx={lx} cy={ly} rx="2.6" ry="1.1" transform={`rotate(${(a * 180) / Math.PI + (i % 2 ? 30 : -30)} ${lx} ${ly})`} fill={p.hi} style={EDGE} />);
    }
  return {
    focus: { cx, cy, r: 53 },
    starsY: 152,
    art: (
      <g>
        {/* stand */}
        <rect x="28" y="146" width="64" height="9" rx="2.5" fill={p.bodyR} style={EDGE} />
        <rect x="38" y="139" width="44" height="8" rx="2" fill={p.body} style={EDGE} />
        <polygon points="50,140 70,140 66,104 54,104" fill={p.bodyR} style={EDGE} />
        {/* the coin's thickness, then its face */}
        <circle cx={cx + 4} cy={cy + 2} r={r} fill={p.bodyR} style={EDGE} />
        <circle cx={cx} cy={cy} r={r} fill={p.trim} style={EDGE} />
        <circle cx={cx} cy={cy} r={r - 2.5} fill="none" strokeWidth="0.6" style={{ stroke: 'var(--tr-engrave-hi)' }} />
        {rim}
        <circle cx={cx} cy={cy} r={r - 9} fill={p.face} style={EDGE} />
        {level >= 9 && (
          <>
            <circle cx={cx} cy={cy} r={r - 12} fill="none" strokeWidth="0.5" strokeDasharray="1 1.6" style={{ stroke: 'var(--tr-engrave)' }} />
            <circle cx={cx} cy={cy} r={r - 13.5} fill="none" strokeWidth="0.4" style={{ stroke: 'var(--tr-engrave)' }} />
          </>
        )}
        {place(design, cx, cy, 52)}
        <path id={`${id}-rim`} d={`M${cx - (r - 7.4)} ${cy} A${r - 7.4} ${r - 7.4} 0 0 1 ${cx + (r - 7.4)} ${cy}`} fill="none" />
        <text className="tr-engraving" fontSize="5.2" style={{ fill: level >= 8 && level <= 11 ? 'var(--tr-engrave-hi)' : 'var(--tr-engrave)' }}>
          <textPath href={`#${id}-rim`} startOffset="50%" textAnchor="middle">
            {engraving}
          </textPath>
        </text>
      </g>
    ),
  };
}

function cup({ p, design, engraving, notches = 0 }: ShapeInput): ShapeOut {
  const n = Math.max(0, Math.min(24, notches));
  return {
    focus: { cx: 60, cy: 60, r: 25 },
    starsY: 152,
    art: (
      <g>
        {/* stepped base */}
        <rect x="24" y="142" width="72" height="12" rx="2.5" fill={p.bodyR} style={EDGE} />
        <rect x="32" y="130" width="56" height="13" rx="2" fill={p.inlay ?? p.body} style={EDGE} />
        <rect x="42" y="122" width="36" height="9" rx="2" fill={p.bodyR} style={EDGE} />
        {engraved(engraving, 60, 138.3, engraving.length > 14 ? 3.9 : 4.6)}
        {/* stem and knop */}
        <path d="M53 94 C 56 104, 56 112, 52 122 H68 C 64 112, 64 104, 67 94 Z" fill={p.body} style={EDGE} />
        <ellipse cx="60" cy="106" rx="9" ry="3.6" fill={p.face} style={EDGE} />
        {/* handles */}
        <path d="M24 30 C 4 30, 4 64, 30 70" fill="none" strokeWidth="5.5" strokeLinecap="round" stroke={p.bodyR} />
        <path d="M96 30 C 116 30, 116 64, 90 70" fill="none" strokeWidth="5.5" strokeLinecap="round" stroke={p.bodyR} />
        {/* bowl, band, lip */}
        <path d="M22 20 C 22 62, 38 94, 60 96 C 82 94, 98 62, 98 20 Z" fill={p.body} style={EDGE} />
        <path d="M23.5 32 C 36 39, 84 39, 96.5 32" fill="none" strokeWidth="6" stroke={p.trim} />
        <ellipse cx="60" cy="20" rx="38" ry="7" fill={p.bodyR} style={EDGE} />
        <ellipse cx="60" cy="20" rx="34" ry="5" fill={p.lo} />
        {Array.from({ length: n }, (_, i) => {
          const x = 30 + ((i + 0.5) * 60) / n;
          return <line key={i} x1={x} y1="24.5" x2={x} y2="28.5" strokeWidth="1.1" style={{ stroke: 'var(--tr-engrave)' }} />;
        })}
        {place(design, 60, 60, 40)}
      </g>
    ),
  };
}

function plaque({ p, design, engraving, records = [] }: ShapeInput): ShapeOut {
  const [now, ...older] = records;
  return {
    focus: { cx: 60, cy: 35, r: 19 },
    starsY: 152,
    art: (
      <g>
        <rect x="30" y="146" width="60" height="9" rx="2.5" fill={p.bodyR} style={EDGE} />
        <rect x="47" y="132" width="26" height="15" fill={p.body} style={EDGE} />
        <path d="M16 8 H104 V76 C 104 108, 84 124, 60 138 C 36 124, 16 108, 16 76 Z" fill={p.trim} style={EDGE} />
        <path d="M23 15 H97 V76 C 97 102, 80 116, 60 128.5 C 40 116, 23 102, 23 76 Z" fill={p.body} style={EDGE} />
        {place(design, 60, 35, 34)}
        {engraved(engraving, 60, 60, 5.2, { letterSpacing: 0.6 })}
        {now && engraved(now.amount, 60, 75, 11, { fontWeight: 700 })}
        {now && engraved(now.when, 60, 84, 5.2)}
        {older.slice(0, 3).map((r, i) => (
          <g key={r.when} opacity={0.75 - i * 0.15}>
            {engraved(`${r.amount}  ${r.when}`, 60, 95 + i * 7.5, 4.8)}
            <line x1="34" x2="86" y1={93.4 + i * 7.5} y2={93.4 + i * 7.5} strokeWidth="0.6" style={{ stroke: 'var(--tr-engrave)' }} />
          </g>
        ))}
      </g>
    ),
  };
}

function banner({ p, design, engraving, year, labelBelow }: ShapeInput): ShapeOut {
  return {
    focus: { cx: 60, cy: 81, r: 15 },
    starsY: 150,
    art: (
      <g>
        <rect x="58" y="10" width="4" height="138" fill={p.bodyR} style={EDGE} />
        <ellipse cx="60" cy="151" rx="24" ry="4.5" fill={p.bodyR} style={EDGE} />
        <ellipse cx="60" cy="148" rx="18" ry="3.4" fill={p.body} style={EDGE} />
        <path d="M24 22 H96 V124 L60 109 L24 124 Z" fill={p.trim} style={EDGE} />
        <path d="M30 27 H90 V115 L60 102.5 L30 115 Z" fill={p.body} style={EDGE} />
        <rect x="10" y="12" width="100" height="7" rx="3.5" fill={p.body} style={EDGE} />
        <circle cx="10" cy="15.5" r="6" fill={p.face} style={EDGE} />
        <circle cx="110" cy="15.5" r="6" fill={p.face} style={EDGE} />
        {engraved(engraving, 60, 38, 6, { letterSpacing: 0.8 })}
        {year !== null && year !== undefined && engraved(String(year), 60, 62, 21, { fontWeight: 700 })}
        {place(design, 60, 81, 24)}
        {labelBelow && engraved(labelBelow, 60, 100, 4.6, { letterSpacing: 0.6 })}
      </g>
    ),
  };
}

function statuette({ p, design, engraving }: ShapeInput): ShapeOut {
  return {
    focus: { cx: 60, cy: 72, r: 54 },
    starsY: 153,
    art: (
      <g>
        <ellipse cx="60" cy="146" rx="38" ry="7.5" fill={p.bodyR} style={EDGE} />
        <rect x="22" y="131" width="76" height="15" fill={p.bodyR} />
        <path d="M22 131 V146 M98 131 V146" style={EDGE} />
        <ellipse cx="60" cy="131" rx="38" ry="7.5" fill={p.face} style={EDGE} />
        <path d="M23 134 C 40 141, 80 141, 97 134" fill="none" strokeWidth="3.4" stroke={p.trim} />
        <rect x="40" y="137" width="40" height="8" rx="1.2" fill={p.body} style={EDGE} />
        {engraved(engraving, 60, 142.6, 4)}
        {place(design, 60, 76, 92)}
      </g>
    ),
  };
}

/**
 * The Arc (Round 4): its own shape. The doorway design (designs.tsx 'the-arc') stands large on a stepped dark base with a
 * gold plate reading THE ARC · AGE 40. Trophy.tsx draws no extra Arc40 ring around it: The Arc is that ring, opened up.
 */
function arc({ p, design, engraving }: ShapeInput): ShapeOut {
  return {
    focus: { cx: 60, cy: 70, r: 54 },
    starsY: 154,
    art: (
      <g>
        <path d="M14 156 L20 146 H100 L106 156 Z" style={{ fill: 'var(--tr-obsidian-lo)', stroke: 'var(--tr-gold-lo)', strokeWidth: 0.9 }} />
        <path d="M24 146 L28 136 H92 L96 146 Z" style={{ fill: 'var(--tr-obsidian)', stroke: 'var(--tr-gold-lo)', strokeWidth: 0.9 }} />
        <path d="M28 136 L32 130 H88 L92 136 Z" style={{ fill: 'var(--tr-obsidian-hi)', stroke: 'var(--tr-gold-lo)', strokeWidth: 0.9 }} />
        <path d="M20 146.6 H100 M28 136.6 H92" strokeWidth="0.8" style={{ stroke: 'var(--tr-gold)', strokeOpacity: 0.7 }} />
        <rect x="34" y="139" width="52" height="6" rx="1" fill={p.body} style={EDGE} />
        {engraved(engraving, 60, 143.6, 3.6)}
        {place(design, 60, 72, 116)}
      </g>
    ),
  };
}

export function drawShape(shape: Shape, input: ShapeInput): ShapeOut {
  switch (shape) {
    case 'coin':
      return coin(input);
    case 'cup':
      return cup(input);
    case 'plaque':
      return plaque(input);
    case 'banner':
      return banner(input);
    case 'statuette':
      return statuette(input);
    case 'arc':
      return arc(input);
  }
}
