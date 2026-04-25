import { z } from 'zod';
import 'dotenv/config';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  APP_PORT: z.coerce.number().default(4000),
  APP_PUBLIC_URL: z.string().default('http://localhost:8080'),
  APP_JWT_SECRET: z.string().min(32, 'APP_JWT_SECRET must be at least 32 chars'),
  APP_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'APP_ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().min(8).default('changemeplease'),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
