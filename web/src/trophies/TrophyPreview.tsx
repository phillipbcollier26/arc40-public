/**
 * DEV ONLY (Trophies Round 1): every trophy in every state, and every rank in every shape, for screenshots and
 * design checks. Routed at #/dev/trophies only when Vite runs in dev mode (`npm run dev:web`); the production build
 * leaves it out. Uses the catalog only (fake looks), never the API.
 */
import { useState } from 'react';
import { ARC_GROUP, RANKS, TROPHIES, TROPHY_GROUPS, rankLabel, trophyName, type RankId, type Shape, type TrophyDef, type TrophyState } from '../../../shared/trophies';
import { Trophy, type TrophyLook } from './Trophy';

const RECORDS: Record<string, TrophyLook['records']> = {
  'nw.high': [
    { period: '2026-10', amountCents: 4_321_000, setOn: '2026-10-31' },
    { period: '2026-07', amountCents: 4_010_000, setOn: '2026-07-31' },
    { period: '2026-03', amountCents: 3_876_500, setOn: '2026-03-31' },
  ],
  'inv.best-day': [
    { period: '2026-10-14', amountCents: 41_250, setOn: '2026-10-14' },
    { period: '2026-05-04', amountCents: 28_800, setOn: '2026-05-04' },
  ],
  'ref.record-month': [
    { period: '2026-10', amountCents: 186_000, setOn: '2026-10-31' },
    { period: '2026-04', amountCents: 142_500, setOn: '2026-04-30' },
    { period: '2025-10', amountCents: 120_000, setOn: '2025-10-31' },
  ],
  'ref.record-year': [
    { period: '2025', amountCents: 655_000, setOn: '2025-12-31' },
    { period: '2024', amountCents: 498_000, setOn: '2024-12-31' },
  ],
  'nw.best-year': [
    { period: '2025', amountCents: 1_240_000, setOn: '2025-12-31' },
    { period: '2024', amountCents: 980_000, setOn: '2024-12-31' },
  ],
};

function look(def: TrophyDef, state: TrophyState, over: Partial<TrophyLook> = {}): TrophyLook {
  const year = def.yearly ? 2026 : null;
  return {
    key: `${def.id}${year ? `:${year}` : ''}-${state}`,
    id: def.id,
    name: trophyName(def, year),
    group: def.group,
    rank: def.rank,
    stars: def.stars ?? 0,
    rankLabel: rankLabel(def.rank, def.stars ?? 0),
    shape: def.shape,
    design: def.design,
    designStep: def.designStep,
    engraving: year ? `${def.engraving} · ${year}` : def.engraving,
    state,
    year,
    earnedOn: state === 'earned' ? '2026-11-02' : null,
    records: state === 'earned' ? RECORDS[def.id] : undefined,
    ...over,
  };
}

const SAMPLE_BY_SHAPE: Record<Shape, string> = {
  coin: 'nw.50k',
  cup: 'roth.streak.2',
  plaque: 'nw.high',
  banner: 'roth.maxed',
  statuette: 'nw.comeback',
  arc: 'the-arc',
};

export default function TrophyPreview() {
  const [state, setState] = useState<TrophyState>('earned');
  const [size, setSize] = useState(120);
  return (
    <div className="page tr-preview">
      <header className="page-head">
        <h1>Trophy drawings (dev preview)</h1>
        <div className="row" style={{ gap: 8 }}>
          {(['earned', 'on', 'off'] as const).map((s) => (
            <button key={s} className={`btn btn-sm${s === state ? ' btn-primary' : ''}`} onClick={() => setState(s)}>
              {s}
            </button>
          ))}
          {[72, 120, 200].map((s) => (
            <button key={s} className={`btn btn-sm${s === size ? ' btn-primary' : ''}`} onClick={() => setSize(s)}>
              {s}px
            </button>
          ))}
        </div>
      </header>

      {TROPHY_GROUPS.filter((g) => TROPHIES.some((t) => t.group === g.id)).map((g) => (
        <section key={g.id} className="card" data-preview-group={g.id}>
          <h2 className="label">{g.label}</h2>
          <div className="tr-preview-row">
            {TROPHIES.filter((t) => t.group === g.id).map((def) => (
              <div key={def.id} className="tr-preview-cell">
                <Trophy t={look(def, state)} size={size} isNew={state === 'earned' && def.id === 'nw.50k'} />
                <small>{trophyName(def, def.yearly ? 2026 : null)}</small>
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Round 4: The Arc is not on a shelf; shown on its own (and at its usual large size too). */}
      <section className="card" data-preview-group={ARC_GROUP.id}>
        <h2 className="label">{ARC_GROUP.label}</h2>
        <div className="tr-preview-row">
          {TROPHIES.filter((t) => t.group === ARC_GROUP.id).map((def) => (
            <div key={def.id} className="tr-preview-cell">
              <Trophy t={look(def, state)} size={size} />
              <small>{def.name}</small>
            </div>
          ))}
          {TROPHIES.filter((t) => t.group === ARC_GROUP.id).map((def) => (
            <div key={`${def.id}-big`} className="tr-preview-cell">
              <Trophy t={look(def, state, { key: `${def.id}-big-${state}` })} size={240} />
              <small>{def.name} (240 px)</small>
            </div>
          ))}
        </div>
      </section>

      <section className="card" data-preview="ranks">
        <h2 className="label">Every rank, every shape</h2>
        {(Object.keys(SAMPLE_BY_SHAPE) as Shape[]).filter((shape) => shape !== 'arc').map((shape) => {
          const def = TROPHIES.find((t) => t.id === SAMPLE_BY_SHAPE[shape])!;
          const ranks: { rank: RankId; stars: number }[] = [...RANKS.map((r) => ({ rank: r.id, stars: 0 })), { rank: 'arc40', stars: 1 }, { rank: 'arc40', stars: 2 }, { rank: 'arc40', stars: 3 }];
          return (
            <div key={shape} className="tr-preview-row">
              {ranks.map(({ rank, stars }) => (
                <div key={`${rank}${stars}`} className="tr-preview-cell">
                  <Trophy t={look(def, state, { key: `${shape}-${rank}-${stars}`, rank, stars, rankLabel: rankLabel(rank, stars) })} size={Math.min(size, 96)} />
                  <small>{rankLabel(rank, stars)}</small>
                </div>
              ))}
            </div>
          );
        })}
      </section>
    </div>
  );
}
