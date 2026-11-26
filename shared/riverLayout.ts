/**
 * Money river layout (V2 Phase 4): turns the server's nodes and links into positions and ribbon paths.
 * Pure (no DOM), so it is unit tested and shared by the Dashboard card and the full-screen view.
 *
 * Three columns. Each column's nodes are stacked top to bottom in the server's order and centered. One
 * scale (pixels per cent) is used for the whole river, so equal money is equal thickness everywhere; it is
 * the largest scale at which every column fits. A tiny stream still gets a 2px node so it can be seen.
 * Links leave a node in the order of their targets (top first) and arrive in the order of their sources,
 * so ribbons do not cross inside a node.
 */

export interface LayoutNodeIn {
  id: string;
  column: 0 | 1 | 2;
  cents: number;
}

export interface LayoutLinkIn {
  source: string;
  target: string;
  cents: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  nodeWidth?: number;
  gap?: number;
  /** Space kept free at the left (labels of column 0) and right (labels of column 2). */
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  minNode?: number;
}

export interface LaidNode {
  id: string;
  column: 0 | 1 | 2;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaidLink {
  source: string;
  target: string;
  cents: number;
  /** Ribbon thickness in px. */
  width: number;
  /** Center line: from (x0, y0) to (x1, y1), a cubic curve with both control points at the middle x. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** SVG path of the filled ribbon. */
  d: string;
}

export interface RiverLayout {
  nodes: LaidNode[];
  links: LaidLink[];
  scale: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function layoutRiver(nodesIn: readonly LayoutNodeIn[], linksIn: readonly LayoutLinkIn[], o: LayoutOptions): RiverLayout {
  const nodeWidth = o.nodeWidth ?? 12;
  const gap = o.gap ?? 14;
  const left = o.left ?? 0;
  const right = o.right ?? 0;
  const top = o.top ?? 8;
  const bottom = o.bottom ?? 8;
  const minNode = o.minNode ?? 2;
  const innerH = Math.max(40, o.height - top - bottom);
  const innerW = Math.max(3 * nodeWidth + 40, o.width - left - right);
  const xs = [left, left + (innerW - nodeWidth) / 2, left + innerW - nodeWidth];

  const cols: LayoutNodeIn[][] = [[], [], []];
  for (const n of nodesIn) cols[n.column]!.push(n);
  let scale = Infinity;
  for (const col of cols) {
    const total = col.reduce((s, n) => s + n.cents, 0);
    if (total <= 0) continue;
    const room = innerH - gap * (col.length - 1) - minNode * col.length;
    scale = Math.min(scale, Math.max(0, room) / total);
  }
  if (!Number.isFinite(scale)) scale = 0;

  const laid = new Map<string, LaidNode>();
  for (const [c, col] of cols.entries()) {
    const hs = col.map((n) => Math.max(minNode, n.cents * scale));
    const used = hs.reduce((s, h) => s + h, 0) + gap * Math.max(0, col.length - 1);
    let y = top + Math.max(0, (innerH - used) / 2);
    col.forEach((n, i) => {
      laid.set(n.id, { id: n.id, column: n.column, x: xs[c]!, y, w: nodeWidth, h: hs[i]! });
      y += hs[i]! + gap;
    });
  }

  // Band offsets: outgoing sorted by target position, incoming by source position.
  const centerY = (id: string) => {
    const n = laid.get(id)!;
    return n.y + n.h / 2;
  };
  const valid = linksIn.filter((l) => laid.has(l.source) && laid.has(l.target) && l.cents > 0);
  const outOff = new Map<string, number>();
  const inOff = new Map<string, number>();
  const outStart = new Map<LayoutLinkIn, number>();
  const inStart = new Map<LayoutLinkIn, number>();
  const bandH = (l: LayoutLinkIn) => l.cents * scale;
  // A node taller than its links (minimum size) centers its bands.
  const sumBy = (id: string, side: 'source' | 'target') => valid.filter((l) => l[side] === id).reduce((s, l) => s + bandH(l), 0);
  for (const l of [...valid].sort((a, b) => centerY(a.target) - centerY(b.target) || (a.target < b.target ? -1 : 1))) {
    const n = laid.get(l.source)!;
    const base = outOff.get(l.source) ?? n.y + Math.max(0, (n.h - sumBy(l.source, 'source')) / 2);
    outStart.set(l, base);
    outOff.set(l.source, base + bandH(l));
  }
  for (const l of [...valid].sort((a, b) => centerY(a.source) - centerY(b.source) || (a.source < b.source ? -1 : 1))) {
    const n = laid.get(l.target)!;
    const base = inOff.get(l.target) ?? n.y + Math.max(0, (n.h - sumBy(l.target, 'target')) / 2);
    inStart.set(l, base);
    inOff.set(l.target, base + bandH(l));
  }

  const links: LaidLink[] = valid.map((l) => {
    const s = laid.get(l.source)!;
    const t = laid.get(l.target)!;
    const w = Math.max(0.6, bandH(l));
    const x0 = s.x + s.w;
    const x1 = t.x;
    const sy = outStart.get(l)!;
    const ty = inStart.get(l)!;
    const mx = (x0 + x1) / 2;
    const d =
      `M${r1(x0)},${r1(sy)} C${r1(mx)},${r1(sy)} ${r1(mx)},${r1(ty)} ${r1(x1)},${r1(ty)} ` +
      `L${r1(x1)},${r1(ty + w)} C${r1(mx)},${r1(ty + w)} ${r1(mx)},${r1(sy + w)} ${r1(x0)},${r1(sy + w)} Z`;
    return { source: l.source, target: l.target, cents: l.cents, width: w, x0, y0: sy + w / 2, x1, y1: ty + w / 2, d };
  });
  return { nodes: [...laid.values()], links, scale };
}

/** Point on a link's center line at t (0..1), shifted by `lane` px across the ribbon. */
export function pointOnLink(l: Pick<LaidLink, 'x0' | 'y0' | 'x1' | 'y1'>, t: number, lane = 0): { x: number; y: number; angle: number } {
  const mx = (l.x0 + l.x1) / 2;
  const u = 1 - t;
  // Cubic Bezier with P0=(x0,y0) P1=(mx,y0) P2=(mx,y1) P3=(x1,y1).
  const x = u * u * u * l.x0 + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * l.x1;
  const y = u * u * u * l.y0 + 3 * u * u * t * l.y0 + 3 * u * t * t * l.y1 + t * t * t * l.y1;
  const dx = 3 * u * u * (mx - l.x0) + 3 * t * t * (l.x1 - mx);
  const dy = 6 * u * t * (l.y1 - l.y0);
  const len = Math.hypot(dx, dy) || 1;
  return { x: x - (dy / len) * lane, y: y + (dx / len) * lane, angle: Math.atan2(dy, dx) };
}

export type RiverTone = 'gold' | 'silver' | 'bronze' | 'diamond' | 'emerald' | 'ruby' | 'topaz' | 'amber';

export interface ToneNode {
  id: string;
  column: 0 | 1 | 2;
  kind: string;
  earned?: boolean;
}

/**
 * Which gem or metal flows along a link. Left links take the source's tone, right links the destination's:
 * earned income gold, other income bronze, gifts topaz, refunds amber, money you already had / moves silver,
 * from or into investments emeralds, spending rubies (Other spending amber), kept as cash diamonds.
 */
export function linkTone(link: { source: string; target: string }, nodes: ReadonlyMap<string, ToneNode>): RiverTone {
  const s = nodes.get(link.source);
  const t = nodes.get(link.target);
  const n = s && s.column === 0 ? s : t;
  if (!n) return 'silver';
  switch (n.kind) {
    case 'income':
      return n.earned ? 'gold' : 'bronze';
    case 'gift':
      return 'topaz';
    case 'refund':
    case 'incomeBack':
    case 'giftOut':
      return 'amber';
    case 'other':
      return n.column === 0 ? 'bronze' : 'amber';
    case 'fromInvestments':
    case 'outsideIn':
    case 'invested':
      return 'emerald';
    case 'spending':
      return 'ruby';
    case 'kept':
      return 'diamond';
    default:
      return 'silver';
  }
}

/** How many particles a link gets: by the square root of its share, at least 1 (unless there are more streams than `cap`), never more than `cap` in total. */
export function particleCounts(cents: readonly number[], cap: number): number[] {
  const total = cents.reduce((s, c) => s + c, 0);
  if (total <= 0 || cap <= 0) return cents.map(() => 0);
  const weights = cents.map((c) => Math.sqrt(c / total));
  const wsum = weights.reduce((s, w) => s + w, 0);
  const counts = weights.map((w) => Math.max(1, Math.round((w / wsum) * cap)));
  // Trim the biggest streams first until the cap holds (every stream keeps at least one).
  let over = counts.reduce((s, c) => s + c, 0) - cap;
  while (over > 0) {
    const i = counts.indexOf(Math.max(...counts));
    if (counts[i]! <= 1) break;
    counts[i]! -= 1;
    over -= 1;
  }
  // More streams than the cap: the smallest streams go without (the cap is strict).
  if (over > 0) {
    const bySize = cents.map((c, i) => [c, i] as const).sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    for (const [, i] of bySize) {
      if (over <= 0) break;
      counts[i] = 0;
      over -= 1;
    }
  }
  return counts;
}
