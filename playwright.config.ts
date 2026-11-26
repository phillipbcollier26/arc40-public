import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// End-to-end tests drive the real app in Chromium against a throwaway data folder.
// On a Mac, run `npx playwright install chromium` once before `npm run test:e2e`.
const PORT = 4141;
const dataDir = path.join(os.tmpdir(), `arc40-e2e-${Date.now()}`);
const chromiumPath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  workers: 1, // files run in order: 1-login sets the password the others use
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  webServer: {
    command: `npm run build && ARC40_PORT=${PORT} ARC40_DATA_DIR=${dataDir} ARC40_DEMO_DIR=${dataDir}-demo ARC40_BACKUP_DIR=${dataDir}-backups npm start`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
