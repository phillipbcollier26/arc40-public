import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { FlaskConical, LogOut, RotateCcw } from 'lucide-react';
import { ApiError } from '../lib/api';
import { enterDemo, leaveDemo, resetDemo, useMode } from '../lib/demo';
import { Modal } from './Modal';
import { LogoMark } from './Logo';

/** Bold DEMO badge for the sidebar. Only rendered in demo mode. */
export function DemoPill() {
  return (
    <div className="demo-pill" role="status" aria-label="Demo mode is on">
      <FlaskConical size={14} strokeWidth={2.25} />
      <span className="demo-pill-word">DEMO</span>
      <span className="demo-pill-sub">fake data</span>
    </div>
  );
}

/** Full-screen cover while the app switches data (the page reloads right after). */
function Switching({ text }: { text: string }) {
  return createPortal(
    <div className="switch-cover" role="status">
      <LogoMark size={48} spin />
      <p>{text}</p>
    </div>,
    document.body,
  );
}

/** Enter (one click) or leave (password) demo mode. `variant` picks the sidebar or Settings look. */
export function DemoToggle({ variant }: { variant: 'sidebar' | 'settings' }) {
  const mode = useMode();
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    setBusy('Loading demo data...');
    try {
      await enterDemo();
    } catch (err) {
      setBusy(null);
      setError(err instanceof ApiError ? err.message : 'Could not start demo mode.');
    }
  }

  const cls = variant === 'sidebar' ? 'btn btn-ghost side-btn' : 'btn';
  return (
    <>
      {mode === 'real' ? (
        <button className={cls} onClick={start} disabled={!!busy}>
          <FlaskConical size={16} /> Try demo mode
        </button>
      ) : (
        <button className={variant === 'sidebar' ? cls : 'btn btn-primary'} onClick={() => setLeaving(true)}>
          <LogOut size={16} /> Leave demo mode
        </button>
      )}
      {variant === 'settings' && error && <p className="error-text">{error}</p>}
      {leaving && <LeaveDemoModal onClose={() => setLeaving(false)} onBusy={setBusy} />}
      {busy && <Switching text={busy} />}
    </>
  );
}

function LeaveDemoModal({ onClose, onBusy }: { onClose: () => void; onBusy: (text: string | null) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      onBusy('Back to your real data...');
      await leaveDemo(password);
    } catch (err) {
      onBusy(null);
      setSending(false);
      setError(err instanceof ApiError ? err.message : 'Could not leave demo mode.');
    }
  }

  return (
    <Modal title="Leave demo mode" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">Enter your real Arc40 password to go back to your own data.</p>
        <input
          className="input"
          type="password"
          aria-label="Your real password"
          placeholder="Your real password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Stay in demo
          </button>
          <button className="btn btn-primary" disabled={!password || sending}>
            <LogOut size={16} /> Back to real data
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Settings card: explains demo mode, the toggle, and (in demo mode only) Reset demo data. */
export function DemoCard() {
  const mode = useMode();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      await resetDemo();
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : 'Could not reset demo data.');
    }
  }

  return (
    <section className={`card rise stack demo-card ${mode === 'demo' ? 'is-demo' : ''}`} style={{ animationDelay: '45ms' }}>
      <h3 className="icon-title">
        <FlaskConical size={18} /> Demo mode
      </h3>
      {mode === 'real' ? (
        <p className="muted">
          Swap to a separate set of fake data, for screenshots or trying things out. Your real data is closed and untouched while demo
          mode is on. Import and backups are turned off in demo mode. Leaving asks for your password.
        </p>
      ) : (
        <p className="muted">
          You are looking at fake data. Anything you change here stays in the demo copy. Your real data is closed and untouched. Leave
          with your real password.
        </p>
      )}
      <div className="backup-actions">
        <DemoToggle variant="settings" />
        {mode === 'demo' && (
          <button className="btn" onClick={() => setConfirming(true)}>
            <RotateCcw size={16} /> Reset demo data
          </button>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
      {confirming && (
        <Modal title="Reset demo data?" onClose={() => setConfirming(false)}>
          <div className="stack">
            <p className="muted">
              This throws away every change you made in demo mode and rebuilds the original fake dataset. Your real data is not
              affected.
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={reset} disabled={busy}>
                <RotateCcw size={16} /> Reset demo data
              </button>
            </div>
          </div>
        </Modal>
      )}
      {busy && <Switching text="Rebuilding demo data..." />}
    </section>
  );
}
