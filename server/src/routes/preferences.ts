import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { readPreferences, THEMES, writePreferences } from '../lib/preferences.js';

/** Display preferences (theme, Wrapped sound, trophy sound). Works the same in real and demo mode; never touches arc40.db. */
export function registerPreferenceRoutes(app: FastifyInstance, dataDir: string): void {
  app.get('/api/preferences', async () => readPreferences(dataDir));

  app.put('/api/preferences', async (req, reply) => {
    const body = z
      .object({ theme: z.enum(THEMES).optional(), wrappedSound: z.boolean().optional(), trophySound: z.boolean().optional() })
      .strict()
      .safeParse(req.body);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    if (!body.success || (body.data.theme === undefined && body.data.wrappedSound === undefined && body.data.trophySound === undefined)) {
      const soundOnly = ('wrappedSound' in raw || 'trophySound' in raw) && !('theme' in raw);
      return reply.code(400).send({ error: soundOnly ? 'Turn the sound on or off.' : 'Pick Dark, Light or Match Mac.' });
    }
    return writePreferences(dataDir, { ...readPreferences(dataDir), ...body.data });
  });
}
