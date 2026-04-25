import { redis } from './redis.js';

const CMD_CHANNEL = 'twf:miner:cmd';

export async function sendMinerCommand(action: 'start' | 'stop' | 'restart', accountId: string): Promise<void> {
  await redis.publish(CMD_CHANNEL, JSON.stringify({ action, accountId }));
}
