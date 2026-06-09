import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { env } from '../lib/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    authRequired: (req: FastifyRequest, rep: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId?: string;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; username: string };
    user: { sub: string; username: string };
  }
}

async function fastifyPlugin(fastify: any): Promise<void> {
  await fastify.register(jwt, { secret: env.APP_JWT_SECRET });

  fastify.decorate('authRequired', async (req: FastifyRequest, rep: FastifyReply) => {
    try {
      await req.jwtVerify();
      req.userId = (req.user as any).sub;
    } catch {
      return rep.code(401).send({ error: 'unauthorized' });
    }
  });
}

const authPlugin: FastifyPluginAsync = fp(fastifyPlugin);
export default authPlugin;
