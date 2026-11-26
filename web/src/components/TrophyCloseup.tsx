/**
 * The close-up view of one trophy (Trophies Round 1): big trophy, rank and group chips, name and subtitle, earned date and
 * how it was counted, one plain sentence, a small "How you got there" chart, progress (On) or what is still needed,
 * the next rung of the same ladder, and the buttons: Back to the case, Take it back (earned), Turn on (off) with the
 * "Count my history / Start from today" question, Turn off (on). Esc closes.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ARC_GROUP, TROPHY_GROUPS } from '../../../shared/trophies';
import { api } from '../lib/api';
import { formatCents, formatCompactCents, formatDate } from '../lib/format';
import type { TrophyDetail, TrophyEarned } from '../lib/types';
import { useApi } from '../lib/useApi';
import { Trophy, shortDate } from '../trophies/Trophy';
import { materialFor } from '../trophies/materials';

const wholeMoney = (c: number) => formatCompactCents(c);

export function ProgressBar({ fraction, label }: { fraction: number; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <div className="tc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** "How you got there": a small line of the values behind the trophy. */
function StoryChart({ story, accent }: { story: NonNullable<TrophyDetail['story']>; accent: string }) {
  const pts = story.points;
  if (pts.length < 2) return null;
  const W = 320;
  const H = 110;
  const vals = [...pts.map((p) => p.cents), ...(story.lineCents !== null ? [story.lineCents] : [])];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i: number) => 4 + (i * (W - 8)) / (pts.length - 1);
  const y = (c: number) => 8 + (1 - (c - lo) / span) * (H - 16);
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.cents).toFixed(1)}`).join(' ');
  return (
    <figure className="tc-story">
      <figcaption className="label">How you got there: {story.label}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${story.label}, from ${formatDate(pts[0]!.date)} to ${formatDate(pts.at(-1)!.date)}`}>
        <polygon points={`${x(0)},${H} ${line} ${x(pts.length - 1)},${H}`} style={{ fill: `var(${accent})`, opacity: 0.12 }} />
        {story.lineCents !== null && <line x1="0" x2={W} y1={y(story.lineCents)} y2={y(story.lineCents)} strokeDasharray="4 4" style={{ stroke: 'var(--text-2)' }} strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        <polyline points={line} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" style={{ stroke: `var(${accent})` }} />
      </svg>
      <div className="tc-story-axis num">
        <span>{formatDate(pts[0]!.date)}</span>
        <span>
          {wholeMoney(lo)} to {wholeMoney(hi)}
          {story.lineCents !== null ? ` · line ${wholeMoney(story.lineCents)}` : ''}
        </span>
        <span>{formatDate(pts.at(-1)!.date)}</span>
      </div>
    </figure>
  );
}

export function TrophyCloseup({ trophyKey, onClose, onChanged }: { trophyKey: string; onClose: () => void; onChanged: () => void }) {
  const { data: t, reload, error } = useApi<TrophyDetail>(`/api/trophies/${encodeURIComponent(trophyKey)}`);
  const [asking, setAsking] = useState(false);
  const [mode, setMode] = useState<'history' | 'today' | null>(null);
  const [confirmTake, setConfirmTake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    box.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setFail(null);
    try {
      await fn();
      reload();
      onChanged();
    } catch (e) {
      setFail((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const turnOn = () =>
    act(async () => {
      const m = mode ?? t!.defaultMode;
      const r = await api<{ earned: TrophyEarned[] }>('POST', `/api/trophies/${encodeURIComponent(trophyKey)}/on`, { mode: m });
      setAsking(false);
      // Earned right away: the close-up steps aside so the unlock pop-up can take the screen.
      if (r.earned.length) {
        onClose();
        return;
      }
      setMessage(
        r.earned.length
          ? `Earned! ${m === 'history' ? 'Arc40 looked back through your data and' : 'It'} qualified on ${shortDate(r.earned[0]!.earnedOn)}.`
          : 'Turned on. Arc40 is watching it now.',
      );
    });

  const group = t?.group === ARC_GROUP.id ? ARC_GROUP.label : TROPHY_GROUPS.find((g) => g.id === t?.group)?.label;
  const accent = t ? materialFor(t.rank).accent : '--gold';
  const content = !t ? (
    <p className="muted">{error ?? 'Loading...'}</p>
  ) : (
    <div className="tc-close-grid">
      <div className={`tc-close-art is-${t.state}`}>
        <Trophy t={t} size={220} />
      </div>
      <div className="tc-close-info stack">
        <div className="tc-chips">
          <span className="chip tc-rank-chip" style={{ borderColor: `var(${accent})` }}>
            {t.rankLabel}
          </span>
          <span className="chip">
            {group} · {t.kindLabel}
          </span>
          {t.isNew && <span className="chip tc-new-chip">NEW</span>}
        </div>
        <div>
          <h2 className="tc-close-name">{t.name}</h2>
          <p className="muted">{t.subtitle}</p>
        </div>

        {t.state === 'earned' && (
          <div className="tc-earned">
            <div className="tc-earned-date">Earned {t.earnedOn ? shortDate(t.earnedOn) : ''}</div>
            <div className="hint">{t.howCounted}</div>
            {t.sentence && <p className="tc-sentence">{t.sentence}</p>}
          </div>
        )}

        {t.records.length > 0 && (
          <div className="tc-records">
            <div className="label">Records</div>
            <ol>
              {t.records.slice(0, 6).map((r, i) => (
                <li key={r.period} className={i === 0 ? 'is-current' : ''}>
                  {i === 0 ? (
                    <span className="num">
                      {formatCents(r.amountCents)} · {formatDate(r.setOn)}
                    </span>
                  ) : (
                    <s className="num">
                      {formatCents(r.amountCents)} · {formatDate(r.setOn)}
                    </s>
                  )}
                </li>
              ))}
            </ol>
            {t.records.length > 6 && <div className="hint">and {t.records.length - 6} older records, all kept</div>}
          </div>
        )}

        {t.state === 'on' && t.progress && (
          <div className="tc-progress stack">
            <div className="tc-progress-head">
              <span className="num">{t.progress.text}</span>
              <span className="hint">{t.howCounted}</span>
            </div>
            {!t.blocked && <ProgressBar fraction={t.progress.fraction} label={`${t.name} progress`} />}
            {t.blocked ? <p className="tc-blocked">{t.blocked}</p> : t.progress.need && <p className="muted">Still needed: {t.progress.need}</p>}
          </div>
        )}
        {t.state === 'off' && t.preview && (
          <p className="muted">
            Off: Arc40 is not watching this one. Right now: <span className="num">{t.preview.text}</span>.
          </p>
        )}

        {t.story && <StoryChart story={t.story} accent={accent} />}

        {t.next && (
          <div className="tc-next">
            <div className="tc-progress-head">
              <span>
                Next: <strong>{t.next.name}</strong> · {t.next.rankLabel} · {Math.round(t.next.fraction * 100)}%
              </span>
              <span className="hint num">{t.next.text}</span>
            </div>
            <ProgressBar fraction={t.next.fraction} label={`Progress toward ${t.next.name}`} />
          </div>
        )}

        {message && <div className="tc-message" role="status">{message}</div>}
        {fail && <p className="hint is-error">{fail}</p>}

        {asking && t.state === 'off' && (
          <fieldset className="tc-ask">
            <legend>How should Arc40 count it?</legend>
            {(
              [
                ['history', 'Count my history', 'Look back through all your data. The earned date is the real day it first qualified.'],
                ['today', 'Start from today', 'Only what happens from today on counts.'],
              ] as const
            ).map(([value, title, text]) => (
              <label key={value} className={`tc-option${(mode ?? t.defaultMode) === value ? ' is-picked' : ''}`}>
                <input type="radio" name="tc-mode" value={value} checked={(mode ?? t.defaultMode) === value} onChange={() => setMode(value)} />
                <span>
                  <strong>{title}</strong>
                  {t.defaultMode === value && <span className="chip tc-suggested">Suggested</span>}
                  <span className="hint">{text}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <div className="tc-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Back to the case
          </button>
          {t.state === 'off' &&
            (asking ? (
              <>
                <button className="btn" onClick={() => setAsking(false)} disabled={busy}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={() => void turnOn()} disabled={busy}>
                  Turn on
                </button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={() => setAsking(true)}>
                Turn on
              </button>
            ))}
          {t.state === 'on' && (
            <button className="btn" disabled={busy} onClick={() => void act(async () => {
              await api('POST', `/api/trophies/${encodeURIComponent(trophyKey)}/off`);
              setMessage('Turned off. Arc40 stopped watching it.');
            })}>
              Turn off
            </button>
          )}
          {t.state === 'earned' &&
            (confirmTake ? (
              <>
                <span className="hint">It goes back to Off. Nothing is deleted.</span>
                <button className="btn" onClick={() => setConfirmTake(false)} disabled={busy}>
                  Keep it
                </button>
                <button className="btn btn-danger" disabled={busy} onClick={() => void act(async () => {
                  await api('POST', `/api/trophies/${encodeURIComponent(trophyKey)}/take-back`);
                  setConfirmTake(false);
                  setMessage('Taken back. It is Off now and will not be awarded again unless you turn it on.');
                })}>
                  Yes, take it back
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => setConfirmTake(true)}>
                Take it back
              </button>
            ))}
        </div>
      </div>
    </div>
  );

  return createPortal(
    <div className="tc-closeup-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tc-closeup card" role="dialog" aria-modal="true" aria-label={t ? `${t.name}, close-up` : 'Trophy close-up'} tabIndex={-1} ref={box}>
        <button className="btn btn-ghost icon-btn tc-close-x" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        {content}
      </div>
    </div>,
    document.body,
  );
}
