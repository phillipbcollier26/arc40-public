/**
 * Gem and metal sprites for the money river (V2 Phase 4). Each stone is drawn ONCE per theme into a small
 * offscreen canvas; the animation only copies these images, which keeps it smooth. Colors come from the
 * tokens in tokens.css (read when the sprites are built), never hard-coded.
 */
import type { RiverTone } from '../../../shared/riverLayout';
import { cssVar, withAlpha } from './theme';

export const SPRITE_PX = 48;

const TONES: Record<RiverTone, [string, string]> = {
  diamond: ['--gem-diamond', '--gem-diamond-deep'],
  emerald: ['--gem-emerald', '--gem-emerald-deep'],
  ruby: ['--gem-ruby', '--gem-ruby-deep'],
  topaz: ['--gem-topaz', '--gem-topaz-deep'],
  amber: ['--gem-amber', '--gem-amber-deep'],
  gold: ['--gold-bright', '--gold-deep'],
  silver: ['--platinum', '--pewter'],
  bronze: ['--bronze', '--copper'],
};

/** Token that colors a tone's ribbon. */
export const RIBBON_TOKEN: Record<RiverTone, string> = {
  diamond: '--gem-diamond-deep',
  emerald: '--gem-emerald',
  ruby: '--gem-ruby',
  topaz: '--gem-topaz',
  amber: '--gem-amber',
  gold: '--gold',
  silver: '--silver',
  bronze: '--bronze',
};

export const TONE_LABEL: Record<RiverTone, string> = {
  gold: 'Gold: pay for your work',
  bronze: 'Bronze: interest and other income',
  topaz: 'Topaz: gifts',
  silver: 'Silver: money you already had and moves',
  ruby: 'Rubies: spending',
  amber: 'Amber: smaller spending and refunds',
  emerald: 'Emeralds: invested',
  diamond: 'Diamonds: kept as cash',
};

type Ctx = CanvasRenderingContext2D;

/**
 * A token's color as "#rrggbb", whatever short form the build wrote it in: the browser
 * parses it. A token it cannot read falls back to pewter; if even that fails it throws (the river then
 * stays a still chart).
 */
let probe: CanvasRenderingContext2D | null = null;
function parseColor(value: string): string | null {
  probe ??= document.createElement('canvas').getContext('2d');
  if (!probe || !value) return null;
  probe.fillStyle = 'transparent';
  probe.fillStyle = value;
  const v = String(probe.fillStyle);
  return /^#[0-9a-f]{6}$/i.test(v) ? v : null;
}
export function tokenHex(name: string): string {
  const v = parseColor(cssVar(name)) ?? parseColor(cssVar('--pewter'));
  if (!v) throw new Error(`Color token ${name} could not be read.`);
  return v;
}

function poly(c: Ctx, pts: [number, number][]) {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x * SPRITE_PX, y * SPRITE_PX) : c.moveTo(x * SPRITE_PX, y * SPRITE_PX)));
  c.closePath();
}

function facetLines(c: Ctx, color: string, lines: [number, number, number, number][], width = 1) {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  for (const [a, b, d, e] of lines) {
    c.moveTo(a * SPRITE_PX, b * SPRITE_PX);
    c.lineTo(d * SPRITE_PX, e * SPRITE_PX);
  }
  c.stroke();
}

function draw(c: Ctx, tone: RiverTone, light: string, deep: string, sparkle: string) {
  const P = SPRITE_PX;
  const lin = (x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) => {
    const g = c.createLinearGradient(x0 * P, y0 * P, x1 * P, y1 * P);
    for (const [o, col] of stops) g.addColorStop(o, col);
    return g;
  };
  const rad = (x: number, y: number, r: number, stops: [number, string][]) => {
    const g = c.createRadialGradient(x * P, y * P, 0, x * P, y * P, r * P);
    for (const [o, col] of stops) g.addColorStop(o, col);
    return g;
  };
  const shine = withAlpha(sparkle, 0.75);
  const soft = withAlpha(sparkle, 0.35);
  c.lineJoin = 'round';
  switch (tone) {
    case 'diamond': {
      // Brilliant cut, side view: a crown on top of a pointed pavilion.
      const outline: [number, number][] = [[0.12, 0.38], [0.3, 0.18], [0.7, 0.18], [0.88, 0.38], [0.5, 0.9]];
      poly(c, outline);
      c.fillStyle = lin(0.1, 0.15, 0.9, 0.9, [[0, sparkle], [0.45, light], [1, deep]]);
      c.fill();
      c.strokeStyle = withAlpha(deep, 0.9);
      c.lineWidth = 1.4;
      c.stroke();
      facetLines(c, shine, [[0.12, 0.38, 0.88, 0.38], [0.3, 0.18, 0.4, 0.38], [0.7, 0.18, 0.6, 0.38], [0.5, 0.18, 0.4, 0.38], [0.5, 0.18, 0.6, 0.38], [0.4, 0.38, 0.5, 0.9], [0.6, 0.38, 0.5, 0.9], [0.12, 0.38, 0.5, 0.9], [0.88, 0.38, 0.5, 0.9]], 0.9);
      break;
    }
    case 'emerald': {
      // Step cut: an octagon with an inner table.
      poly(c, [[0.3, 0.12], [0.7, 0.12], [0.84, 0.26], [0.84, 0.74], [0.7, 0.88], [0.3, 0.88], [0.16, 0.74], [0.16, 0.26]]);
      c.fillStyle = lin(0.15, 0.1, 0.85, 0.9, [[0, light], [0.6, deep], [1, deep]]);
      c.fill();
      c.strokeStyle = withAlpha(deep, 1);
      c.lineWidth = 1.2;
      c.stroke();
      poly(c, [[0.37, 0.27], [0.63, 0.27], [0.69, 0.33], [0.69, 0.67], [0.63, 0.73], [0.37, 0.73], [0.31, 0.67], [0.31, 0.33]]);
      c.fillStyle = lin(0.3, 0.25, 0.7, 0.75, [[0, withAlpha(sparkle, 0.55)], [0.5, light], [1, withAlpha(light, 0.8)]]);
      c.fill();
      facetLines(c, soft, [[0.3, 0.12, 0.37, 0.27], [0.7, 0.12, 0.63, 0.27], [0.84, 0.74, 0.69, 0.67], [0.16, 0.74, 0.31, 0.67], [0.3, 0.88, 0.37, 0.73], [0.7, 0.88, 0.63, 0.73]]);
      break;
    }
    case 'ruby':
    case 'topaz': {
      // Ruby: cushion cut. Topaz: oval. Both with a bright table and star facets.
      c.beginPath();
      if (tone === 'ruby') c.roundRect(0.16 * P, 0.16 * P, 0.68 * P, 0.68 * P, 0.2 * P);
      else c.ellipse(0.5 * P, 0.5 * P, 0.3 * P, 0.38 * P, 0, 0, Math.PI * 2);
      c.fillStyle = rad(0.42, 0.38, 0.5, [[0, sparkle], [0.25, light], [1, deep]]);
      c.fill();
      c.strokeStyle = deep;
      c.lineWidth = 1.2;
      c.stroke();
      facetLines(c, soft, [[0.5, 0.14, 0.5, 0.86], [0.16, 0.5, 0.84, 0.5], [0.26, 0.26, 0.74, 0.74], [0.74, 0.26, 0.26, 0.74]], 0.8);
      break;
    }
    case 'amber': {
      // Polished cabochon: smooth, warm, glowing from inside.
      c.beginPath();
      c.ellipse(0.5 * P, 0.52 * P, 0.34 * P, 0.3 * P, 0, 0, Math.PI * 2);
      c.fillStyle = rad(0.5, 0.58, 0.42, [[0, light], [0.7, deep], [1, deep]]);
      c.fill();
      break;
    }
    default: {
      // Gold, silver and bronze pieces: a coin with a raised rim.
      c.beginPath();
      c.arc(0.5 * P, 0.5 * P, 0.36 * P, 0, Math.PI * 2);
      c.fillStyle = lin(0.15, 0.15, 0.85, 0.85, [[0, light], [0.5, deep], [0.75, light], [1, deep]]);
      c.fill();
      c.beginPath();
      c.arc(0.5 * P, 0.5 * P, 0.26 * P, 0, Math.PI * 2);
      c.strokeStyle = withAlpha(deep, 0.9);
      c.lineWidth = 1.6;
      c.stroke();
      c.beginPath();
      c.arc(0.5 * P, 0.5 * P, 0.36 * P, 0, Math.PI * 2);
      c.strokeStyle = withAlpha(deep, 1);
      c.lineWidth = 1;
      c.stroke();
    }
  }
  // A small highlight glint on every piece.
  c.beginPath();
  c.ellipse(0.38 * P, 0.3 * P, 0.07 * P, 0.035 * P, -0.6, 0, Math.PI * 2);
  c.fillStyle = shine;
  c.fill();
}

/** Builds every sprite for the current theme. Call again after a theme change. */
export function buildSprites(): Record<RiverTone, HTMLCanvasElement> {
  const sparkle = tokenHex('--gem-sparkle');
  const out = {} as Record<RiverTone, HTMLCanvasElement>;
  for (const tone of Object.keys(TONES) as RiverTone[]) {
    const cv = document.createElement('canvas');
    cv.width = SPRITE_PX;
    cv.height = SPRITE_PX;
    const c = cv.getContext('2d');
    if (c) draw(c, tone, tokenHex(TONES[tone][0]), tokenHex(TONES[tone][1]), sparkle);
    out[tone] = cv;
  }
  return out;
}

/** Draws one sprite into a small visible canvas (the legend). */
export function paintIcon(canvas: HTMLCanvasElement, tone: RiverTone, sizePx: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(sizePx * dpr);
  canvas.height = Math.round(sizePx * dpr);
  const c = canvas.getContext('2d');
  if (!c) return;
  const tmp = document.createElement('canvas');
  tmp.width = SPRITE_PX;
  tmp.height = SPRITE_PX;
  const tc = tmp.getContext('2d');
  if (!tc) return;
  draw(tc, tone, tokenHex(TONES[tone][0]), tokenHex(TONES[tone][1]), tokenHex('--gem-sparkle'));
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.drawImage(tmp, 0, 0, canvas.width, canvas.height);
}
