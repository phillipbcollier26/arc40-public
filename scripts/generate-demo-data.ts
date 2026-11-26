/**
 * Builds a realistic FAKE dataset for demos, screenshots and development.
 *   npm run demo        (generates it and starts Arc40 on http://127.0.0.1:4041)
 * Writes only to ./demo-data (gitignored), never to ./data. Password: demo1234
 * The generator itself lives in server/src/lib/demo/ (the app uses it for in-app demo mode too).
 */
import path from 'node:path';
import { REPO_ROOT } from '../server/src/config.js';
import { DEMO_PASSWORD, generateDemoData as generate } from '../server/src/lib/demo/index.js';
import { toIsoDate, type IsoDate } from '../shared/dates.js';

export const DEMO_DIR = path.join(REPO_ROOT, 'demo-data');
export { DEMO_PASSWORD };

export function generateDemoData(dir = DEMO_DIR, today: IsoDate = toIsoDate(Date.now()), now = Date.now()) {
  return generate(dir, today, now);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { dir, password } = await generateDemoData();
  console.log(`Demo data written to ${dir}`);
  console.log(`Log in with password: ${password}`);
}
