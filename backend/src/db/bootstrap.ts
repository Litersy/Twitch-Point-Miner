import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

/**
 * Create default admin user if no users exist.
 * Idempotent — safe to run on every startup.
 */
export async function ensureAdminUser(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) return;
  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
  await prisma.user.create({
    data: { username: env.ADMIN_USERNAME, passwordHash, role: 'admin' },
  });
  logger.info({ username: env.ADMIN_USERNAME }, 'default admin user created');
}
