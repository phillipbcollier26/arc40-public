/**
 * The Trophy Case (Trophies Round 1).
 *   header       title + Earned / Watching / Off counts
 *   The Arc      Round 4: the one-of-a-kind trophy in its own spot at the top (not on a shelf, never hidden by the filters):
 *                Off (with a link to Settings when no birth month is saved), On with its time progress, or Earned
 *   closest      the 3 On trophies closest to being earned, with progress bars and ranks
 *   filters      All / Earned / Watching, one chip per shelf, and "Show off trophies" (Off ones are hidden by default
 *                and appear at the end of each shelf when shown)
 *   shelves      one per group, fixed order, only groups that have trophies; "X of Y earned", "Turn on whole group"
 *                (with a confirm step that says how many); trophies on a lit glass shelf that scrolls sideways, in the
 *                server's order (earned newest first, On by how close, Off last)
 * Opening the page asks the server to check the On trophies first (an explicit POST; GETs never write).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Trophy as TrophyIcon } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePlanning } from '../lib/planning';
import { useMode } from '../lib/demo';
import { useTrophyUnlock } from '../components/TrophyUnlock';
import { TROPHY_GROUPS, type TrophyGroup } from '../../../shared/trophies';
import { api, checkTrophies, onTrophiesChecked } from '../lib/api';
import { useApi } from '../lib/useApi';
import type { TrophiesResponse, TrophyEarned, TrophyView, UnlockItem } from '../lib/types';
import { Segmented } from '../components/Controls';
import { Modal } from '../components/Modal';
import { ProgressBar, TrophyCloseup } from '../components/TrophyCloseup';
import { Trophy, TrophyArt, shortDate } from '../trophies/Trophy';

type Filter = 'all' | 'earned' | 'on';

function ShelfItem({ t, onOpen }: { t: TrophyView; onOpen: () => void }) {
  return (
    <div className="tc-item" role="listitem">
      <Trophy t={t} size={112} onOpen={onOpen} isNew={t.isNew} />
      <div className="tc-item-name">{t.name}</div>
      {t.state === 'on' && t.progress && (
        <div className="tc-item-progress">
          {!t.blocked && <ProgressBar fraction={t.progress.fraction} label={`${t.name} progress`} />}
          <span className="hint num">{t.blocked ?? t.progress.text}</span>
        </div>
      )}
    </div>
  );
}

export const ARC_NO_BIRTH_LINE = 'Set your birth month in Settings to watch The Arc';

/** Round 4: The Arc in its reserved spot. `hasBirth` = a birth month is saved (null while Settings are still loading). */
function ArcSpot({ t, hasBirth, onOpen }: { t: TrophyView; hasBirth: boolean | null; onOpen: () => void }) {
  const needsBirth = hasBirth === false || (t.state === 'on' && !!t.blocked && /birth month/i.test(t.blocked));
  return (
    <section className="card tc-arc rise" style={{ animationDelay: '30ms' }} aria-label="The Arc" data-arc-slot="" data-state={t.state}>
      <div className="tc-arc-art">
        <Trophy t={t} size={150} onOpen={onOpen} />
      </div>
      <div className="tc-arc-text">
        <div className="label">The one and only</div>
        <h2 className="tc-arc-title">The Arc</h2>
        <p className="muted">{t.subtitle}. Earned on the 1st of the month you turn 40.</p>
        {t.state === 'earned' && (
          <>
            <p className="tc-arc-earned">Earned {t.earnedOn ? shortDate(t.earnedOn) : ''}</p>
            {t.sentence && <p>{t.sentence}</p>}
          </>
        )}
        {t.state !== 'earned' && needsBirth && (
          <Link className="tc-arc-link" to="/settings">
            {ARC_NO_BIRTH_LINE}
          </Link>
        )}
        {t.state === 'on' && !needsBirth && t.progress && (
          <div className="tc-arc-progress">
            <span className="tc-arc-left num">{t.progress.text}</span>
            {!t.blocked && <ProgressBar fraction={t.progress.fraction} label="The Arc progress" />}
            <span className="hint">{t.blocked ?? t.progress.need}</span>
          </div>
        )}
        {t.state === 'off' && hasBirth === true && (
          <p className="muted">
            Off.{' '}
            <button className="btn btn-sm" onClick={onOpen}>
              Turn it on to watch the years count down
            </button>
          </p>
        )}
      </div>
    </section>
  );
}

export function TrophiesPage() {
  const [checked, setChecked] = useState(false);
  const { data, reload } = useApi<TrophiesResponse>(checked ? '/api/trophies' : null);
  const [filter, setFilter] = useState<Filter>('all');
  const [group, setGroup] = useState<TrophyGroup | 'all'>('all');
  const [showOff, setShowOff] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: TrophyGroup; label: string; count: number; today: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const mode = useMode();
  const unlock = useTrophyUnlock();
  const { planning } = usePlanning();

  useEffect(() => {
    void checkTrophies().finally(() => setChecked(true));
    return onTrophiesChecked(reload);
  }, [reload]);

  const byKey = useMemo(() => new Map((data?.trophies ?? []).map((t) => [t.key, t])), [data]);

  // "See it in the case" (the unlock pop-up) links here with ?open=<key>: open that trophy's close-up once.
  const openParam = params.get('open');
  useEffect(() => {
    if (!openParam || !data) return;
    if (byKey.has(openParam)) setOpen(openParam);
    setParams({}, { replace: true });
  }, [openParam, data, byKey, setParams]);

  // Demo only: replay the unlock moment with three demo trophies (awards and marks nothing).
  const playUnlock = async () => {
    const r = await api<{ trophies: UnlockItem[] }>('GET', '/api/trophies/demo-unlock');
    unlock.play(r.trophies);
  };
  const closeOpen = useCallback(() => setOpen(null), []);

  if (!data) return <div className="page" />;
  const shelves = data.groups.filter((g) => group === 'all' || g.id === group);
  const visible = (t: TrophyView) =>
    (t.state === 'earned' && filter !== 'on') || (t.state === 'on' && filter !== 'earned') || (t.state === 'off' && showOff);

  const turnOnGroup = async () => {
    if (!confirm) return;
    const r = await api<{ turnedOn: number; earned: TrophyEarned[] }>('POST', `/api/trophies/groups/${confirm.id}/on`);
    setConfirm(null);
    setNotice(
      `Turned on ${r.turnedOn} ${r.turnedOn === 1 ? 'trophy' : 'trophies'} in ${confirm.label}.` +
        (r.earned.length ? ` ${r.earned.length} earned right away.` : ''),
    );
    reload();
  };

  return (
    <div className="page trophy-case">
      <header className="page-head rise">
        <div>
          <div className="label">Your collection</div>
          <h1 className="page-title">Trophies</h1>
        </div>
        {mode === 'demo' && (
          <button className="btn btn-sm tc-play" onClick={() => void playUnlock()}>
            <Play size={14} /> Play an unlock
          </button>
        )}
        <div className="tc-counts" aria-label="Trophy counts">
          <div className="tc-count">
            <span className="num">{data.counts.earned}</span>
            <span className="label">Earned</span>
          </div>
          <div className="tc-count">
            <span className="num">{data.counts.on}</span>
            <span className="label">Watching</span>
          </div>
          <div className="tc-count">
            <span className="num">{data.counts.off}</span>
            <span className="label">Off</span>
          </div>
        </div>
      </header>

      {/* The Arc (Round 4): its own spot, above the shelves; the filters never hide it. */}
      {data.trophies
        .filter((t) => t.group === 'the_arc')
        .map((t) => (
          <ArcSpot key={t.key} t={t} hasBirth={planning ? planning.birth !== null : null} onOpen={() => setOpen(t.key)} />
        ))}

      {notice && (
        <div className="tc-message rise" role="status">
          {notice}
        </div>
      )}

      <section className="card tc-closest rise" style={{ animationDelay: '50ms' }} aria-label="Closest to earning">
        <div className="label">
          <TrophyIcon size={13} /> Closest to earning
        </div>
        {data.closest.length === 0 ? (
          <p className="muted">Turn a trophy on and the ones you are closest to earning show up here.</p>
        ) : (
          <div className="tc-closest-list">
            {data.closest.map((k) => {
              const t = byKey.get(k)!;
              return (
                <button key={k} className="tc-closest-item" onClick={() => setOpen(k)} aria-label={`${t.name}, ${t.rankLabel}, ${t.progress?.text ?? ''}`}>
                  <TrophyArt t={t} size={56} />
                  <span className="tc-closest-text">
                    <span className="tc-closest-name">{t.name}</span>
                    <span className="chip">{t.rankLabel}</span>
                    <ProgressBar fraction={t.progress?.fraction ?? 0} />
                    <span className="hint num">{t.progress?.text}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div className="tc-filters rise" style={{ animationDelay: '90ms' }}>
        <Segmented<Filter>
          ariaLabel="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'earned', label: 'Earned' },
            { value: 'on', label: 'Watching' },
          ]}
        />
        <div className="tc-chiprow" role="group" aria-label="Shelves">
          <button className={`tc-chip${group === 'all' ? ' is-on' : ''}`} aria-pressed={group === 'all'} onClick={() => setGroup('all')}>
            Every shelf
          </button>
          {data.groups.map((g) => (
            <button key={g.id} className={`tc-chip${group === g.id ? ' is-on' : ''}`} aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        <button className={`btn btn-sm${showOff ? ' btn-primary' : ''}`} aria-pressed={showOff} onClick={() => setShowOff((v) => !v)}>
          {showOff ? 'Hide off trophies' : 'Show off trophies'}
        </button>
      </div>

      {shelves.map((g, i) => {
        const items = data.trophies.filter((t) => t.group === g.id && visible(t));
        const offTrophies = data.trophies.filter((t) => t.group === g.id && t.state === 'off');
        return (
          <section key={g.id} className="card tc-shelf-card rise" style={{ animationDelay: `${120 + i * 50}ms` }} aria-label={`${g.label} shelf`}>
            <div className="tc-shelf-head">
              <div>
                <h2 className="tc-shelf-title">{TROPHY_GROUPS.find((x) => x.id === g.id)?.label}</h2>
                <span className="hint num">
                  {g.earned} of {g.total} earned
                </span>
              </div>
              <button
                className="btn btn-sm"
                disabled={g.off === 0}
                onClick={() =>
                  setConfirm({ id: g.id, label: g.label, count: offTrophies.length, today: offTrophies.filter((t) => t.defaultMode === 'today').length })
                }
              >
                Turn on whole group
              </button>
            </div>
            {items.length ? (
              <div className="tc-shelf" role="list" aria-label={`${g.label} trophies`}>
                {items.map((t) => (
                  <ShelfItem key={t.key} t={t} onOpen={() => setOpen(t.key)} />
                ))}
              </div>
            ) : (
              <p className="muted tc-empty">
                {filter === 'earned' ? 'Nothing earned on this shelf yet.' : filter === 'on' ? 'Nothing is being watched on this shelf.' : 'Every trophy here is off.'}{' '}
                {!showOff && 'Show off trophies to pick some.'}
              </p>
            )}
          </section>
        );
      })}

      {confirm && (
        <Modal title={`Turn on the ${confirm.label} shelf?`} onClose={() => setConfirm(null)}>
          <div className="stack">
            <p>
              This turns on <strong>{confirm.count}</strong> {confirm.count === 1 ? 'trophy' : 'trophies'} in {confirm.label}. Each one uses its
              suggested setting:{' '}
              {confirm.today === 0
                ? 'Count my history for all of them.'
                : confirm.today === confirm.count
                  ? 'Start from today for all of them.'
                  : `Count my history for ${confirm.count - confirm.today}, Start from today for ${confirm.today}.`}
            </p>
            {confirm.today * 2 > confirm.count && (
              <p data-testid="today-note">
                {confirm.today === confirm.count ? 'All of these count' : 'Most of these count'} from today: only what happens after you
                turn them on counts, not your past months.
              </p>
            )}
            <p className="hint">You can turn any of them off again later.</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={() => void turnOnGroup()}>
                Turn on {confirm.count} {confirm.count === 1 ? 'trophy' : 'trophies'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {open && <TrophyCloseup trophyKey={open} onClose={closeOpen} onChanged={reload} />}
    </div>
  );
}
