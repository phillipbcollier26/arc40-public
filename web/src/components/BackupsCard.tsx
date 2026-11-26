import { useState } from 'react';
import { Download, HardDriveDownload, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';

interface BackupList {
  dir: string;
  demo?: boolean;
  backups: { name: string; sizeBytes: number; createdAt: number }[];
}

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${Math.round((n / 1024 / 1024) * 10) / 10} MB`);
const when = (ms: number) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Settings: export everything, backups, and how to restore. */
export function BackupsCard() {
  const { data, reload } = useApi<BackupList>('/api/backups');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function backupNow() {
    setBusy(true);
    setMsg(null);
    try {
      await api('POST', '/api/backups');
      setMsg({ ok: true, text: 'Backup saved.' });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Backup failed.' });
    } finally {
      setBusy(false);
    }
  }

  const latest = data?.backups[0];
  if (data?.demo) {
    return (
      <section className="card rise stack backups-card" style={{ animationDelay: '90ms' }}>
        <h3>
          <ShieldCheck size={18} /> Backups & export
        </h3>
        <p className="muted">
          Backups are paused in demo mode, so fake data never ends up in your backups folder. Your real backups are untouched and
          start again when you leave demo mode. Export still works and the file is named <code>arc40-demo-export</code>.
        </p>
        <div className="backup-actions">
          <a className="btn btn-primary" href="/api/export" download>
            <Download size={16} /> Export demo data (.zip)
          </a>
        </div>
      </section>
    );
  }
  return (
    <section className="card rise stack backups-card" style={{ animationDelay: '90ms' }}>
      <h3>
        <ShieldCheck size={18} /> Backups & export
      </h3>
      <p className="muted">
        Arc40 backs up automatically once a week (when it starts, and every few hours while it runs) and keeps the newest 12. Backups are
        saved on this Mac only, outside the Arc40 folder, so they never go to GitHub.
      </p>
      <div className="backup-status">
        <div>
          <div className="label">Last backup</div>
          <div className="num backup-when">{latest ? when(latest.createdAt) : 'None yet'}</div>
        </div>
        <div>
          <div className="label">Folder</div>
          <code className="backup-dir">{data?.dir ?? ''}</code>
        </div>
      </div>
      <div className="backup-actions">
        <a className="btn btn-primary" href="/api/export" download>
          <Download size={16} /> Export everything (.zip)
        </a>
        <button className="btn" onClick={backupNow} disabled={busy}>
          <HardDriveDownload size={16} /> Back up now
        </button>
      </div>
      {msg && <p className={msg.ok ? 'ok-text' : 'error-text'}>{msg.text}</p>}
      {data && data.backups.length > 0 && (
        <details>
          <summary className="hint">All backups ({data.backups.length})</summary>
          <ul className="backup-list">
            {data.backups.map((b) => (
              <li key={b.name}>
                <span>{b.name}</span>
                <span className="hint">{kb(b.sizeBytes)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary className="hint">How to restore a backup</summary>
        <ol className="restore-steps">
          <li>Close the Arc40 Terminal window to stop Arc40.</li>
          <li>
            Open Terminal and go to the Arc40 folder (the one with Start Arc40.command), for example <code>cd ~/arc40</code>
          </li>
          <li>
            Run <code>npm run restore -- ~/Arc40Backups/FILE-NAME.db</code> with the backup's name from the list above. An export's
            <code>arc40.db</code> works too (unzip it first).
          </li>
          <li>Double-click Start Arc40.command. Your data before the restore is kept in the data folder in case you change your mind.</li>
        </ol>
      </details>
      <p className="hint">The export contains your full financial history. Keep it private and never upload it.</p>
    </section>
  );
}
