import { useState, type FormEvent } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { LogoMark, Wordmark } from '../components/Logo';

interface Props {
  mode: 'setup' | 'login';
  /** In-app demo mode is on: you still unlock with your real password and land back in demo. */
  demo?: boolean;
  notice?: string | null;
  onDone: (csrfToken: string) => void;
}

export function AuthScreen({ mode, demo = false, notice, onDone }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'setup' && password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ csrfToken: string }>(
        'POST',
        mode === 'setup' ? '/api/auth/setup' : '/api/auth/login',
        { password },
      );
      onDone(res.csrfToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card card rise" onSubmit={submit}>
        <div className="auth-logo">
          <div className="auth-orb">
            <LogoMark size={64} spin />
          </div>
          <h1>
            <Wordmark />
          </h1>
          <p className="auth-sub">
            {mode === 'setup' ? 'Create a password to protect your dashboard.' : 'Welcome back.'}
          </p>
        </div>

        {notice && <div className="auth-notice">{notice}</div>}
        {demo && mode === 'login' && (
          <div className="auth-notice">Demo mode is on. Unlock with your real password to keep exploring the fake data.</div>
        )}

        <label className="field">
          <span className="label">{mode === 'setup' ? 'New password' : 'Password'}</span>
          <input
            className="input"
            type="password"
            autoFocus
            autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'setup' ? 'At least 8 characters' : ''}
            aria-label="Password"
          />
        </label>

        {mode === 'setup' && (
          <label className="field">
            <span className="label">Confirm password</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-label="Confirm password"
            />
          </label>
        )}

        {error && (
          <div className="error-text" role="alert">
            {error}
          </div>
        )}

        <button className="btn btn-primary auth-submit" disabled={busy || !password}>
          {mode === 'setup' ? <ShieldCheck size={16} /> : <Lock size={16} />}
          {mode === 'setup' ? 'Create password' : 'Unlock'}
        </button>

        <p className="auth-foot">
          Runs only on this Mac at 127.0.0.1. Nothing leaves your computer.
        </p>
      </form>
    </div>
  );
}
