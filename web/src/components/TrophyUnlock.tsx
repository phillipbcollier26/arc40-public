/**
 * The unlock pop-up (Trophies Round 2): a full-screen moment for every newly earned trophy, one after another.
 *
 * How it decides what to show (each award exactly once, across reloads and tabs):
 *   1. After any request that can award trophies (api.ts `onTrophiesAwarded`: a check, a Turn on, a whole shelf) and
 *      once when the app opens, it asks GET /api/trophies/unseen (read-only) what is waiting.
 *   2. It waits while another full-screen view or dialog is open (anything with aria-modal: Wrapped, the money river
 *      full screen, a Modal, the trophy close-up) and while the tab is hidden.
 *   3. Just before showing, it claims the queue with POST /api/trophies/celebrate; only what THIS tab claimed is shown,
 *      so a second tab shows nothing. If the browser closes before step 3, the awards are still waiting next time.
 *   Closing (Esc, a click outside the trophy and buttons, Done, Skip the rest, See it in the case) is all the same:
 *   the whole queue was claimed when it opened.
 * Order: lowest rank first, the biggest last (the server sorts). "Play an unlock" (demo only) shows the same moment
 * with three demo trophies and claims nothing.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Volume2, VolumeX } from 'lucide-react';
import { rankInfo } from '../../../shared/trophies';
import { api, onTrophiesAwarded } from '../lib/api';
import { hearTrophySound, installTrophyAudio, playUnlock, unlockTrophyAudio } from '../lib/trophySound';
import type { UnlockItem } from '../lib/types';
import { materialFor } from '../trophies/materials';
import { TrophyArt } from '../trophies/Trophy';
import { useReducedMotion } from './MoneyRiver';

interface UnlockApi {
  /** Demo only: play the moment with these trophies; nothing is claimed. */
  play: (items: UnlockItem[]) => void;
}
const UnlockContext = createContext<UnlockApi>({ play: () => {} });
export const useTrophyUnlock = () => useContext(UnlockContext);

/** Another full-screen view or dialog is open (the pop-up itself does not count). */
function otherDialogOpen(): boolean {
  return [...document.querySelectorAll('[aria-modal="true"]')].some((el) => !el.closest('.tu-root'));
}
function canShow(): boolean {
  return document.visibilityState === 'visible' && !otherDialogOpen();
}
/** Resolves once nothing else is open and the tab is visible. */
function whenFree(): Promise<void> {
  if (canShow()) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (!canShow()) return;
      obs.disconnect();
      document.removeEventListener('visibilitychange', check);
      // Let a closing dialog finish (focus goes back where it was) before the pop-up takes the screen.
      window.setTimeout(resolve, 250);
    };
    const obs = new MutationObserver(check);
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] });
    document.addEventListener('visibilitychange', check);
  });
}

/** The trophy's metal for the rays, the spotlight and the name: [light, middle, dark] token names. */
export function unlockPalette(rank: UnlockItem['rank']): { ray: string; hi: string; mid: string; lo: string } {
  const m = materialFor(rank);
  const [hi, mid, lo] = m.body;
  if (m.inlay) return { ray: m.accent, hi, mid: m.accent, lo }; // platinum with the gem set in: the gem's color leads
  return { ray: mid, hi, mid, lo };
}

export function UnlockProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<{ items: UnlockItem[]; demo: boolean } | null>(null);
  const running = useRef(false);
  const again = useRef(false);
  const showing = useRef(false);
  showing.current = queue !== null;

  const check = useCallback(async () => {
    if (running.current || showing.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        again.current = false;
        const { trophies } = await api<{ trophies: UnlockItem[] }>('GET', '/api/trophies/unseen');
        if (!trophies.length) continue;
        await whenFree();
        const { claimed } = await api<{ claimed: string[] }>('POST', '/api/trophies/celebrate', {
          items: trophies.map((t) => ({ key: t.key, award: t.award })),
        });
        const mine = trophies.filter((t) => claimed.includes(t.key));
        if (mine.length) {
          setQueue({ items: mine, demo: false });
          return; // the rest waits until this queue closes
        }
      } while (again.current);
    } catch {
      /* quiet: the awards stay waiting and show next time */
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    installTrophyAudio();
    const off = onTrophiesAwarded(() => void check());
    return () => {
      off();
    };
  }, [check]);

  const close = useCallback(() => {
    setQueue(null);
    showing.current = false;
    if (again.current) void check();
  }, [check]);

  const value = useMemo<UnlockApi>(() => ({ play: (items) => items.length && setQueue({ items, demo: true }) }), []);
  return (
    <UnlockContext.Provider value={value}>
      {children}
      {queue && <UnlockPopup items={queue.items} demo={queue.demo} onClose={close} />}
    </UnlockContext.Provider>
  );
}

function UnlockPopup({ items, demo, onClose }: { items: UnlockItem[]; demo: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [sound, setSound] = useState<boolean | null>(null);
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<Element | null>(document.activeElement);
  const t = items[i]!;
  const last = i === items.length - 1;
  const pal = unlockPalette(t.rank);

  useEffect(() => {
    api<{ trophySound: boolean }>('GET', '/api/preferences')
      .then((p) => setSound(p.trophySound !== false))
      .catch(() => setSound(false));
  }, []);

  // The chime as each trophy rises (only when sound is on and the browser allows it).
  useEffect(() => {
    if (sound) playUnlock(rankInfo(t.rank).level, t.stars, t.shape === 'arc'); // The Arc: the grand version
  }, [t.key, t.rank, t.stars, sound]);

  // Focus moves into the pop-up and comes back where it was when it closes.
  useEffect(() => {
    primary.current?.focus();
  }, [i]);
  useEffect(() => {
    const back = returnTo.current;
    return () => {
      if (back instanceof HTMLElement && document.contains(back)) back.focus();
    };
  }, []);

  const finish = useCallback(() => onClose(), [onClose]);
  const next = () => (last ? finish() : setI((x) => x + 1));
  const seeInCase = () => {
    finish();
    navigate(`/trophies?open=${encodeURIComponent(t.key)}`);
  };
  const toggleSound = async () => {
    unlockTrophyAudio();
    const nextOn = !sound;
    setSound(nextOn);
    try {
      await api('PUT', '/api/preferences', { trophySound: nextOn });
    } catch {
      setSound(!nextOn);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish();
      return;
    }
    if (e.key !== 'Tab' || !root.current) return;
    const f = [...root.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
    if (!f.length) return;
    const first = f[0]!;
    const end = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      end.focus();
    } else if (!e.shiftKey && document.activeElement === end) {
      e.preventDefault();
      first.focus();
    }
  };
  // A click anywhere except the trophy itself and the buttons closes it.
  const onClick = (e: React.MouseEvent) => {
    const el = e.target as Element;
    if (el.closest('button, .tu-trophy')) return;
    finish();
  };

  const style = {
    '--tu-ray': `var(${pal.ray})`,
    '--tu-hi': `var(${pal.hi})`,
    '--tu-mid': `var(${pal.mid})`,
    '--tu-lo': `var(${pal.lo})`,
  } as CSSProperties;

  return createPortal(
    <div
      ref={root}
      className={`tu-root${reduced ? ' is-reduced' : ''}${t.rank === 'arc40' ? ' is-arc' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Trophy earned: ${t.name}`}
      style={style}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      {!reduced && <div className="tu-rays" aria-hidden="true" />}
      <div className="tu-spot" aria-hidden="true" />
      <button
        className="btn btn-ghost icon-btn tu-mute"
        onClick={() => void toggleSound()}
        aria-label={sound ? 'Turn trophy sounds off' : 'Turn trophy sounds on'}
        aria-pressed={sound === false}
        title={sound ? 'Trophy sounds are on' : 'Trophy sounds are off'}
        disabled={sound === null}
      >
        {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
      </button>

      <div className="tu-stage" key={`${t.key}-${i}`}>
        <div className="tu-trophy">
          <TrophyArt t={{ ...t, state: 'earned' }} size={220} idPrefix="tu" />
        </div>
        <div className="tu-text">
          <div className="tu-kicker">Trophy earned{demo ? ' · Demo replay' : ''}</div>
          <h2 className="tu-name">{t.name}</h2>
          <div className="tu-chips">
            <span className="tu-chip">{t.rankLabel}</span>
            <span className="tu-chip">{t.groupLabel}</span>
          </div>
          {t.sentence && <p className="tu-fact">{t.sentence}</p>}
          {demo && <p className="tu-note">Played from demo mode: nothing was awarded.</p>}
          {items.length > 1 && (
            <div className="tu-progress">
              <span className="num">
                {i + 1} of {items.length}
              </span>
              <span className="tu-dots" aria-hidden="true">
                {items.map((x, k) => (
                  <span key={x.key} className={`tu-dot${k === i ? ' is-on' : k < i ? ' is-done' : ''}`} />
                ))}
              </span>
            </div>
          )}
          <div className="tu-actions">
            <button ref={primary} className="btn btn-primary" onClick={next}>
              {last ? 'Done' : `Next trophy (${i + 2} of ${items.length})`}
            </button>
            <button className="btn" onClick={seeInCase}>
              See it in the case
            </button>
            {items.length > 1 && !last && (
              <button className="btn btn-ghost btn-sm tu-skip" onClick={finish}>
                Skip the rest
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Settings > Trophy sounds: on by default; the pop-up's mute button turns the same setting off. */
export function TrophySoundCard() {
  const [on, setOn] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api<{ trophySound: boolean }>('GET', '/api/preferences')
      .then((p) => setOn(p.trophySound !== false))
      .catch(() => setOn(true));
  }, []);
  const toggle = async (next: boolean) => {
    setOn(next);
    setMsg(null);
    try {
      await api('PUT', '/api/preferences', { trophySound: next });
      setMsg(next ? 'Trophy sounds are on.' : 'Trophy sounds are off.');
    } catch {
      setOn(!next);
      setMsg('Could not save. Try again.');
    }
  };
  return (
    <section className="card rise stack" style={{ animationDelay: '45ms' }}>
      <h3 className="icon-title">
        <Volume2 size={18} /> Trophy sounds
      </h3>
      <p className="muted">A short, soft chime when a trophy is earned, richer for higher ranks. Separate from the Arc40 Wrapped sound.</p>
      <label className="check">
        <input type="checkbox" checked={on === true} disabled={on === null} onChange={(e) => void toggle(e.target.checked)} aria-label="Trophy sounds" />
        <span>Play a chime when a trophy is earned (made on this Mac, nothing is downloaded)</span>
      </label>
      <div className="wr-sound-row">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => void hearTrophySound()}
        >
          <Volume2 size={14} /> Hear it
        </button>
        {msg && <span className="hint">{msg}</span>}
      </div>
    </section>
  );
}
