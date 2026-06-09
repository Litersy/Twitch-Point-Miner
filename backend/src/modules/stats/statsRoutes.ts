import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';

const rangeSchema = z.object({
  period: z.enum(['day', 'week', 'month']).default('week'),
  accountId: z.string().optional(),
  streamerId: z.string().optional(),
});

function periodToSince(period: 'day' | 'week' | 'month'): Date {
  const now = new Date();
  if (period === 'day') return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (period === 'week') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
}

function bucketOf(period: 'day' | 'week' | 'month'): string {
  // postgres date_trunc granularity
  if (period === 'day') return 'hour';
  if (period === 'week') return 'day';
  return 'day';
}

export const statsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authRequired);

  // High-level KPIs for the dashboard.
  fastify.get('/summary', async () => {
    const [accounts, streamers, onlineStreamers, totalEvents] = await Promise.all([
      prisma.account.count(),
      prisma.streamer.count(),
      prisma.streamer.count({ where: { isOnline: true } }),
      prisma.pointsEvent.count(),
    ]);

    // Aggregate latest points balance per (account, streamer) pair.
    const latest = await prisma.$queryRawUnsafe<{ total: bigint | null }[]>(`
      SELECT COALESCE(SUM(points), 0)::bigint AS total
      FROM (
        SELECT DISTINCT ON ("accountId", "streamerId") points
        FROM "PointsSnapshot"
        ORDER BY "accountId", "streamerId", "capturedAt" DESC, id DESC
      ) s
    `);
    const totalPoints = Number(latest[0]?.total ?? 0);

    const watchMinutes = await prisma.$queryRawUnsafe<{ m: bigint | null }[]>(`
      SELECT COALESCE(SUM(minutes), 0)::bigint AS m FROM "WatchSession"
    `);
    const totalWatchMinutes = Number(watchMinutes[0]?.m ?? 0);

    // Points earned today
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const earnedToday = await prisma.pointsEvent.aggregate({
      where: { occurredAt: { gte: since }, amount: { gt: 0 } },
      _sum: { amount: true },
    });

    return {
      accounts,
      streamers,
      onlineStreamers,
      totalEvents,
      totalPoints,
      totalWatchMinutes,
      pointsEarnedToday: earnedToday._sum.amount ?? 0,
    };
  });

  // Time-bucketed earnings series (for the chart).
  fastify.get('/timeseries', async (req, rep) => {
    const parsed = rangeSchema.safeParse(req.query);
    if (!parsed.success) return rep.code(400).send({ error: 'invalid_query' });
    const { period, accountId, streamerId } = parsed.data;
    const since = periodToSince(period);
    const bucket = bucketOf(period);

    const where = ['amount > 0', '"occurredAt" >= $1'];
    const params: any[] = [since];
    if (accountId) {
      params.push(accountId);
      where.push(`"accountId" = $${params.length}`);
    }
    if (streamerId) {
      params.push(streamerId);
      where.push(`"streamerId" = $${params.length}`);
    }
    const sql = `
      SELECT date_trunc('${bucket}', "occurredAt") AS ts, SUM(amount)::bigint AS total
      FROM "PointsEvent"
      WHERE ${where.join(' AND ')}
      GROUP BY 1 ORDER BY 1 ASC
    `;
    const rows = await prisma.$queryRawUnsafe<{ ts: Date; total: bigint }[]>(sql, ...params);
    return rows.map((r) => ({ ts: r.ts, total: Number(r.total) }));
  });

  // Points breakdown grouped by reason type — for the pie/bar chart
  fastify.get('/breakdown', async (req, rep) => {
    const parsed = rangeSchema.safeParse(req.query);
    if (!parsed.success) return rep.code(400).send({ error: 'invalid_query' });
    const since = periodToSince(parsed.data.period);
    const grouped = await prisma.pointsEvent.groupBy({
      by: ['type'],
      where: { amount: { gt: 0 }, occurredAt: { gte: since } },
      _sum: { amount: true },
    });
    return grouped.map((g) => ({ type: g.type, total: g._sum.amount ?? 0 }));
  });

  // Leaderboard per streamer (top earners)
  fastify.get('/top-streamers', async () => {
    const rows = await prisma.$queryRawUnsafe<{ streamerId: string; login: string; total: bigint }[]>(`
      SELECT pe."streamerId", s.login, SUM(pe.amount)::bigint AS total
      FROM "PointsEvent" pe
      JOIN "Streamer" s ON s.id = pe."streamerId"
      WHERE pe.amount > 0
      GROUP BY pe."streamerId", s.login
      ORDER BY total DESC
      LIMIT 10
    `);
    return rows.map((r) => ({ streamerId: r.streamerId, login: r.login, total: Number(r.total) }));
  });

  // Per-account totals
  fastify.get('/by-account', async () => {
    const rows = await prisma.$queryRawUnsafe<{ accountId: string; login: string; total: bigint; minutes: bigint }[]>(`
      SELECT a.id as "accountId", a.login,
             COALESCE((SELECT SUM(amount) FROM "PointsEvent" WHERE "accountId" = a.id AND amount > 0), 0)::bigint as total,
             COALESCE((SELECT SUM(minutes) FROM "WatchSession" WHERE "accountId" = a.id), 0)::bigint as minutes
      FROM "Account" a
      ORDER BY total DESC
    `);
    return rows.map((r) => ({
      accountId: r.accountId,
      login: r.login,
      total: Number(r.total),
      watchMinutes: Number(r.minutes),
    }));
  });

  // Current points per (account, streamer) — for tables / detailed views
  fastify.get('/balances', async () => {
    const rows = await prisma.$queryRawUnsafe<{
      accountId: string;
      streamerId: string;
      accountLogin: string;
      streamerLogin: string;
      points: number;
      capturedAt: Date;
    }[]>(`
      SELECT DISTINCT ON (s."accountId", s."streamerId")
        s."accountId", s."streamerId",
        a.login as "accountLogin",
        str.login as "streamerLogin",
        s.points, s."capturedAt"
      FROM "PointsSnapshot" s
      JOIN "Account" a ON a.id = s."accountId"
      JOIN "Streamer" str ON str.id = s."streamerId"
      ORDER BY s."accountId", s."streamerId", s."capturedAt" DESC, s.id DESC
    `);
    return rows;
  });
};
