import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import authPlugin from './plugins/auth.js';
import { ensureAdminUser } from './db/bootstrap.js';
import { authRoutes } from './modules/auth/authRoutes.js';
import { accountsRoutes } from './modules/accounts/accountsRoutes.js';
import { streamersRoutes } from './modules/streamers/streamersRoutes.js';
import { statsRoutes } from './modules/stats/statsRoutes.js';
import { automationRoutes } from './modules/automation/automationRoutes.js';
import { logsRoutes } from './modules/logs/logsRoutes.js';

async function main(): Promise<void> {
  const app = Fastify({ logger, bodyLimit: 1_048_576 });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(sensible);
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    redis,
  });
  await app.register(authPlugin);

  app.get('/healthz', async () => ({ ok: true }));

  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(accountsRoutes, { prefix: '/api/accounts' });
  app.register(streamersRoutes, { prefix: '/api/streamers' });
  app.register(statsRoutes, { prefix: '/api/stats' });
  app.register(automationRoutes, { prefix: '/api/automation' });
  app.register(logsRoutes, { prefix: '/api/logs' });

  await prisma.$connect();
  await ensureAdminUser();

  await app.listen({ port: env.APP_PORT, host: '0.0.0.0' });
  logger.info(`API listening on :${env.APP_PORT}`);
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
