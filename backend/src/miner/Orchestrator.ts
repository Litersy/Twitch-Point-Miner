import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { MinerSession } from './MinerSession.js';

class Orchestrator {
  private sessions = new Map<string, MinerSession>();

  async startAll(): Promise<void> {
    const accounts = await prisma.account.findMany({ where: { enabled: true } });
    for (const a of accounts) {
      await this.start(a.id).catch((err) => logger.warn({ err: err.message, accountId: a.id }, 'failed to start'));
    }
  }

  async start(accountId: string): Promise<void> {
    if (this.sessions.has(accountId)) return;
    const s = new MinerSession(accountId);
    this.sessions.set(accountId, s);
    try {
      await s.start();
    } catch (err: any) {
      this.sessions.delete(accountId);
      await prisma.account.update({
        where: { id: accountId },
        data: { status: 'error', lastError: err.message?.slice(0, 500) ?? 'unknown' },
      });
      throw err;
    }
  }

  async stop(accountId: string): Promise<void> {
    const s = this.sessions.get(accountId);
    if (!s) return;
    await s.stop();
    this.sessions.delete(accountId);
  }

  async restart(accountId: string): Promise<void> {
    await this.stop(accountId);
    await this.start(accountId);
  }

  async stopAll(): Promise<void> {
    for (const [, s] of this.sessions) {
      await s.stop().catch(() => {});
    }
    this.sessions.clear();
  }

  isRunning(accountId: string): boolean {
    return this.sessions.has(accountId);
  }
}

export const orchestrator = new Orchestrator();
