/** V2 Phase 4 money river layout (shared/riverLayout.ts): pure geometry, tones and particle counts. */
import { describe, expect, it } from 'vitest';
import { layoutRiver, linkTone, particleCounts, pointOnLink, type ToneNode } from '../../shared/riverLayout.js';

const nodes = [
  { id: 'a', column: 0 as const, cents: 600_00 },
  { id: 'b', column: 0 as const, cents: 400_00 },
  { id: 'c', column: 0 as const, cents: 1_00 },
  { id: 'x', column: 1 as const, cents: 1001_00 },
  { id: 'p', column: 2 as const, cents: 700_00 },
  { id: 'q', column: 2 as const, cents: 301_00 },
];
const links = [
  { source: 'a', target: 'x', cents: 600_00 },
  { source: 'b', target: 'x', cents: 400_00 },
  { source: 'c', target: 'x', cents: 1_00 },
  { source: 'x', target: 'p', cents: 700_00 },
  { source: 'x', target: 'q', cents: 301_00 },
];

describe('river layout', () => {
  const L = layoutRiver(nodes, links, { width: 900, height: 400, left: 100, right: 120, gap: 10, nodeWidth: 12 });
  const n = new Map(L.nodes.map((x) => [x.id, x]));

  it('every column fits in the height, nodes do not overlap, columns sit left / middle / right', () => {
    for (const col of [0, 1, 2]) {
      const c = L.nodes.filter((x) => x.column === col).sort((a, b) => a.y - b.y);
      expect(c[0]!.y).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(c.at(-1)!.y + c.at(-1)!.h).toBeLessThanOrEqual(392 + 1e-9);
      for (let i = 1; i < c.length; i++) expect(c[i]!.y).toBeGreaterThanOrEqual(c[i - 1]!.y + c[i - 1]!.h + 10 - 1e-9);
    }
    expect(n.get('a')!.x).toBe(100);
    expect(n.get('p')!.x + 12).toBe(780);
    expect(n.get('x')!.x).toBeCloseTo(100 + (680 - 12) / 2);
  });

  it('one scale everywhere: equal money is equal thickness; a tiny stream still gets a 2px node', () => {
    expect(n.get('a')!.h / n.get('b')!.h).toBeCloseTo(1.5);
    expect(n.get('c')!.h).toBe(2);
    for (const l of L.links) expect(l.width).toBeCloseTo(Math.max(0.6, l.cents * L.scale));
  });

  it('ribbons leave and arrive inside their nodes without overlapping', () => {
    const out = L.links.filter((l) => l.source === 'x').sort((a, b) => a.y0 - b.y0);
    expect(out.map((l) => l.target)).toEqual(['p', 'q']); // top target first
    const x = n.get('x')!;
    expect(out[0]!.y0 - out[0]!.width / 2).toBeGreaterThanOrEqual(x.y - 1e-6);
    expect(out[1]!.y0 - out[1]!.width / 2).toBeCloseTo(out[0]!.y0 + out[0]!.width / 2);
    expect(out[1]!.y0 + out[1]!.width / 2).toBeLessThanOrEqual(x.y + x.h + 1e-6);
  });

  it('a point on a link starts and ends at the link ends, and a lane shifts it across', () => {
    const l = L.links[0]!;
    expect(pointOnLink(l, 0)).toMatchObject({ x: l.x0, y: l.y0 });
    const end = pointOnLink(l, 1);
    expect(end.x).toBeCloseTo(l.x1);
    expect(end.y).toBeCloseTo(l.y1);
    expect(pointOnLink(l, 0, 3).y).toBeCloseTo(l.y0 + 3); // horizontal at the start
  });

  it('empty input and a zero-width window do not crash', () => {
    expect(layoutRiver([], [], { width: 0, height: 0 }).links).toEqual([]);
  });
});

describe('gems and metals per stream', () => {
  const map = new Map<string, ToneNode>([
    ['ref', { id: 'ref', column: 0, kind: 'income', earned: true }],
    ['int', { id: 'int', column: 0, kind: 'income', earned: false }],
    ['gift', { id: 'gift', column: 0, kind: 'gift' }],
    ['early', { id: 'early', column: 0, kind: 'fromEarlier' }],
    ['acct', { id: 'acct', column: 1, kind: 'account' }],
    ['food', { id: 'food', column: 2, kind: 'spending' }],
    ['other', { id: 'other', column: 2, kind: 'other' }],
    ['inv', { id: 'inv', column: 2, kind: 'invested' }],
    ['kept', { id: 'kept', column: 2, kind: 'kept' }],
  ]);
  it('earned income gold, interest bronze, gifts topaz, earlier money silver, spending rubies, Other amber, invested emeralds, kept diamonds', () => {
    const tone = (s: string, t: string) => linkTone({ source: s, target: t }, map);
    expect([tone('ref', 'acct'), tone('int', 'acct'), tone('gift', 'acct'), tone('early', 'acct')]).toEqual(['gold', 'bronze', 'topaz', 'silver']);
    expect([tone('acct', 'food'), tone('acct', 'other'), tone('acct', 'inv'), tone('acct', 'kept')]).toEqual(['ruby', 'amber', 'emerald', 'diamond']);
  });
});

describe('particle counts', () => {
  it('stay under the cap, give every stream at least one, and bigger streams more', () => {
    const c = particleCounts([100_000_00, 50_00, 5_000_00, 1], 30);
    expect(c.reduce((s, x) => s + x, 0)).toBeLessThanOrEqual(30);
    expect(Math.min(...c)).toBe(1);
    expect(c[0]).toBeGreaterThan(c[2]!);
    expect(particleCounts([1, 2], 0)).toEqual([0, 0]);
    expect(particleCounts(Array(100).fill(5), 80).reduce((s, x) => s + x, 0)).toBe(80); // more streams than the cap: still 80
  });
});
