/**
 * Keeps CLAUDE.md (the handoff guide for future Claude sessions) in sync with the code:
 * every migration, route file, lib module and page must be mentioned.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const doc = fs.readFileSync(path.resolve('CLAUDE.md'), 'utf8');
const names = (dir: string, ext: string) =>
  fs
    .readdirSync(path.resolve(dir))
    .filter((f) => f.endsWith(ext))
    .map((f) => f.slice(0, -ext.length));

describe('CLAUDE.md stays current', () => {
  it.each(names('server/src/db/migrations', '.sql'))('mentions migration %s', (m) => {
    expect(doc).toContain(`${m}.sql`);
  });
  it.each(names('server/src/routes', '.ts'))('mentions route area %s', (r) => {
    expect(doc).toMatch(new RegExp(`\\b${r}\\b`));
  });
  it.each(names('server/src/lib', '.ts'))('mentions lib/%s.ts', (l) => {
    expect(doc).toContain(`lib/${l}.ts`);
  });
  it.each(names('web/src/pages', 'Page.tsx'))('mentions page %s', (p) => {
    expect(doc).toContain(p.replace(/([a-z])([A-Z])/g, '$1$2'));
  });
  it('has the handoff and start-here sections', () => {
    expect(doc).toContain('## Start here');
    expect(doc).toContain('## Handoff');
  });
});
