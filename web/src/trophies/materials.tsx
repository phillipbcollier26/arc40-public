/**
 * Trophy materials (Trophies Round 1). Each rank is a set of color tokens; <MaterialDefs> turns one rank into the SVG
 * gradients and patterns a trophy is painted with. Every color is a token from tokens.css.
 *
 *   ranks 1-7  solid metal: iron, copper, bronze, silver, gold, rose gold, platinum
 *   ranks 8-11 inlaid: a platinum body with obsidian (gold veins), emerald, ruby or diamond (sparkles) set into the
 *              face and trim
 *   rank 12    Arc40: gold, inside the Arc40 ring, with a glowing gem core (drawn by Trophy.tsx)
 */
import type { RankId } from '../../../shared/trophies';

type Stops = readonly [hi: string, mid: string, lo: string];
export type Inlay = 'obsidian' | 'emerald' | 'ruby' | 'diamond';

const METAL = {
  iron: ['--tr-iron-hi', '--tr-iron', '--tr-iron-lo'],
  copper: ['--tr-copper-hi', '--tr-copper', '--tr-copper-lo'],
  bronze: ['--tr-bronze-hi', '--tr-bronze', '--tr-bronze-lo'],
  silver: ['--tr-silver-hi', '--tr-silver', '--tr-silver-lo'],
  gold: ['--tr-gold-hi', '--tr-gold', '--tr-gold-lo'],
  rose: ['--tr-rose-hi', '--tr-rose', '--tr-rose-lo'],
  platinum: ['--tr-platinum-hi', '--tr-platinum', '--tr-platinum-lo'],
} as const satisfies Record<string, Stops>;

const INLAY: Record<Inlay, Stops> = {
  obsidian: ['--tr-obsidian-hi', '--tr-obsidian', '--tr-obsidian-lo'],
  emerald: ['--gem-emerald', '--gem-emerald', '--gem-emerald-deep'],
  ruby: ['--gem-ruby', '--gem-ruby', '--gem-ruby-deep'],
  diamond: ['--gem-sparkle', '--gem-diamond-deep', '--gem-sparkle'],
};

export interface MaterialSpec {
  body: Stops;
  inlay: Inlay | null;
  arc: boolean;
  /** Token for the rank's own color (outlines of On trophies, shelf glow, hover label). */
  accent: string;
}

export function materialFor(rank: RankId): MaterialSpec {
  switch (rank) {
    case 'iron':
    case 'copper':
    case 'bronze':
    case 'silver':
    case 'gold':
    case 'platinum':
      // pale metals use their darker stop so the outline and shelf glow still show (Off ghost, light theme)
      return { body: METAL[rank], inlay: null, arc: false, accent: rank === 'silver' || rank === 'platinum' ? METAL[rank][2] : METAL[rank][1] };
    case 'rose_gold':
      return { body: METAL.rose, inlay: null, arc: false, accent: METAL.rose[1] };
    case 'obsidian':
      return { body: METAL.platinum, inlay: 'obsidian', arc: false, accent: '--tr-gold' };
    case 'emerald':
    case 'ruby':
    case 'diamond':
      return { body: METAL.platinum, inlay: rank, arc: false, accent: rank === 'diamond' ? '--gem-diamond-deep' : `--gem-${rank}` };
    case 'arc40':
      return { body: METAL.gold, inlay: null, arc: true, accent: '--tr-gold-hi' };
  }
}

/** Fill references for one trophy (ids are unique per drawn trophy). */
export interface Paint {
  id: string;
  /** Main metal, lit from the top left. */
  body: string;
  /** The same metal, lit the other way (edges, thickness, rims). */
  bodyR: string;
  /** Round face (coins). */
  face: string;
  /** Trim: the inlay pattern on inlaid ranks, else the reversed metal. */
  trim: string;
  /** Inlay pattern or null. */
  inlay: string | null;
  accent: string;
  /** Darker metal for raised edges and strokes. */
  lo: string;
  hi: string;
  sheen: string;
  glow: string;
}

const v = (t: string) => `var(${t})`;
const stop = (offset: string, token: string, opacity?: number) => (
  <stop offset={offset} style={{ stopColor: v(token), stopOpacity: opacity }} />
);

export function paintFor(id: string, spec: MaterialSpec): Paint {
  return {
    id,
    body: `url(#${id}-body)`,
    bodyR: `url(#${id}-bodyr)`,
    face: `url(#${id}-face)`,
    trim: spec.inlay ? `url(#${id}-inlay)` : `url(#${id}-bodyr)`,
    inlay: spec.inlay ? `url(#${id}-inlay)` : null,
    accent: v(spec.accent),
    lo: v(spec.body[2]),
    hi: v(spec.body[0]),
    sheen: `url(#${id}-sheen)`,
    glow: `url(#${id}-glow)`,
  };
}

/** Gradients and patterns for one trophy. */
export function MaterialDefs({ id, spec }: { id: string; spec: MaterialSpec }) {
  const [hi, mid, lo] = spec.body;
  const g = spec.inlay ? INLAY[spec.inlay] : null;
  return (
    <>
      <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
        {stop('0%', hi)}
        {stop('45%', mid)}
        {stop('100%', lo)}
      </linearGradient>
      <linearGradient id={`${id}-bodyr`} x1="1" y1="1" x2="0" y2="0">
        {stop('0%', hi)}
        {stop('50%', mid)}
        {stop('100%', lo)}
      </linearGradient>
      <radialGradient id={`${id}-face`} cx="0.35" cy="0.3" r="0.8">
        {stop('0%', hi)}
        {stop('55%', mid)}
        {stop('100%', lo)}
      </radialGradient>
      <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="0">
        {stop('0%', '--tr-sheen-clear')}
        {stop('50%', '--tr-sheen')}
        {stop('100%', '--tr-sheen-clear')}
      </linearGradient>
      <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
        {stop('0%', '--tr-arc-core')}
        {stop('35%', '--tr-arc-glow')}
        {stop('100%', '--tr-sheen-clear')}
      </radialGradient>
      {g && (
        <>
          <linearGradient id={`${id}-gem`} x1="0" y1="0" x2="1" y2="1">
            {stop('0%', g[0])}
            {stop('50%', g[1])}
            {stop('100%', g[2])}
          </linearGradient>
          <pattern id={`${id}-inlay`} patternUnits="userSpaceOnUse" width="24" height="24">
            <rect width="24" height="24" fill={`url(#${id}-gem)`} />
            {spec.inlay === 'obsidian' && (
              // gold veins running through black glass
              <path d="M-2 7 C 5 4, 9 12, 15 9 S 22 4, 26 7 M3 26 C 6 19, 12 21, 14 16 M17 -2 C 16 3, 20 6, 19 12" fill="none" strokeWidth="0.7" style={{ stroke: v('--tr-gold') }} />
            )}
            {(spec.inlay === 'emerald' || spec.inlay === 'ruby') && (
              // cut facets catching the light
              <path d="M0 12 L12 0 M12 24 L24 12 M0 0 L24 24" fill="none" strokeWidth="0.8" style={{ stroke: v('--gem-sparkle'), strokeOpacity: 0.28 }} />
            )}
            {spec.inlay === 'diamond' && (
              // brilliant-cut facets and small four-point sparkles
              <path d="M0 12 L12 0 L24 12 L12 24 Z M0 0 L24 24 M24 0 L0 24" fill="none" strokeWidth="0.6" style={{ stroke: v('--gem-diamond-deep'), strokeOpacity: 0.7 }} />
            )}
            {spec.inlay === 'diamond' && (
              <g style={{ fill: v('--gem-sparkle') }}>
                <path d="M6 3 L6.8 5.2 L9 6 L6.8 6.8 L6 9 L5.2 6.8 L3 6 L5.2 5.2 Z" />
                <path d="M17 14 L17.6 15.4 L19 16 L17.6 16.6 L17 18 L16.4 16.6 L15 16 L16.4 15.4 Z" />
                <circle cx="19" cy="4" r="0.7" />
                <circle cx="5" cy="19" r="0.6" />
              </g>
            )}
          </pattern>
        </>
      )}
    </>
  );
}
