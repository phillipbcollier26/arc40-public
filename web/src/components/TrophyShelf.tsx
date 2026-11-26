/**
 * The Dashboard's Trophies card (Trophies Round 2), right under the net worth hero. Three versions:
 *   - trophies earned: the 5 most recently awarded on a small lit glass shelf (newest first, it has the NEW tag), the
 *     same drawings, tilt and sheen as the Trophy Case; a click opens the close-up. On the right, "Closest to earning"
 *     with the single On trophy closest to being earned.
 *   - nothing earned yet but some On: only the closest box, with "Your first trophy is on its way".
 *   - everything Off: one small line pointing to the Trophy Case (no empty shelf).
 * Data: GET /api/trophies/shelf (read-only). It reloads after every trophy check.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Trophy as TrophyIcon } from 'lucide-react';
import { rankInfo } from '../../../shared/trophies';
import { onTrophiesChecked } from '../lib/api';
import { useApi } from '../lib/useApi';
import type { TrophyShelfData, TrophyView } from '../lib/types';
import { shortDate, Trophy, TrophyArt } from '../trophies/Trophy';
import { ProgressBar, TrophyCloseup } from './TrophyCloseup';

/** "Gold", "Arc40 1 star". */
function rankName(t: TrophyView): string {
  return `${rankInfo(t.rank).label}${t.stars ? ` ${t.stars} star${t.stars > 1 ? 's' : ''}` : ''}`;
}

function Closest({ t, onOpen, first }: { t: TrophyView | null; onOpen: (key: string) => void; first: boolean }) {
  return (
    <div className="dt-closest">
      <div className="label">Closest to earning</div>
      {first && <p className="dt-first">Your first trophy is on its way.</p>}
      {t && t.progress ? (
        <button className="dt-closest-item" onClick={() => onOpen(t.key)} aria-label={`${t.name}, ${rankName(t)}, ${t.progress.text}`}>
          <TrophyArt t={t} size={64} />
          <span className="dt-closest-text">
            <span className="dt-closest-name">{t.name}</span>
            <ProgressBar fraction={t.progress.fraction} />
            <span className="hint num">
              {rankName(t)} · {t.progress.text}
            </span>
          </span>
        </button>
      ) : (
        <p className="hint">Turn on more trophies in the case to see what is next.</p>
      )}
    </div>
  );
}

export function DashboardTrophies() {
  const { data, reload } = useApi<TrophyShelfData>('/api/trophies/shelf');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => onTrophiesChecked(reload), [reload]);
  const close = useCallback(() => setOpen(null), []);

  if (!data) return null; // no placeholder: the card's size depends on which version it is
  const { counts, recent, closest } = data;

  if (counts.earned === 0 && counts.on === 0) {
    return (
      <Link to="/trophies" className="card dt-off rise" style={{ animationDelay: '60ms' }}>
        <TrophyIcon size={16} />
        <span>Turn on trophies in the Trophy Case</span>
        <ChevronRight size={16} className="dt-off-arrow" />
      </Link>
    );
  }

  return (
    <section className={`card dash-trophies rise${counts.earned === 0 ? ' is-first' : ''}`} style={{ animationDelay: '60ms' }} aria-label="Trophies">
      <div className="dt-head">
        <h3 className="icon-title">
          <TrophyIcon size={18} /> Trophies
        </h3>
        <span className="hint num">{counts.earned} earned</span>
        <Link to="/trophies" className="dt-open">
          Open the case <ChevronRight size={14} />
        </Link>
      </div>
      <div className="dt-body">
        {counts.earned > 0 && (
          <div className="tc-shelf dt-shelf" role="list" aria-label="Newest trophies">
            {recent.map((t) => (
              <div key={t.key} className="tc-item dt-item" role="listitem">
                <Trophy t={t} size={112} onOpen={() => setOpen(t.key)} isNew={t.isNew} />
                <div className="tc-item-name">{t.name}</div>
                <div className="hint dt-meta">
                  {rankName(t)}
                  {t.earnedOn ? ` · ${shortDate(t.earnedOn)}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
        <Closest t={closest} onOpen={setOpen} first={counts.earned === 0} />
      </div>
      {open && <TrophyCloseup trophyKey={open} onClose={close} onChanged={reload} />}
    </section>
  );
}
