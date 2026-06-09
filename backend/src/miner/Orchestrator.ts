import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { MinerSession } from './MinerSession.js';
import { rand, sleep } from './humanize.js';

// When several accounts start in the same boot, fire them with random gaps
// between starts. This avoids a synchronised burst of GQL/PubSub traffic
// from the same egress IP that would look very robotic.
const STARTUP_STAGGER_MIN_MS = 4_000;
const STARTUP_STAGGER_MAX_MS = 25_000;

class Orchestrator {
  private sessions = new Map<string, MinerSession>();

  async startAll(): Promise<void> {
    const accounts = await prisma.account.findMany({ where: { enabled: true } });
    let first = true;
    for (const a of accounts) {
      if (!first) await sleep(rand(STARTUP_STAGGER_MIN_MS, STARTUP_STAGGER_MAX_MS));
      first = false;
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
    // Tiny gap so the new session doesn't immediately re-hit GQL with the same
    // request burst that the old session was just doing.
    await sleep(rand(1_000, 4_000));
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
