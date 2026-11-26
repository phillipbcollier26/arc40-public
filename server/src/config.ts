import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root (two levels up from server/src). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The server ONLY ever binds to the loopback interface. This is a hard-coded
 * constant on purpose: there is no setting that exposes Arc40 to the network.
 */
export const HOST = '127.0.0.1' as const;

export const DEFAULT_PORT = 4040;

export interface AppConfig {
  /** Folder that holds arc40.db. Gitignored. */
  dataDir: string;
  port: number;
  /** Folder with the built React app (web/dist). */
  webDistDir: string;
  /** Where automatic and manual backups go. Outside the repo on purpose. */
  backupDir: string;
  /**
   * In-app demo mode database folder. One per port (demo-data/in-app-4040), so the real app and
   * `npm run demo` (4041) never open the same demo file. Gitignored and blocked by the data guard.
   */
  demoDir: string;
  /** Injectable clock so tests can fast-forward time. */
  now: () => number;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const port = overrides.port ?? (process.env.ARC40_PORT ? Number(process.env.ARC40_PORT) : DEFAULT_PORT);
  return {
    dataDir: process.env.ARC40_DATA_DIR
      ? path.resolve(process.env.ARC40_DATA_DIR)
      : path.join(REPO_ROOT, 'data'),
    port,
    webDistDir: path.join(REPO_ROOT, 'web', 'dist'),
    backupDir: process.env.ARC40_BACKUP_DIR ? path.resolve(process.env.ARC40_BACKUP_DIR) : path.join(os.homedir(), 'Arc40Backups'),
    demoDir: process.env.ARC40_DEMO_DIR
      ? path.resolve(process.env.ARC40_DEMO_DIR)
      : path.join(REPO_ROOT, 'demo-data', `in-app-${port}`),
    now: () => Date.now(),
    ...overrides,
  };
}
