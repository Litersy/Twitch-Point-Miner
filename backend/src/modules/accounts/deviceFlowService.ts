import { randomBytes } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { encryptSecret } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';
import { requestDeviceCode, pollForToken } from '../../miner/client/deviceAuth.js';
import { TwitchGQL } from '../../miner/client/gql.js';

export type FlowStatus =
  | { status: 'pending'; userCode: string; verificationUri: string; expiresAt: number }
  | { status: 'success'; accountId: string; login: string }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'error'; message: string };

type FlowState = {
  id: string;
  login: string;
  displayName?: string;
  has2FA: boolean;
  groupIds: string[];
  deviceId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresAt: number;
  startedAt: number;
  status: FlowStatus;
  cancelled: boolean;
};

// in-process state — fine for single-instance deployment
const flows = new Map<string, FlowState>();

/**
 * Purge flows that are older than 10 minutes regardless of state,
 * so the map doesn't grow forever.
 */
function gc() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, f] of flows) if (f.startedAt < cutoff) flows.delete(id);
}
setInterval(gc, 60_000).unref();

export async function startDeviceFlow(input: {
  login: string;
  displayName?: string;
  has2FA?: boolean;
  groupIds?: string[];
}): Promise<FlowState> {
  const deviceId = randomBytes(16).toString('hex');
  const code = await requestDeviceCode(deviceId);
  const id = randomBytes(12).toString('hex');
  const flow: FlowState = {
    id,
    login: input.login.toLowerCase(),
    displayName: input.displayName,
    has2FA: !!input.has2FA,
    groupIds: input.groupIds ?? [],
    deviceId,
    deviceCode: code.device_code,
    userCode: code.user_code,
    verificationUri: code.verification_uri || 'https://www.twitch.tv/activate',
    interval: Math.max(2, code.interval || 5),
    expiresAt: Date.now() + code.expires_in * 1000,
    startedAt: Date.now(),
    status: {
      status: 'pending',
      userCode: code.user_code,
      verificationUri: code.verification_uri || 'https://www.twitch.tv/activate',
      expiresAt: Date.now() + code.expires_in * 1000,
    },
    cancelled: false,
  };
  flows.set(id, flow);

  // fire and forget — polling loop
  void runPollLoop(flow).catch((err) => {
    logger.warn({ err: err.message }, 'device flow poll loop crashed');
    flow.status = { status: 'error', message: err.message ?? 'unknown' };
  });

  return flow;
}

export function getFlow(id: string): FlowState | null {
  return flows.get(id) ?? null;
}

export function cancelFlow(id: string): boolean {
  const f = flows.get(id);
  if (!f) return false;
  f.cancelled = true;
  return true;
}

async function runPollLoop(flow: FlowState): Promise<void> {
  let currentInterval = flow.interval;
  while (!flow.cancelled && flow.status.status === 'pending') {
    if (Date.now() >= flow.expiresAt) {
      flow.status = { status: 'expired' };
      return;
    }
    await sleep(currentInterval * 1000);
    if (flow.cancelled) return;

    const result = await pollForToken(flow.deviceCode, flow.deviceId).catch((err) => ({
      kind: 'error' as const,
      message: err?.message ?? 'network error',
    }));

    if (result.kind === 'pending') continue;
    if (result.kind === 'slow_down') {
      currentInterval += 2;
      continue;
    }
    if (result.kind === 'expired') {
      flow.status = { status: 'expired' };
      return;
    }
    if (result.kind === 'denied') {
      flow.status = { status: 'denied' };
      return;
    }
    if (result.kind === 'error') {
      flow.status = { status: 'error', message: result.message };
      return;
    }
    // success
    const authToken = result.token.access_token;
    try {
      const account = await upsertAccountWithToken(flow, authToken);
      flow.status = { status: 'success', accountId: account.id, login: account.login };
    } catch (err: any) {
      flow.status = { status: 'error', message: err?.message ?? 'failed to save account' };
    }
    return;
  }
}

async function upsertAccountWithToken(flow: FlowState, accessToken: string): Promise<{ id: string; login: string }> {
  // Best-effort: resolve twitch user id now, so the miner does not need to do it later.
  let twitchUserId: string | null = null;
  try {
    const gql = new TwitchGQL(accessToken);
    twitchUserId = await gql.getChannelIdByLogin(flow.login);
  } catch {
    // ignore, miner will retry
  }

  const existing = await prisma.account.findUnique({ where: { login: flow.login } });
  const data = {
    displayName: flow.displayName,
    has2FA: flow.has2FA,
    twitchUserId: twitchUserId ?? undefined,
    authTokenEnc: encryptSecret(accessToken),
    status: 'idle',
    lastError: null,
  };

  const account = existing
    ? await prisma.account.update({ where: { id: existing.id }, data })
    : await prisma.account.create({ data: { login: flow.login, ...data } });

  if (flow.groupIds.length) {
    await prisma.groupOnAccount.deleteMany({ where: { accountId: account.id } });
    await prisma.groupOnAccount.createMany({
      data: flow.groupIds.map((groupId) => ({ accountId: account.id, groupId })),
      skipDuplicates: true,
    });
  }

  await prisma.actionLog.create({
    data: {
      accountId: account.id,
      level: 'info',
      category: 'auth',
      message: `account linked via device-flow`,
    },
  });

  return { id: account.id, login: account.login };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
