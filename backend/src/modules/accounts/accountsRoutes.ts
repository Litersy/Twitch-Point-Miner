import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { encryptSecret, decryptSecret } from '../../lib/crypto.js';
import { sendMinerCommand } from '../../lib/minerCommand.js';
import { startDeviceFlow, getFlow, cancelFlow } from './deviceFlowService.js';
import { TwitchGQL } from '../../miner/client/gql.js';

const startFlowSchema = z.object({
  login: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_]+$/),
  displayName: z.string().max(128).optional(),
  has2FA: z.boolean().optional(),
  groupIds: z.array(z.string()).optional(),
});

// kept for power users — manually paste auth_token instead of running device flow
const manualCreateSchema = z.object({
  login: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_]+$/),
  displayName: z.string().max(128).optional(),
  authToken: z.string().min(10).max(200),
  has2FA: z.boolean().optional(),
  groupIds: z.array(z.string()).optional(),
});

const updateSchema = z.object({
  displayName: z.string().max(128).optional(),
  authToken: z.string().min(10).max(200).optional(),
  has2FA: z.boolean().optional(),
  enabled: z.boolean().optional(),
  groupIds: z.array(z.string()).optional(),
  sleepEnabled: z.boolean().optional(),
  timezone: z.string().min(1).max(64).optional(),
  activeStartMin: z.number().int().min(0).max(1439).optional(),
  activeEndMin: z.number().int().min(0).max(1439).optional(),
  jitterFromMin: z.number().int().min(0).max(180).optional(),
  jitterToMin: z.number().int().min(0).max(180).optional(),
}).refine(
  (d) => d.jitterFromMin === undefined || d.jitterToMin === undefined || d.jitterFromMin <= d.jitterToMin,
  { message: 'jitterFromMin must be <= jitterToMin' },
);

export const accountsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authRequired);

  fastify.get('/', async () => {
    const accounts = await prisma.account.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        groups: { include: { group: true } },
        _count: { select: { accountStreamers: true } },
      },
    });
    return accounts.map((a) => ({
      id: a.id,
      login: a.login,
      displayName: a.displayName,
      twitchUserId: a.twitchUserId,
      has2FA: a.has2FA,
      status: a.status,
      lastError: a.lastError,
      lastSeenAt: a.lastSeenAt,
      enabled: a.enabled,
      hasAuthToken: !!a.authTokenEnc,
      streamerCount: a._count.accountStreamers,
      groups: a.groups.map((g) => ({ id: g.group.id, name: g.group.name, color: g.group.color })),
      sleepEnabled: a.sleepEnabled,
      timezone: a.timezone,
      activeStartMin: a.activeStartMin,
      activeEndMin: a.activeEndMin,
      jitterFromMin: a.jitterFromMin,
      jitterToMin: a.jitterToMin,
      createdAt: a.createdAt,
    }));
  });

  // === OAuth Device Flow (preferred) ===
  fastify.post('/device-flow/start', async (req, rep) => {
    const parsed = startFlowSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    try {
      const flow = await startDeviceFlow(parsed.data);
      return {
        flowId: flow.id,
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        expiresAt: flow.expiresAt,
        interval: flow.interval,
      };
    } catch (err: any) {
      return rep.code(502).send({ error: 'twitch_oauth_failed', message: err?.message });
    }
  });

  fastify.get('/device-flow/:flowId', async (req, rep) => {
    const flowId = (req.params as any).flowId as string;
    const flow = getFlow(flowId);
    if (!flow) return rep.code(404).send({ error: 'not_found' });
    return flow.status;
  });

  fastify.post('/device-flow/:flowId/cancel', async (req, rep) => {
    const flowId = (req.params as any).flowId as string;
    const ok = cancelFlow(flowId);
    if (!ok) return rep.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // === Manual token (power users / recovery) ===
  fastify.post('/', async (req, rep) => {
    const parsed = manualCreateSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
    const { login, displayName, authToken, has2FA, groupIds } = parsed.data;

    const existing = await prisma.account.findUnique({ where: { login } });
    if (existing) return rep.code(409).send({ error: 'login_taken' });

    const account = await prisma.account.create({
      data: {
        login: login.toLowerCase(),
        displayName,
        has2FA: !!has2FA,
        authTokenEnc: encryptSecret(authToken),
        groups: groupIds ? { create: groupIds.map((groupId) => ({ groupId })) } : undefined,
      },
    });
    return { id: account.id };
  });

  fastify.patch('/:id', async (req, rep) => {
    const id = (req.params as any).id as string;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send({ error: 'invalid_body' });
    const d = parsed.data;

    const data: Record<string, unknown> = {};
    if (d.displayName !== undefined) data.displayName = d.displayName;
    if (d.has2FA !== undefined) data.has2FA = d.has2FA;
    if (d.enabled !== undefined) data.enabled = d.enabled;
    if (d.authToken !== undefined) data.authTokenEnc = encryptSecret(d.authToken);
    if (d.sleepEnabled !== undefined) data.sleepEnabled = d.sleepEnabled;
    if (d.timezone !== undefined) data.timezone = d.timezone;
    if (d.activeStartMin !== undefined) data.activeStartMin = d.activeStartMin;
    if (d.activeEndMin !== undefined) data.activeEndMin = d.activeEndMin;
    if (d.jitterFromMin !== undefined) data.jitterFromMin = d.jitterFromMin;
    if (d.jitterToMin !== undefined) data.jitterToMin = d.jitterToMin;

    await prisma.account.update({ where: { id }, data });

    if (d.groupIds) {
      await prisma.groupOnAccount.deleteMany({ where: { accountId: id } });
      if (d.groupIds.length) {
        await prisma.groupOnAccount.createMany({
          data: d.groupIds.map((groupId) => ({ groupId, accountId: id })),
        });
      }
    }
    return { ok: true };
  });

  fastify.delete('/:id', async (req) => {
    const id = (req.params as any).id as string;
    await sendMinerCommand('stop', id);
    await prisma.account.delete({ where: { id } });
    return { ok: true };
  });

  fastify.post('/:id/start', async (req) => {
    const id = (req.params as any).id as string;
    await sendMinerCommand('start', id);
    return { ok: true };
  });

  fastify.post('/:id/stop', async (req) => {
    const id = (req.params as any).id as string;
    await sendMinerCommand('stop', id);
    return { ok: true };
  });

  fastify.post('/:id/restart', async (req) => {
    const id = (req.params as any).id as string;
    await sendMinerCommand('restart', id);
    return { ok: true };
  });

  /**
   * Import every streamer this account follows on Twitch, create Streamer rows for
   * them, and attach them to this account. Reuses the ChannelFollows persisted GQL
   * from the Python miner.
   */
  fastify.post('/:id/import-followed', async (req, rep) => {
    const id = (req.params as any).id as string;
    const account = await prisma.account.findUnique({ where: { id } });
    if (!account) return rep.code(404).send({ error: 'not_found' });
    const token = decryptSecret(account.authTokenEnc);
    if (!token) return rep.code(400).send({ error: 'no_token', message: 'account has no auth token' });

    try {
      const gql = new TwitchGQL(token);
      const logins = await gql.getChannelFollows();
      if (!logins.length) return { imported: 0, attached: 0, total: 0 };

      let imported = 0;
      const ids: string[] = [];
      for (const login of logins) {
        const s = await prisma.streamer.upsert({
          where: { login },
          create: { login },
          update: {},
        });
        ids.push(s.id);
        imported++;
      }
      await prisma.accountStreamer.createMany({
        data: ids.map((streamerId) => ({ accountId: id, streamerId })),
        skipDuplicates: true,
      });

      await prisma.actionLog.create({
        data: {
          accountId: id,
          level: 'info',
          category: 'miner',
          message: `imported ${imported} followed streamers`,
        },
      });
      // reload miner session so it starts listening to the new streamers
      await sendMinerCommand('restart', id);
      return { imported, attached: ids.length, total: logins.length };
    } catch (err: any) {
      return rep.code(502).send({ error: 'twitch_error', message: err?.message?.slice(0, 300) });
    }
  });

  fastify.post('/:id/streamers', async (req, rep) => {
    const id = (req.params as any).id as string;
    const body = z.object({ streamerIds: z.array(z.string()).min(1) }).safeParse(req.body);
    if (!body.success) return rep.code(400).send({ error: 'invalid_body' });
    await prisma.accountStreamer.createMany({
      data: body.data.streamerIds.map((streamerId) => ({ accountId: id, streamerId })),
      skipDuplicates: true,
    });
    return { ok: true };
  });

  fastify.delete('/:id/streamers/:streamerId', async (req) => {
    const { id, streamerId } = req.params as any;
    await prisma.accountStreamer.deleteMany({ where: { accountId: id, streamerId } });
    return { ok: true };
  });
};
