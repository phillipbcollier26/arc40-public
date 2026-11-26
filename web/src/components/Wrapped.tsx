/**
 * Arc40 Wrapped (V2 Phase 4): a small Dashboard card that opens a full-screen year in review.
 *
 *   intro    a gold arc draws the Arc40 ring, a metal sheen passes, "Wrapped" rises and the year counts up
 *            (about 3.5 s; a click or a key skips it)
 *   slides   one idea each, from GET /api/wrapped?year= (empty slides never come from the server)
 *   moving   click the right side or press -> / Space to go on, click the left side or press <- to go back,
 *            Esc closes; the bars at the top show where you are
 *   sound    soft generated tones (lib/wrappedSound.ts), only when Settings > Arc40 Wrapped > Sound is on
 *   reduced motion: the intro is a short fade and slides simply fade
 * Nothing here can save, export or share a slide.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Play, RotateCcw, Sparkles, Volume2, X } from 'lucide-react';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { formatBasisPoints, formatCents, formatDate } from '../lib/format';
import type { Wrapped, WrappedSlide, WrappedYears } from '../lib/types';
import { playIntro, playTick, unlockAudio } from '../lib/wrappedSound';
import { useReducedMotion } from './MoneyRiver';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const monthName = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1]!;
const yearLabel = (y: { year: number; soFar: boolean }) => (y.soFar ? `${y.year} so far` : String(y.year));
const INTRO_MS = 3600;
const INTRO_REDUCED_MS = 1400;

/** Counts up to a whole number (cents, a year, basis points). Exact at the end; instant with reduced motion. */
function useCount(target: number, ms = 1100): number {
  const reduced = useReducedMotion();
  const [v, setV] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) {
      setV(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 4);
      setV(p < 1 ? Math.round(target * eased) : target);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return v;
}

function CountCents({ cents, sign = false }: { cents: number; sign?: boolean }) {
  const v = useCount(cents);
  return (
    <span className="num" aria-label={formatCents(cents, { sign })}>
      {formatCents(v, { sign })}
    </span>
  );
}

function CountBp({ bp }: { bp: number }) {
  const v = useCount(bp);
  return (
    <span className="num" aria-label={formatBasisPoints(bp, { sign: false })}>
      {formatBasisPoints(v, { sign: false })}
    </span>
  );
}

/** A ring that fills to `bp` (basis points of a whole) when it appears. */
function Ring({ bp, tone = 'gold', children }: { bp: number; tone?: 'gold' | 'sage' | 'garnet'; children?: ReactNode }) {
  const pct = Math.max(0, Math.min(100, bp / 100));
  return (
    <div className="wr-ring-wrap">
      <svg viewBox="0 0 120 120" className="wr-ring" aria-hidden="true">
        <circle cx="60" cy="60" r="50" className="wr-ring-track" pathLength={100} />
        <circle cx="60" cy="60" r="50" className={`wr-ring-fill tone-${tone}`} pathLength={100} style={{ strokeDasharray: `${pct} 100` }} transform="rotate(-90 60 60)" />
      </svg>
      <div className="wr-ring-center">{children}</div>
    </div>
  );
}

/** Small month bars; the highlighted month glows. */
function MonthBars({ months, highlight, tone }: { months: { month: string; cents: number }[]; highlight: string; tone: 'gold' | 'garnet' }) {
  const max = Math.max(1, ...months.map((m) => m.cents));
  return (
    <div className="wr-bars" aria-hidden="true">
      {months.map((m, i) => (
        <div key={m.month} className={`wr-bar ${m.month === highlight ? `is-top tone-${tone}` : ''}`} style={{ animationDelay: `${180 + i * 45}ms` }}>
          <span className="wr-bar-fill" style={{ height: `${Math.max(2, Math.round((Math.max(0, m.cents) * 100) / max))}%` }} />
          <span className="wr-bar-label">{SHORT[Number(m.month.slice(5, 7)) - 1]}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * One coin per game or hour (the last one partly filled). Past 100 units each coin stands for 10, and the
 * line under the coins says so.
 */
function UnitCoins({ tenths, unit }: { tenths: number; unit: 'game' | 'hour' }) {
  const per = tenths > 1000 ? 10 : 1;
  const units = tenths / 10 / per;
  const whole = Math.min(100, Math.floor(units));
  const part = units < 100 ? Math.round((units - whole) * 10) : 0;
  const fills = [...Array.from({ length: whole }, () => 10), ...(part ? [part] : [])];
  return (
    <div className="wr-units">
      <div className={`wr-unit-grid coin-${unit === 'game' ? 'gold' : 'platinum'}`} aria-hidden="true">
        {fills.map((f, i) => (
          <span key={i} className="wr-unit" style={{ animationDelay: `${300 + i * 12}ms` }}>
            <span style={{ width: `${f * 10}%` }} />
          </span>
        ))}
      </div>
      <span className="wr-foot">
        One coin = {per === 1 ? 'one' : 'ten'} {unit === 'game' ? (per === 1 ? 'game' : 'games') : per === 1 ? 'hour' : 'hours'}
      </span>
    </div>
  );
}

function ListRows({ rows }: { rows: { label: string; cents: number; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.cents));
  return (
    <ul className="wr-list">
      {rows.map((r, i) => (
        <li key={`${r.label}-${i}`} style={{ animationDelay: `${300 + i * 90}ms` }}>
          <span className="wr-list-label">
            {r.label}
            {r.note && <em> · {r.note}</em>}
          </span>
          <span className="wr-list-bar">
            <span style={{ width: `${Math.round((r.cents * 100) / max)}%` }} />
          </span>
          <span className="num">{formatCents(r.cents)}</span>
        </li>
      ))}
    </ul>
  );
}

function SlideShell({ kicker, children, tone = 'gold' }: { kicker: string; children: ReactNode; tone?: string }) {
  return (
    <div className={`wr-slide wr-tone-${tone}`}>
      <div className="wr-kicker">{kicker}</div>
      {children}
    </div>
  );
}

function SlideView({ s, w }: { s: WrappedSlide; w: Wrapped }) {
  const period = w.soFar ? `so far in ${w.year}` : `in ${w.year}`;
  switch (s.kind) {
    case 'topMerchant':
      return (
        <SlideShell kicker="Your top spot">
          <h2 className="wr-big wr-name">{s.name}</h2>
          <p className="wr-line">
            <CountCents cents={s.cents} /> across {s.visits} {s.visits === 1 ? 'visit' : 'visits'} {period}, {formatBasisPoints(s.shareBp, { sign: false })} of all your spending.
          </p>
          {s.runnersUp.length > 0 && <ListRows rows={[{ label: s.name, cents: s.cents }, ...s.runnersUp.map((r) => ({ label: r.name, cents: r.cents }))]} />}
        </SlideShell>
      );
    case 'biggestMonth':
      return (
        <SlideShell kicker="Your biggest spending month" tone="garnet">
          <h2 className="wr-big">{monthName(s.month)}</h2>
          <p className="wr-line">
            You spent <CountCents cents={s.cents} />. An average month {period} was {formatCents(s.averageCents)}.
          </p>
          <MonthBars months={s.months} highlight={s.month} tone="garnet" />
        </SlideShell>
      );
    case 'refereeing':
      return (
        <SlideShell kicker="Your refereeing season">
          <h2 className="wr-big wr-metal">
            <CountCents cents={s.totalCents} />
          </h2>
          <p className="wr-line">
            earned refereeing {period}. Your busiest month was {monthName(s.busiestMonth.month)} with {formatCents(s.busiestMonth.cents)}.
          </p>
          <MonthBars months={s.months} highlight={s.busiestMonth.month} tone="gold" />
          <ListRows rows={s.byPayer.slice(0, 4).map((p) => ({ label: p.payer, cents: p.cents }))} />
        </SlideShell>
      );
    case 'netWorth': {
      const up = s.changeCents >= 0;
      return (
        <SlideShell kicker="Your net worth" tone={up ? 'sage' : 'garnet'}>
          <h2 className={`wr-big ${up ? 'tone-sage-text' : 'tone-garnet-text'}`}>
            <CountCents cents={s.changeCents} sign />
          </h2>
          <p className="wr-line">
            {s.firstYear ? 'Your first year in Arc40: ' : ''}from {formatCents(s.startCents)} on {formatDate(s.startDate)} to {formatCents(s.endCents)} on {formatDate(s.endDate)}
            {s.changeBp !== null ? ` (${formatBasisPoints(s.changeBp)})` : ''}.
          </p>
          <div className="wr-compare">
            <div>
              <span className="label">Start</span>
              <b className="num">{formatCents(s.startCents)}</b>
            </div>
            <ChevronRight className="wr-compare-arrow" size={28} />
            <div>
              <span className="label">{w.soFar ? 'Today' : 'End of year'}</span>
              <b className="num">{formatCents(s.endCents)}</b>
            </div>
          </div>
        </SlideShell>
      );
    }
    case 'savingsRate':
      return (
        <SlideShell kicker="Your savings rate" tone={s.rateBp >= 0 ? 'gold' : 'garnet'}>
          <Ring bp={Math.max(0, s.rateBp)} tone={s.rateBp >= 0 ? 'gold' : 'garnet'}>
            <span className="wr-ring-num">
              <CountBp bp={s.rateBp} />
            </span>
          </Ring>
          <p className="wr-line">
            {s.keptCents >= 0 ? 'You kept ' : 'You spent '}
            <b className="num">{formatCents(Math.abs(s.keptCents))}</b>
            {s.keptCents >= 0 ? ' of the ' : ' more than the '}
            <b className="num">{formatCents(s.incomeCents)}</b> you earned {period}.
          </p>
        </SlideShell>
      );
    case 'investments': {
      const up = s.growthCents >= 0;
      return (
        <SlideShell kicker="Your investments">
          <div className="wr-two">
            <div className="wr-figure">
              <span className="label">Money you put in</span>
              <b className="num wr-figure-num">
                <CountCents cents={s.putInCents} />
              </b>
              <span className="wr-figure-note">Contributions and transfers in. Not a return.</span>
            </div>
            <div className="wr-figure">
              <span className="label">Market growth</span>
              <b className={`num wr-figure-num ${up ? 'tone-gold-text' : 'tone-garnet-text'}`}>
                <CountCents cents={s.growthCents} sign />
              </b>
              <span className="wr-figure-note">What prices added or took away.</span>
            </div>
          </div>
          <p className="wr-line">
            Your investments went from {formatCents(s.startValueCents)} to {formatCents(s.endValueCents)} {period}.
          </p>
          {s.estimated && (
            <div className="wr-chip" title={s.notes.join(' ')}>
              Estimated · {s.notes.join(' ')}
            </div>
          )}
        </SlideShell>
      );
    }
    case 'subscriptions':
      return (
        <SlideShell kicker="Your subscriptions" tone="bronze">
          <h2 className="wr-big wr-metal">
            <CountCents cents={s.totalCents} />
          </h2>
          <p className="wr-line">
            on {s.chargeCount} subscription {s.chargeCount === 1 ? 'charge' : 'charges'} {period}.
          </p>
          <ListRows rows={s.items.map((it) => ({ label: it.name, cents: it.cents, note: it.status === 'cancelled' ? 'cancelled' : undefined }))} />
          {s.manualNotCounted > 0 && (
            <p className="wr-foot">
              {s.manualNotCounted} recurring {s.manualNotCounted === 1 ? 'charge' : 'charges'} you added by hand {s.manualNotCounted === 1 ? 'is' : 'are'} not counted (no bank charges are matched to them).
            </p>
          )}
        </SlideShell>
      );
    case 'roth':
      return (
        <SlideShell kicker={`Your Roth IRA for ${s.taxYear}`}>
          <Ring bp={s.percentBp ?? 0}>
            <span className="wr-ring-num">{s.percentBp !== null ? <CountBp bp={s.percentBp} /> : '—'}</span>
          </Ring>
          <p className="wr-line">
            You put in <b className="num">{formatCents(s.contributedCents)}</b>
            {s.limitCents !== null ? (
              <>
                {' '}
                of the <b className="num">{formatCents(s.limitCents)}</b> limit.
              </>
            ) : (
              <>. Add the {s.taxYear} limit on Goals to see how close you got.</>
            )}
          </p>
        </SlideShell>
      );
    case 'topCategory':
      return (
        <SlideShell kicker="Where most of it went" tone="garnet">
          <h2 className="wr-big wr-name">{s.name}</h2>
          <p className="wr-line">
            <CountCents cents={s.cents} />, {formatBasisPoints(s.shareBp, { sign: false })} of the {formatCents(s.spendingCents)} you spent {period}.
          </p>
          <div className="wr-share" aria-hidden="true">
            <span style={{ width: `${Math.min(100, s.shareBp / 100)}%` }} />
          </div>
          {s.next.length > 0 && <ListRows rows={s.next.map((n) => ({ label: n.name, cents: n.cents }))} />}
        </SlideShell>
      );
    case 'workCost':
      return (
        <SlideShell kicker="Your year in work">
          <h2 className="wr-big wr-metal">{s.text}</h2>
          <p className="wr-line">
            That is what your {formatCents(s.spendingCents)} of spending {period} cost in {s.unit === 'game' ? 'refereeing games' : 'hours of work'}.
          </p>
          <UnitCoins tenths={s.tenths} unit={s.unit} />
        </SlideShell>
      );
    case 'futureYou': {
      const times = s.investedCents > 0 ? Math.floor((s.valueCents * 10) / s.investedCents) : 0;
      const coins = Math.max(1, Math.min(16, Math.round(times / 10)));
      return (
        <SlideShell kicker="Future you">
          <p className="wr-line wr-lead">What you invested {w.soFar ? 'this year' : `in ${w.year}`} could be</p>
          <h2 className="wr-big wr-metal">
            <CountCents cents={s.valueCents} />
          </h2>
          <p className="wr-line">
            at age {s.age}: {formatCents(s.investedCents)} growing {formatBasisPoints(s.returnRateBp, { sign: false })} a year after inflation, {Math.floor(times / 10)}.{times % 10}× what you put in.
          </p>
          <div className="wr-stack" aria-hidden="true">
            {Array.from({ length: coins }, (_, i) => (
              <span key={i} className="wr-stack-coin" style={{ animationDelay: `${350 + i * 70}ms` }} />
            ))}
          </div>
          <div className="wr-chip">Estimate, not financial advice · in today's dollars</div>
        </SlideShell>
      );
    }
  }
}

function Intro({ w }: { w: Wrapped }) {
  const year = useCount(w.year, 1500);
  const reduced = useReducedMotion();
  const shown = reduced ? w.year : Math.max(w.year - 25, year);
  return (
    <div className="wr-intro" aria-label={`Arc40 Wrapped ${w.year}${w.soFar ? ' so far' : ''}`}>
      <div className="wr-glow" aria-hidden="true" />
      <svg viewBox="0 0 200 200" className="wr-mark" aria-hidden="true">
        <defs>
          <linearGradient id="wr-arc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--gold-bright)' }} />
            <stop offset="55%" style={{ stopColor: 'var(--gold)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--bronze)' }} />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="80" className="wr-mark-track" />
        <circle cx="100" cy="100" r="80" className="wr-mark-arc" stroke="url(#wr-arc)" pathLength={100} transform="rotate(-210 100 100)" />
        <circle cx="100" cy="100" r="15" className="wr-mark-core" />
      </svg>
      <div className="wr-brand">Arc40</div>
      <h1 className="wr-title">Wrapped</h1>
      <div className="wr-year num">{shown}</div>
      {w.soFar && <div className="wr-sofar">so far</div>}
      <div className="wr-intro-sheen" aria-hidden="true" />
      <div className="wr-hint">Click or press → to begin</div>
    </div>
  );
}

/** The full-screen experience. `step` -1 is the intro. */
export function WrappedPlayer({ years, start, onClose }: { years: WrappedYears['years']; start: number; onClose: () => void }) {
  const [year, setYear] = useState(start);
  const [step, setStep] = useState(-1);
  const [sound, setSound] = useState(false);
  const { data } = useApi<Wrapped>(`/api/wrapped?year=${year}`);
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const loaded = data && data.year === year ? data : null;
  const total = loaded?.slides.length ?? 0;

  useEffect(() => {
    api<{ wrappedSound: boolean }>('GET', '/api/preferences')
      .then((p) => setSound(p.wrappedSound === true))
      .catch(() => setSound(false));
  }, []);
  // Intro chime once the sound setting is known, then the intro moves on by itself.
  useEffect(() => {
    if (step !== -1 || !loaded) return;
    if (sound) playIntro();
    const t = window.setTimeout(() => setStep(0), reduced ? INTRO_REDUCED_MS : INTRO_MS);
    return () => window.clearTimeout(t);
  }, [step, loaded, sound, reduced]);

  const go = useCallback(
    (to: number) => {
      if (!loaded) return;
      const next = Math.max(0, Math.min(total - 1, to));
      setStep((cur) => {
        if (cur !== next && sound && cur >= 0) playTick();
        return next;
      });
    },
    [loaded, total, sound],
  );
  const forward = useCallback(() => (step < 0 ? setStep(0) : go(step + 1)), [step, go]);
  const back = useCallback(() => (step <= 0 ? undefined : go(step - 1)), [step, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'SELECT' || tag === 'BUTTON') {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') e.preventDefault();
        else return;
      }
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        forward();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [forward, back, onClose]);
  // Focus the window itself (not the close button), so arrow keys work and no focus ring sits on a button.
  useEffect(() => rootRef.current?.focus(), []);

  const onStage = (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a, select')) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (step >= 0 && e.clientX - box.left < box.width * 0.3) back();
    else forward();
  };
  const current = loaded && step >= 0 ? loaded.slides[step] : null;
  const last = loaded !== null && step === total - 1;
  // Trophies Round 4: reaching the last slide tells Arc40 this year was watched (the Wrapped watched trophies).
  // Once per year per showing; closing earlier records nothing.
  const told = useRef(new Set<number>());
  useEffect(() => {
    if (!last || !loaded || told.current.has(loaded.year)) return;
    told.current.add(loaded.year);
    api('POST', '/api/activity/wrapped-watched', { year: loaded.year }).catch(() => undefined);
  }, [last, loaded]);

  return createPortal(
    <div ref={rootRef} tabIndex={-1} className={`wrapped ${reduced ? 'is-reduced' : ''}`} role="dialog" aria-modal="true" aria-label="Arc40 Wrapped">
      <div className="wr-top">
        <div className="wr-progress" role="progressbar" aria-label="Slides" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.max(0, step + 1)}>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={i < step ? 'is-done' : i === step ? 'is-on' : ''} />
          ))}
        </div>
        <div className="wr-tools">
          <select
            className="input wr-year-pick"
            aria-label="Year"
            value={year}
            onChange={(e) => {
              setYear(Number(e.target.value));
              setStep(0);
            }}
          >
            {years.map((y) => (
              <option key={y.year} value={y.year}>
                {yearLabel(y)}
              </option>
            ))}
          </select>
          <span className="wr-count num" aria-live="polite">
            {step >= 0 && total > 0 ? `${step + 1} / ${total}` : 'Intro'}
          </span>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close Wrapped">
            <X size={20} />
          </button>
        </div>
      </div>
      <div className="wr-stage" onClick={onStage}>
        {!loaded ? (
          <div className="wr-loading">
            <div className="skeleton" />
          </div>
        ) : step < 0 ? (
          <Intro w={loaded} />
        ) : current ? (
          <div className="wr-slide-anim" key={`${year}-${step}`} aria-live="polite">
            <SlideView s={current} w={loaded} />
          </div>
        ) : (
          <div className="wr-slide">
            <div className="wr-kicker">{loaded.soFar ? `${loaded.year} so far` : loaded.year}</div>
            <p className="wr-line">Not much happened in this year yet. Add or import some transactions and come back.</p>
          </div>
        )}
      </div>
      <div className="wr-bottom">
        <button className="btn btn-ghost" onClick={back} disabled={step <= 0} aria-label="Previous slide">
          <ChevronLeft size={18} /> Back
        </button>
        {last ? (
          <div className="wr-end">
            <button className="btn btn-ghost" onClick={() => setStep(-1)}>
              <RotateCcw size={16} /> Watch again
            </button>
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={forward} aria-label="Next slide" disabled={!loaded || total === 0}>
            {step < 0 ? 'Start' : 'Next'} <ChevronRight size={18} />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The small Dashboard card (the only way into Wrapped). Hidden when there is no year with data. */
export function WrappedCard() {
  const { data } = useApi<WrappedYears>('/api/wrapped/years');
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const latest = data?.years[0];
  if (!latest) return null;
  const play = () => {
    unlockAudio(); // the click that opens Wrapped is what lets the browser play its sound
    setOpen(true);
  };
  return (
    <>
      <button className="card wrapped-card" onClick={play} aria-label={`Play Arc40 Wrapped for ${yearLabel(latest)}`}>
        <span className="wrapped-card-mark" aria-hidden="true">
          <Sparkles size={18} />
        </span>
        <span className="wrapped-card-text">
          <span className="label">Arc40 Wrapped</span>
          <span className="wrapped-card-year">
            <b className="num">{latest.year}</b> {latest.soFar ? <span className="wrapped-card-chip">so far</span> : <span className="wrapped-card-chip">full year</span>}
          </span>
        </span>
        <span className="wrapped-card-play" aria-hidden="true">
          <Play size={16} />
        </span>
      </button>
      {open && data && <WrappedPlayer years={data.years} start={latest.year} onClose={close} />}
    </>
  );
}

/** Settings: the Wrapped sound switch (off by default) and a way to hear it. Saved in preferences.json. */
export function WrappedSoundCard() {
  const [on, setOn] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api<{ wrappedSound: boolean }>('GET', '/api/preferences')
      .then((p) => setOn(p.wrappedSound === true))
      .catch(() => setOn(false));
  }, []);
  const toggle = async (next: boolean) => {
    setOn(next);
    setMsg(null);
    try {
      await api('PUT', '/api/preferences', { wrappedSound: next });
      setMsg(next ? 'Sound is on for Arc40 Wrapped.' : 'Sound is off.');
    } catch {
      setOn(!next);
      setMsg('Could not save. Try again.');
    }
  };
  return (
    <section className="card rise stack" style={{ animationDelay: '40ms' }}>
      <h3 className="icon-title">
        <Sparkles size={18} /> Arc40 Wrapped
      </h3>
      <p className="muted">Your year in review opens from its card on the Dashboard. It only reads your data and cannot be exported or shared.</p>
      <label className="check">
        <input type="checkbox" checked={on === true} disabled={on === null} onChange={(e) => void toggle(e.target.checked)} aria-label="Sound in Arc40 Wrapped" />
        <span>Play soft sounds for the intro and between slides (made on this Mac, nothing is downloaded)</span>
      </label>
      <div className="wr-sound-row">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            unlockAudio();
            playIntro();
          }}
        >
          <Volume2 size={14} /> Hear it
        </button>
        {msg && <span className="hint">{msg}</span>}
      </div>
    </section>
  );
}
