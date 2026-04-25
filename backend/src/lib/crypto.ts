import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from './env.js';

const KEY = Buffer.from(env.APP_ENCRYPTION_KEY, 'hex');
const ALGO = 'aes-256-gcm';

/**
 * Encrypt secret and return base64 payload: iv(12) | tag(16) | ciphertext.
 * Returns empty string for null/empty inputs so callers can pass-through optional values.
 */
export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}
