/**
 * Trophy drawing system (Trophies Round 1): every trophy in the catalog can be drawn in every state, every rank has a
 * material, every design family a catalog trophy uses exists, and the dev-only preview stays out of production.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RANKS, TROPHIES, rankLabel, trophyName, type TrophyState } from '../../shared/trophies';
import { DESIGN_NAMES, Design } from '../../web/src/trophies/designs';
import { materialFor, paintFor } from '../../web/src/trophies/materials';
import { TrophyArt, type TrophyLook } from '../../web/src/trophies/Trophy';

function look(id: string, state: TrophyState, over: Partial<TrophyLook> = {}): TrophyLook {
  const def = TROPHIES.find((t) => t.id === id)!;
  const year = def.yearly ? 2026 : null;
  return {
    key: id,
    id,
    name: trophyName(def, year),
    group: def.group,
    rank: def.rank,
    stars: def.stars ?? 0,
    rankLabel: rankLabel(def.rank, def.stars ?? 0),
    shape: def.shape,
    design: def.design,
    designStep: def.designStep,
    engraving: def.engraving,
    state,
    year,
    earnedOn: state === 'earned' ? '2026-11-02' : null,
    ...over,
  };
}
const draw = (t: TrophyLook) => renderToStaticMarkup(createElement(TrophyArt, { t }));
/** The visible drawing only (the <defs> also hold a copy of the art as the silhouette mask). */
const visible = (t: TrophyLook) => draw(t).split('</defs>')[1]!;

describe('trophy drawings', () => {
  it('every design family used by the catalog exists', () => {
    for (const t of TROPHIES) expect(DESIGN_NAMES, t.id).toContain(t.design);
  });

  it('every rank has a material; ranks 8 to 11 are inlaid, 12 is the Arc40 ring', () => {
    for (const r of RANKS) {
      const m = materialFor(r.id);
      expect(m.body).toHaveLength(3);
      expect(!!m.inlay, r.id).toBe(r.material === 'inlaid');
      expect(m.arc, r.id).toBe(r.material === 'arc');
    }
  });

  it('every trophy draws in every state: earned is lit with a sheen, On is line art over the ghost, Off only the ghost', () => {
    for (const t of TROPHIES) {
      const earned = visible(look(t.id, 'earned'));
      expect(earned, t.id).toContain('class="tr-art"');
      expect(earned, t.id).toContain('class="tr-sheen"');
      const on = visible(look(t.id, 'on'));
      expect(on).toContain('tr-ghost');
      expect(on).toContain('tr-line');
      expect(on).not.toContain('class="tr-sheen"');
      const off = visible(look(t.id, 'off'));
      expect(off).toContain('tr-ghost');
      expect(off).not.toContain('tr-line');
    }
  });

  it('colors come only from tokens, even in the generated SVG', () => {
    const svg = TROPHIES.map((t) => draw(look(t.id, 'earned'))).join('');
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![\w-])/);
    expect(svg).not.toMatch(/\brgba?\(/);
  });

  it('Arc40 stars, the streak notches, the year and plaque records are drawn', () => {
    expect(visible(look('nw.10m', 'earned')).match(/<polygon[^>]*tr-arc-core/g)).toHaveLength(3);
    expect(visible(look('roth.streak.2', 'earned')).match(/<line x1="\d+(\.\d+)?" y1="24.5"/g)).toHaveLength(2);
    expect(draw(look('roth.maxed', 'earned'))).toContain('>2026</text>');
    const plaque = draw(look('nw.high', 'earned', { records: [{ period: '2026-10', amountCents: 4_321_000, setOn: '2026-10-31' }, { period: '2026-07', amountCents: 4_010_000, setOn: '2026-07-31' }] }));
    expect(plaque).toContain('$43,210');
    expect(plaque).toContain('$40,100  Jul 2026'); // the older record, struck through
  });

  it('Round 2: the Investing and Refereeing families, their streak notches and day records (Best day ever)', () => {
    for (const id of ['inv.worth.10k', 'inv.growth.1k', 'inv.streak.6', 'inv.best-day', 'ref.lifetime.1k', 'ref.month.1k', 'ref.streak.6', 'ref.record-year']) {
      expect(visible(look(id, 'earned')), id).toContain('class="tr-art"');
    }
    // One notch on the cup's lip per month (6 months = 6 notches; long streaks are capped at 24 like Round 1).
    expect(visible(look('inv.streak.6', 'earned')).match(/<line x1="\d+(\.\d+)?" y1="24.5"/g)).toHaveLength(6);
    expect(visible(look('ref.streak.12', 'earned')).match(/<line x1="\d+(\.\d+)?" y1="24.5"/g)).toHaveLength(12);
    const best = draw(look('inv.best-day', 'earned', { records: [{ period: '2026-10-14', amountCents: 41_250, setOn: '2026-10-14' }, { period: '2026-05-04', amountCents: 28_800, setOn: '2026-05-04' }] }));
    expect(best).toContain('Oct 14 2026');
    expect(best).toContain('May 4 2026');
  });

  it('Round 3: the Emergency fund and Spending habits families draw, with one lip notch per month on their cups', () => {
    for (const t of TROPHIES.filter((x) => x.group === 'emergency' || x.group === 'spending')) {
      for (const state of ['earned', 'on', 'off'] as const) expect(draw(look(t.id, state)), `${t.id} ${state}`).toContain('<svg');
      expect(visible(look(t.id, 'earned')), t.id).toContain('class="tr-art"');
    }
    const notches = (id: string) => visible(look(id, 'earned')).match(/<line x1="\d+(\.\d+)?" y1="24.5"/g)?.length ?? 0;
    expect(notches('em.funded.12')).toBe(12);
    expect(notches('sp.earn.3')).toBe(3);
    expect(notches('sp.budget.1')).toBe(1);
    expect(notches('sp.earn.60')).toBe(24); // capped like every long streak
    // The savings rate jars show their percent; the year jar sits on a calendar.
    expect(visible(look('sp.rate-month.20', 'earned'))).toContain('>20%</text>');
    expect(visible(look('sp.rate-year.40', 'earned'))).toContain('>40%</text>');
    // Each ladder step is a different picture (the design grows as the ladder climbs), drawn in one metal.
    const paint = paintFor('t', materialFor('gold'));
    for (const ladder of ['em-months', 'em-funded', 'em-savings', 'em-interest', 'sp-earn', 'sp-rate-month', 'sp-rate-year', 'sp-budget', 'sp-cut']) {
      const steps = TROPHIES.filter((t) => t.ladder === ladder);
      const arts = steps.map((t) => renderToStaticMarkup(createElement(Design, { name: t.design, step: t.designStep, p: paint })));
      expect(new Set(arts).size, ladder).toBe(steps.length);
    }
  });

  it('Round 4: the Keeping things tidy and The long game families and The Arc draw, with their notches and plates', () => {
    for (const t of TROPHIES.filter((x) => x.group === 'tidy' || x.group === 'long_game' || x.group === 'the_arc')) {
      for (const state of ['earned', 'on', 'off'] as const) expect(draw(look(t.id, state)), `${t.id} ${state}`).toContain('<svg');
      expect(visible(look(t.id, 'earned')), t.id).toContain('class="tr-art"');
    }
    const notches = (id: string) => visible(look(id, 'earned')).match(/<line x1="\d+(\.\d+)?" y1="24.5"/g)?.length ?? 0;
    expect(notches('td.clean.1')).toBe(1);
    expect(notches('td.clean.24')).toBe(24);
    expect(notches('td.import.12')).toBe(12);
    expect(notches('td.import.36')).toBe(24); // capped like every long streak
    expect(notches('td.backup.6')).toBe(6);
    expect(notches('lg.perfect-year')).toBe(12);
    // Each ladder step is a different picture, drawn in one metal.
    const paint = paintFor('t', materialFor('gold'));
    for (const ladder of ['td-clean', 'td-import', 'td-tracked', 'td-rules', 'td-sorted', 'td-backup', 'lg-years', 'lg-goals', 'lg-perfect', 'lg-wrapped', 'lg-collector']) {
      const steps = TROPHIES.filter((t) => t.ladder === ladder);
      const arts = steps.map((t) => renderToStaticMarkup(createElement(Design, { name: t.design, step: t.designStep, p: paint })));
      expect(new Set(arts).size, ladder).toBe(steps.length);
    }
    // Plates fit: the cup plates stay at 16 characters or fewer (longer ones ran off the plate).
    for (const t of TROPHIES.filter((x) => (x.group === 'tidy' || x.group === 'long_game') && x.shape === 'cup')) expect(t.engraving.length, t.id).toBeLessThanOrEqual(16);
    // The Arc: its own shape with the gold plate, the glowing gem, and no extra Arc40 ring around it (it IS the ring).
    const arc = visible(look('the-arc', 'earned'));
    expect(arc).toContain('THE ARC · AGE 40');
    expect(arc).toContain('tr-core-glow');
    expect(arc).not.toContain('rotate(-210');
    expect(visible(look('lg.collector.all', 'earned'))).toContain('rotate(-210'); // an Arc40 coin still gets its ring
    // The anniversary banner reads ARC40 · year.
    expect(visible(look('lg.anniversary', 'earned', { engraving: 'ARC40 · 2027', year: 2027 }))).toContain('ARC40 · 2027');
  });

  it('no perfectly straight line is painted with a metal gradient (it would not show: draw a bar instead)', () => {
    // A gradient measured on the shape's own box cannot paint a line with no width or height, so the part vanished.
    const svg = TROPHIES.map((t) => visible(look(t.id, 'earned'))).join('');
    const straight = [...svg.matchAll(/<path d="M\s?[\d.-]+ [\d.-]+ [HV]\s?[\d.-]+"[^>]*stroke="url\(/g)].map((m) => m[0]);
    expect(straight).toEqual([]);
  });

  it('the drawing preview only exists in development builds', () => {
    const app = fs.readFileSync(path.resolve('web/src/App.tsx'), 'utf8');
    expect(app).toMatch(/import\.meta\.env\.DEV \? lazy\(\(\) => import\('\.\/trophies\/TrophyPreview'\)\) : null/);
  });
});
