import { orchestrator } from './miner/Orchestrator.js';
import { redis } from './lib/redis.js';
import { logger } from './lib/logger.js';

const CMD_CHANNEL = 'twf:miner:cmd';

async function main() {
  logger.info('miner worker starting');
  await orchestrator.startAll();

  const sub = redis.duplicate();
  await sub.subscribe(CMD_CHANNEL);
  sub.on('message', async (_chan, raw) => {
    try {
      const cmd = JSON.parse(raw) as { action: 'start' | 'stop' | 'restart'; accountId: string };
      logger.info({ cmd }, 'received command');
      if (cmd.action === 'start') await orchestrator.start(cmd.accountId);
      else if (cmd.action === 'stop') await orchestrator.stop(cmd.accountId);
      else if (cmd.action === 'restart') await orchestrator.restart(cmd.accountId);
    } catch (err) {
      logger.warn({ err }, 'command handling failed');
    }
  });

  const shutdown = async () => {
    logger.info('shutting down');
    await orchestrator.stopAll();
    await sub.quit();
    await redis.quit();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'worker fatal');
  process.exit(1);
});
