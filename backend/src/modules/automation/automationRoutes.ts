import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { sendMinerCommand } from '../../lib/minerCommand.js';

const settingsSchema = z.object({
  accountId: z.string(),
  streamerId: z.string().nullable().optional(),
  makePredictions: z.boolean().optional(),
  claimDrops: z.boolean().optional(),
  claimMoments: z.boolean().optional(),
  followRaid: z.boolean().optional(),
  watchStreak: z.boolean().optional(),
  betPercentage: z.number().int().min(1).max(100).optional(),
  betMaxPoints: z.number().int().min(0).max(10_000_000).optional(),
  betMinPoints: z.number().int().min(0).max(10_000_000).optional(),
});

export const automationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authRequired);

  fastify.get('/', async (req) => {
    const accountId = (req.query as any)?.accountId as string | undefined;
    return prisma.automationSetting.findMany({
      where: accountId ? { accountId } : undefined,
      include: { streamer: { select: { id: true, login: true } } },
    });
  });

  fastify.put('/', async (req, rep) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send({ error: 'invalid_body' });
    const { accountId, streamerId, ...rest } = parsed.data;
    const existing = await prisma.automationSetting.findUnique({
      where: { accountId_streamerId: { accountId, streamerId: streamerId ?? null as any } },
    }).catch(() => null);

    const row = existing
      ? await prisma.automationSetting.update({ where: { id: existing.id }, data: rest })
      : await prisma.automationSetting.create({ data: { accountId, streamerId: streamerId ?? null, ...rest } });

    // reload miner session for this account
    await sendMinerCommand('restart', accountId);
    return row;
  });

  fastify.delete('/:id', async (req) => {
    const id = (req.params as any).id as string;
    const row = await prisma.automationSetting.findUnique({ where: { id } });
    await prisma.automationSetting.delete({ where: { id } });
    if (row) await sendMinerCommand('restart', row.accountId);
    return { ok: true };
  });
};
