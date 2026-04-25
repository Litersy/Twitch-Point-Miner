import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';

// Accept plain login, @login, or full twitch.tv URL
const rawInputSchema = z.string().min(1).max(256);

function normalizeLogin(raw: string): string | null {
  const s = raw.trim();
  const urlMatch = s.match(/twitch\.tv\/(?:popout\/)?([a-zA-Z0-9_]+)/i);
  const candidate = urlMatch ? urlMatch[1] : s.replace(/^@/, '');
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(candidate)) return null;
  return candidate.toLowerCase();
}

export const streamersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authRequired);

  fastify.get('/', async (req) => {
    const q = (req.query as any)?.search as string | undefined;
    const streamers = await prisma.streamer.findMany({
      where: q ? { login: { contains: q, mode: 'insensitive' } } : undefined,
      orderBy: [{ isOnline: 'desc' }, { login: 'asc' }],
      include: { _count: { select: { accountStreamers: true } } },
    });
    return streamers.map((s) => ({
      id: s.id,
      login: s.login,
      displayName: s.displayName,
      twitchId: s.twitchId,
      isOnline: s.isOnline,
      streamTitle: s.streamTitle,
      streamGame: s.streamGame,
      viewersCount: s.viewersCount,
      lastCheckedAt: s.lastCheckedAt,
      accountCount: s._count.accountStreamers,
    }));
  });

  fastify.post('/', async (req, rep) => {
    const body = z
      .object({
        login: rawInputSchema,
        displayName: z.string().max(128).optional(),
        attachAccountIds: z.array(z.string()).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return rep.code(400).send({ error: 'invalid_body' });

    const login = normalizeLogin(body.data.login);
    if (!login) return rep.code(400).send({ error: 'invalid_login', message: 'could not parse twitch login' });

    const streamer = await prisma.streamer.upsert({
      where: { login },
      create: { login, displayName: body.data.displayName },
      update: { displayName: body.data.displayName ?? undefined },
    });

    if (body.data.attachAccountIds?.length) {
      await prisma.accountStreamer.createMany({
        data: body.data.attachAccountIds.map((accountId) => ({ accountId, streamerId: streamer.id })),
        skipDuplicates: true,
      });
    }

    return { id: streamer.id };
  });

  /**
   * Bulk add — accepts an array of raw inputs (logins or URLs) and a list of
   * account IDs to attach them to. Returns counts. Tolerant of duplicates & bad rows.
   */
  fastify.post('/bulk', async (req, rep) => {
    const body = z
      .object({
        items: z.array(rawInputSchema).min(1).max(500),
        attachAccountIds: z.array(z.string()).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return rep.code(400).send({ error: 'invalid_body' });

    const attach = body.data.attachAccountIds ?? [];
    let added = 0;
    let skipped = 0;
    const ids: string[] = [];
    for (const raw of body.data.items) {
      const login = normalizeLogin(raw);
      if (!login) {
        skipped++;
        continue;
      }
      const s = await prisma.streamer.upsert({
        where: { login },
        create: { login },
        update: {},
      });
      ids.push(s.id);
      added++;
    }

    if (attach.length && ids.length) {
      const pairs = attach.flatMap((accountId) => ids.map((streamerId) => ({ accountId, streamerId })));
      await prisma.accountStreamer.createMany({ data: pairs, skipDuplicates: true });
    }

    return { added, skipped, total: body.data.items.length };
  });

  fastify.delete('/:id', async (req) => {
    const id = (req.params as any).id as string;
    await prisma.streamer.delete({ where: { id } });
    return { ok: true };
  });
};
