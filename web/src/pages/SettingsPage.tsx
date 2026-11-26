import { useEffect, useState, type FormEvent } from 'react';
import { useApi } from '../lib/useApi';
import type { AppSettings } from '../lib/types';
import { formatBasisPoints } from '../lib/format';
import { BackupsCard } from '../components/BackupsCard';
import { api, ApiError, setCsrfToken } from '../lib/api';
import { DemoCard } from '../components/DemoControls';
import { ThemeCard } from '../components/ThemeControls';
import { PlanningCard } from '../components/PlanningSettings';
import { WorkCostCard } from '../components/WorkCostSettings';
import { WrappedSoundCard } from '../components/Wrapped';
import { TrophySoundCard } from '../components/TrophyUnlock';
import { useMode } from '../lib/demo';

const TIMEOUT_OPTIONS = [15, 30, 60, 120, 240, 480, 1440];
const label = (m: number) => (m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours`);

export function SettingsPage({
  idleTimeoutMinutes,
  onTimeoutChange,
}: {
  idleTimeoutMinutes: number;
  onTimeoutChange: (m: number) => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [toMsg, setToMsg] = useState<string | null>(null);
  const demo = useMode() === 'demo';

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    try {
      const res = await api<{ csrfToken: string }>('POST', '/api/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      });
      setCsrfToken(res.csrfToken);
      setCurrent('');
      setNext('');
      setPwMsg({ ok: true, text: 'Password updated.' });
    } catch (err) {
      setPwMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not update.' });
    }
  }

  async function changeTimeout(minutes: number) {
    await api('PUT', '/api/settings/session', { idleTimeoutMinutes: minutes });
    onTimeoutChange(minutes);
    setToMsg(`Saved. Arc40 locks after ${label(minutes)} of inactivity.`);
  }

  return (
    <div className="page">
      <header className="page-head rise">
        <div>
          <div className="label">Preferences</div>
          <h1 className="page-title">Settings</h1>
        </div>
      </header>

      <div className="grid-2">
        <ThemeCard />
        <DemoCard />
      </div>
      <div className="grid-2">
        <WrappedSoundCard />
        <TrophySoundCard />
      </div>
      <BackupsCard />
      <div className="grid-2">
        <PlanningCard />
        <WorkCostCard />
      </div>
      <div className="grid-2">
        <TaxSetAside />
        <section className="card rise" style={{ animationDelay: '60ms' }}>
          <h3>Auto-lock</h3>
          <p className="muted">Lock the app after this much time without any activity.</p>
          <select
            className="input"
            aria-label="Auto-lock timeout"
            disabled={demo}
            value={idleTimeoutMinutes}
            onChange={(e) => changeTimeout(Number(e.target.value))}
          >
            {TIMEOUT_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {label(m)}
              </option>
            ))}
          </select>
          {toMsg && <p className="ok-text">{toMsg}</p>}
          {demo && <p className="hint">Demo mode uses your real auto-lock time. Change it in real mode.</p>}
        </section>

        <form className="card rise stack" style={{ animationDelay: '120ms' }} onSubmit={changePassword}>
          <h3>Change password</h3>
          {demo && <p className="hint">Your password can only be changed in real mode.</p>}
          <input
            className="input"
            type="password"
            placeholder="Current password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <input
            className="input"
            type="password"
            placeholder="New password (8+ characters)"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          {pwMsg && <p className={pwMsg.ok ? 'ok-text' : 'error-text'}>{pwMsg.text}</p>}
          <div>
            <button className="btn" disabled={demo || !current || !next}>
              Update password
            </button>
          </div>
          <p className="hint">
            Forgot it? Open Terminal in the Arc40 folder and run <code>npm run reset-password</code>. Your data is kept.
          </p>
        </form>
      </div>
    </div>
  );
}

/** Optional gig-pay tax set-aside. An estimate based on the percent the user picks, not tax advice. */
function TaxSetAside() {
  const { data, reload } = useApi<AppSettings>('/api/settings');
  const [pct, setPct] = useState('');
  const [onNet, setOnNet] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!data) return;
    setPct(data.taxSetAsideBp ? formatBasisPoints(data.taxSetAsideBp, { sign: false }).replace(/\.00%$|%$/, '') : '');
    setOnNet(data.taxSetAsideOnNet);
  }, [data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api('PUT', '/api/settings/budget', { taxSetAsidePercent: pct.trim() || '0', taxSetAsideOnNet: onNet });
      setMsg({ ok: true, text: pct.trim() && pct.trim() !== '0' ? 'Saved.' : 'Set-aside estimate turned off.' });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not save.' });
    }
  }

  return (
    <form className="card rise stack" style={{ animationDelay: '30ms' }} onSubmit={save}>
      <h3>Refereeing tax set-aside</h3>
      <p className="muted">
        Optional. Shows how much of your refereeing pay to set aside, using a percent you choose. This is an estimate, not tax advice;
        leave it blank to turn it off.
      </p>
      <div className="form-row">
        <label className="field">
          <span className="label">Percent</span>
          <input className="input" inputMode="decimal" aria-label="Set-aside percent" placeholder="e.g. 20" value={pct} onChange={(e) => setPct(e.target.value)} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={onNet} onChange={(e) => setOnNet(e.target.checked)} />
        <span>Subtract Ref Gear & Fees first (apply to net pay)</span>
      </label>
      {msg && <p className={msg.ok ? 'ok-text' : 'error-text'}>{msg.text}</p>}
      <div>
        <button className="btn">Save</button>
      </div>
    </form>
  );
}
