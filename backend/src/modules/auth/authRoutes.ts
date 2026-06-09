import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/login', async (req, rep) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send({ error: 'invalid_body' });
    const { username, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return rep.code(401).send({ error: 'invalid_credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return rep.code(401).send({ error: 'invalid_credentials' });

    const token = await rep.jwtSign({ sub: user.id, username: user.username }, { expiresIn: '7d' });
    return { token, user: { id: user.id, username: user.username, locale: user.locale, role: user.role } };
  });

  fastify.get('/me', { preHandler: fastify.authRequired }, async (req, rep) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) return rep.code(404).send({ error: 'not_found' });
    return { id: user.id, username: user.username, locale: user.locale, role: user.role };
  });

  fastify.patch('/me', { preHandler: fastify.authRequired }, async (req, rep) => {
    const body = z
      .object({
        locale: z.enum(['ru', 'en']).optional(),
        username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_.-]+$/).optional(),
        password: z.string().min(8).max(200).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return rep.code(400).send({ error: 'invalid_body' });

    const data: Record<string, unknown> = {};
    if (body.data.locale) data.locale = body.data.locale;
    if (body.data.password) data.passwordHash = await bcrypt.hash(body.data.password, 10);
    if (body.data.username) {
      const taken = await prisma.user.findFirst({
        where: { username: body.data.username, NOT: { id: req.userId! } },
        select: { id: true },
      });
      if (taken) return rep.code(409).send({ error: 'username_taken' });
      data.username = body.data.username;
    }

    const user = await prisma.user.update({ where: { id: req.userId! }, data });

    // If login/password changed, issue a fresh JWT so the client can keep working.
    const reissue = !!(body.data.username || body.data.password);
    const token = reissue
      ? await rep.jwtSign({ sub: user.id, username: user.username }, { expiresIn: '7d' })
      : undefined;

    return {
      id: user.id,
      username: user.username,
      locale: user.locale,
      role: user.role,
      ...(token ? { token } : {}),
    };
  });
};
