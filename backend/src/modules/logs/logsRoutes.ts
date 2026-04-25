import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';

const querySchema = z.object({
  accountId: z.string().optional(),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().optional(),
});

export const logsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authRequired);

  fastify.get('/', async (req, rep) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return rep.code(400).send({ error: 'invalid_query' });
    const { accountId, level, category, limit, cursor } = parsed.data;
    const rows = await prisma.actionLog.findMany({
      where: {
        ...(accountId ? { accountId } : {}),
        ...(level ? { level } : {}),
        ...(category ? { category } : {}),
      },
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: { account: { select: { id: true, login: true } } },
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => ({
        id: r.id,
        level: r.level,
        category: r.category,
        message: r.message,
        meta: r.meta,
        createdAt: r.createdAt,
        account: r.account,
      })),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  });
};
