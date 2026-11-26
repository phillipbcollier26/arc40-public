import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Telescope } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { usePlanning } from '../lib/planning';
import { api, ApiError } from '../lib/api';
import { formatBasisPoints } from '../lib/format';
import type { PlanningSettings } from '../lib/types';

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "7" for 700 bp, "6.5" for 650 (no trailing zeros, no % sign: the box has its own). */
export function percentText(bp: number): string {
  return formatBasisPoints(bp, { sign: false }).replace('%', '').replace(/\.?0+$/, '') || '0';
}

/**
 * Settings: planning assumptions used by every projection (Roth pace, What if, future you).
 * Birth month and year are personal: they stay in this database only (demo mode has its own).
 */
export function PlanningCard() {
  const { data, reload: reloadCard } = useApi<PlanningSettings>('/api/settings/planning');
  const { reload: reloadApp } = usePlanning();
  const reload = () => {
    reloadCard();
    reloadApp(); // the expense line and the time machine use the app-wide copy
  };
  const [rate, setRate] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [line, setLine] = useState<boolean | null>(null);

  // The boxes are filled from the server once, and after their own Save. Other reloads (the switch below, the
  // window regaining focus) must never overwrite something being typed.
  // A box changed before the first load arrived keeps what was typed (the late first fill used to wipe it).
  const filled = useRef(false);
  const touched = useRef(new Set<'rate' | 'month' | 'year'>());
  const fill = (d: PlanningSettings, skipTouched = false) => {
    const t = skipTouched ? touched.current : new Set<string>();
    if (!t.has('rate')) setRate(percentText(d.returnRateBp));
    if (!t.has('month')) setMonth(d.birth ? String(d.birth.month) : '');
    if (!t.has('year')) setYear(d.birth ? String(d.birth.year) : '');
  };
  useEffect(() => {
    if (!data) return;
    if (!filled.current) {
      filled.current = true;
      fill(data, true);
    }
    setLine(data.futureYouLine);
  }, [data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const noBirth = !month && !year.trim();
    if (!noBirth && (!month || !/^\d{4}$/.test(year.trim()))) {
      setMsg({ ok: false, text: 'Pick a birth month and type a 4-digit year (or leave both empty).' });
      return;
    }
    try {
      const saved = await api<PlanningSettings>('PUT', '/api/settings/planning', {
        returnRate: rate.trim() || percentText(data?.defaultReturnRateBp ?? 700),
        birth: noBirth ? null : { year: Number(year.trim()), month: Number(month) },
      });
      fill(saved);
      setMsg({ ok: true, text: 'Saved.' });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not save.' });
    }
  }

  async function toggleLine(on: boolean) {
    setMsg(null);
    setLine(on); // flips right away; put back if the save fails
    try {
      await api('PUT', '/api/settings/planning', { futureYouLine: on });
      setMsg({ ok: true, text: on ? 'The future-you line is on.' : 'The future-you line is off.' });
      reload();
    } catch (err) {
      setLine(!on);
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not save.' });
    }
  }

  return (
    <form className="card rise stack planning-form" style={{ animationDelay: '40ms' }} onSubmit={save} aria-label="Planning">
      <h3 className="icon-title">
        <Telescope size={18} /> Planning
      </h3>
      <p className="muted">
        Used by the Roth pace planner, What if and future you. Every projection is an estimate in today's dollars, not financial advice.
      </p>
      <div className="form-row">
        <label className="field">
          <span className="label">Yearly return after inflation</span>
          <span className="input-suffix">
            <input className="input" inputMode="decimal" aria-label="Yearly return after inflation" value={rate} onChange={(e) => (touched.current.add('rate'), setRate(e.target.value))} />
            <span className="suffix">%</span>
          </span>
        </label>
      </div>
      <p className="hint">
        After inflation means growth beyond rising prices, so future amounts are in today's buying power. Default{' '}
        {percentText(data?.defaultReturnRateBp ?? 700)}%. Allowed: 0% to 15%.
      </p>
      <div className="form-row">
        <label className="field">
          <span className="label">Birth month</span>
          <select className="input" aria-label="Birth month" value={month} onChange={(e) => (touched.current.add('month'), setMonth(e.target.value))}>
            <option value="">Not set</option>
            {MONTH_NAMES.map((n, i) => (
              <option key={n} value={i + 1}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Birth year</span>
          <input className="input" inputMode="numeric" aria-label="Birth year" placeholder="YYYY" maxLength={4} value={year} onChange={(e) => (touched.current.add('year'), setYear(e.target.value))} />
        </label>
      </div>
      <p className="hint">
        {data?.age != null ? `You are ${data.age}. ` : 'Needed for "at age 40" and "at age 65". '}
        Only the month and year are kept, and only on this Mac.
      </p>
      <label className="check future-switch">
        <input
          type="checkbox"
          checked={line ?? !!data?.futureYouLine}
          // Disabled until the saved value is known: before that the box only LOOKS off, so a click would do nothing
          // and the late load would then turn it back on (this made 15-future-you fail now and then).
          disabled={line === null && !data}
          onChange={(e) => void toggleLine(e.target.checked)}
          aria-label="Show future you on expenses"
        />
        <span>
          Show "future you" on expenses: <em>This $50 could be $221 at age 40</em>, on Transactions and in the edit window
        </span>
      </label>
      {data && !data.birth && <p className="hint">Set your birth month and year above to use "future you".</p>}
      {msg && <p className={msg.ok ? 'ok-text' : 'error-text'}>{msg.text}</p>}
      <div>
        <button className="btn">Save</button>
      </div>
    </form>
  );
}
