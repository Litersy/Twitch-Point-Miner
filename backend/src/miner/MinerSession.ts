import { prisma } from '../lib/prisma.js';
import { decryptSecret } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { TwitchGQL, type StreamInfo } from './client/gql.js';
import { PubSubConnection } from './pubsub/PubSubConnection.js';
import { fetchSpadeUrl, sendMinuteWatched, simulatePlayerOpen } from './client/spade.js';

type StreamerRow = { id: string; login: string; twitchId: string };

type WatchState = {
  sessionId: string;
  spadeUrl: string | null;
  info: StreamInfo;
  startedAt: number;
  lastSent: number;
};

const MAX_WATCH = 2; // Twitch limit: you can only accrue watch progress on 2 channels simultaneously.
const WATCH_TICK_MS = 60_000; // once per minute, as in the Python miner.

/**
 * A single Twitch account "session": holds the PubSub connection, polls online status
 * for attached streamers, keeps points snapshot up to date, persists events, and
 * performs the minute-watched pipeline so points actually accrue.
 */
export class MinerSession {
  private pubsub?: PubSubConnection;
  private gql?: TwitchGQL;
  private streamers: StreamerRow[] = [];
  private twitchUserId = '';
  private pollTimer?: NodeJS.Timeout;
  private watchTimer?: NodeJS.Timeout;
  private activeWatch = new Map<string, WatchState>();

  constructor(public readonly accountId: string) {}

  async start(): Promise<void> {
    const account = await prisma.account.findUnique({
      where: { id: this.accountId },
      include: { accountStreamers: { include: { streamer: true } } },
    });
    if (!account) throw new Error('account not found');
    if (!account.enabled) throw new Error('account disabled');

    const token = decryptSecret(account.authTokenEnc);
    if (!token) throw new Error('no auth token configured — re-link the account via Twitch device flow');
    this.gql = new TwitchGQL(token);

    let twitchUserId = account.twitchUserId;
    if (!twitchUserId) {
      twitchUserId = await this.gql.getChannelIdByLogin(account.login);
      if (twitchUserId) {
        await prisma.account.update({ where: { id: account.id }, data: { twitchUserId } });
      }
    }
    if (!twitchUserId) throw new Error('failed to resolve twitch user id');
    this.twitchUserId = twitchUserId;

    await this.writeLog('info', 'miner', 'session starting');
    await prisma.account.update({
      where: { id: account.id },
      data: { status: 'running', lastError: null, lastSeenAt: new Date() },
    });

    this.streamers = [];
    for (const as of account.accountStreamers) {
      let twitchId = as.streamer.twitchId;
      if (!twitchId) {
        twitchId = await this.gql.getChannelIdByLogin(as.streamer.login);
        if (twitchId) {
          await prisma.streamer.update({ where: { id: as.streamer.id }, data: { twitchId } });
        }
      }
      if (twitchId) this.streamers.push({ id: as.streamer.id, login: as.streamer.login, twitchId });
    }

    this.pubsub = new PubSubConnection(token, (topic, payload) => this.onPubSub(topic, payload));
    await this.pubsub.connect();
    this.pubsub.listen(`community-points-user-v1.${twitchUserId}`);
    for (const s of this.streamers) {
      this.pubsub.listen(`video-playback-by-id.${s.twitchId}`);
      this.pubsub.listen(`raid.${s.twitchId}`);
      this.pubsub.listen(`predictions-channel-v1.${s.twitchId}`);
    }

    await this.refreshPoints();

    this.pollTimer = setInterval(() => this.pollStreams().catch((e) => logger.warn({ e }, 'poll error')), 60_000);
    await this.pollStreams();

    this.watchTimer = setInterval(() => this.tickWatch().catch((e) => logger.warn({ e }, 'watch tick error')), WATCH_TICK_MS);
  }

  async stop(): Promise<void> {
    this.pubsub?.close();
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.watchTimer) clearInterval(this.watchTimer);
    for (const [, info] of this.activeWatch) {
      await prisma.watchSession.update({ where: { id: info.sessionId }, data: { endedAt: new Date() } }).catch(() => {});
    }
    this.activeWatch.clear();
    await prisma.account.update({ where: { id: this.accountId }, data: { status: 'stopped' } }).catch(() => {});
    await this.writeLog('info', 'miner', 'session stopped');
  }

  /** Add a streamer to this running session without a full restart. */
  async attachStreamer(streamerId: string): Promise<void> {
    if (!this.gql || !this.pubsub) return;
    if (this.streamers.some((s) => s.id === streamerId)) return;
    const s = await prisma.streamer.findUnique({ where: { id: streamerId } });
    if (!s) return;
    let twitchId = s.twitchId;
    if (!twitchId) {
      twitchId = await this.gql.getChannelIdByLogin(s.login);
      if (twitchId) await prisma.streamer.update({ where: { id: s.id }, data: { twitchId } });
    }
    if (!twitchId) return;
    this.streamers.push({ id: s.id, login: s.login, twitchId });
    this.pubsub.listen(`video-playback-by-id.${twitchId}`);
    this.pubsub.listen(`raid.${twitchId}`);
    this.pubsub.listen(`predictions-channel-v1.${twitchId}`);
  }

  private async onPubSub(topic: string, payload: any): Promise<void> {
    try {
      if (topic.startsWith('community-points-user-v1.')) {
        await this.onPoints(payload);
      } else if (topic.startsWith('video-playback-by-id.')) {
        const twitchId = topic.split('.')[1];
        await this.onPlayback(twitchId, payload);
      }
    } catch (err) {
      logger.warn({ err, topic }, 'pubsub handler error');
    }
  }

  private async onPoints(payload: any): Promise<void> {
    if (payload?.type === 'points-earned') {
      const gain = payload.data?.point_gain;
      if (!gain) return;
      const balance: number = payload.data.balance?.balance ?? 0;
      const channelId: string = gain.channel_id;
      const amount: number = gain.total_points;
      const reason: string = gain.reason_code;
      const streamer = this.streamers.find((s) => s.twitchId === channelId);
      if (!streamer) return;

      await prisma.pointsEvent.create({
        data: {
          accountId: this.accountId,
          streamerId: streamer.id,
          type: this.mapReason(reason),
          reasonCode: reason,
          amount,
          balance,
        },
      });
      await prisma.pointsSnapshot.create({
        data: { accountId: this.accountId, streamerId: streamer.id, points: balance },
      });
      await this.writeLog('info', 'points', `+${amount} on ${streamer.login} (${reason})`, { amount, reason });
    } else if (payload?.type === 'claim-available') {
      const channelId: string = payload.data?.claim?.channel_id;
      const claimId: string = payload.data?.claim?.id;
      const streamer = this.streamers.find((s) => s.twitchId === channelId);
      if (!streamer || !this.gql) return;
      const ok = await this.gql.claimCommunityPoints(channelId, claimId);
      await this.writeLog('info', 'points', `bonus ${ok ? 'claimed' : 'claim failed'} on ${streamer.login}`);
    }
  }

  private async onPlayback(twitchId: string, payload: any): Promise<void> {
    const streamer = this.streamers.find((s) => s.twitchId === twitchId);
    if (!streamer) return;
    if (payload?.type === 'stream-up') {
      await prisma.streamer.update({ where: { id: streamer.id }, data: { isOnline: true, lastCheckedAt: new Date() } });
      await this.writeLog('info', 'miner', `${streamer.login} went online`);
    } else if (payload?.type === 'stream-down') {
      await prisma.streamer.update({
        where: { id: streamer.id },
        data: { isOnline: false, viewersCount: null, lastCheckedAt: new Date() },
      });
      await this.writeLog('info', 'miner', `${streamer.login} went offline`);
    } else if (payload?.type === 'viewcount' && payload.viewers != null) {
      await prisma.streamer.update({
        where: { id: streamer.id },
        data: { viewersCount: payload.viewers, isOnline: true },
      });
    }
  }

  private async pollStreams(): Promise<void> {
    if (!this.gql) return;
    for (const s of this.streamers) {
      try {
        const info = await this.gql.getStreamInfo(s.login);
        await prisma.streamer.update({
          where: { id: s.id },
          data: {
            isOnline: info.isLive,
            streamTitle: info.title ?? null,
            streamGame: info.game ?? null,
            viewersCount: info.viewers ?? null,
            lastCheckedAt: new Date(),
          },
        });
      } catch (err: any) {
        logger.debug({ err: err.message, login: s.login }, 'stream info failed');
      }
    }
    await prisma.account.update({ where: { id: this.accountId }, data: { lastSeenAt: new Date() } });
  }

  /**
   * Core watch loop: pick up to 2 currently-online streamers (Twitch limit) ordered
   * by viewer count, then send minute-watched to each so points actually accrue.
   */
  private async tickWatch(): Promise<void> {
    if (!this.gql) return;

    // Snapshot of online, attached streamers, with current viewer count.
    const online = await prisma.streamer.findMany({
      where: {
        isOnline: true,
        accountStreamers: { some: { accountId: this.accountId } },
      },
      select: { id: true, login: true, twitchId: true, viewersCount: true },
    });

    // Priority: more viewers first (a bigger channel ≈ more subscribers ≈ more points value).
    online.sort((a, b) => (b.viewersCount ?? 0) - (a.viewersCount ?? 0));
    const toWatch = online.slice(0, MAX_WATCH);
    const toWatchIds = new Set(toWatch.map((s) => s.id));

    // Close sessions for streamers no longer in the top-N.
    for (const [streamerId, state] of [...this.activeWatch.entries()]) {
      if (!toWatchIds.has(streamerId)) {
        await prisma.watchSession.update({ where: { id: state.sessionId }, data: { endedAt: new Date() } }).catch(() => {});
        this.activeWatch.delete(streamerId);
      }
    }

    // Open sessions for new top-N streamers.
    for (const s of toWatch) {
      if (this.activeWatch.has(s.id)) continue;
      try {
        const info = await this.gql.getStreamInfo(s.login);
        if (!info.isLive || !info.broadcastId) continue;
        const spadeUrl = await fetchSpadeUrl(s.login);
        const session = await prisma.watchSession.create({
          data: { accountId: this.accountId, streamerId: s.id, minutes: 0 },
        });
        this.activeWatch.set(s.id, {
          sessionId: session.id,
          spadeUrl,
          info,
          startedAt: Date.now(),
          lastSent: 0,
        });
        await this.writeLog('info', 'miner', `watching ${s.login}`, { viewers: s.viewersCount });
      } catch (err: any) {
        logger.debug({ err: err?.message, login: s.login }, 'failed to open watch session');
      }
    }

    // For each active watch — send one minute-watched hit.
    for (const s of toWatch) {
      const state = this.activeWatch.get(s.id);
      if (!state) continue;
      try {
        if (!state.spadeUrl) {
          state.spadeUrl = await fetchSpadeUrl(s.login);
          if (!state.spadeUrl) continue;
        }
        const playback = await this.gql.getPlaybackAccessToken(s.login);
        if (playback) await simulatePlayerOpen(s.login, playback);

        if (!state.info.broadcastId || !s.twitchId) continue;
        const ok = await sendMinuteWatched(state.spadeUrl, {
          channelId: s.twitchId,
          broadcastId: state.info.broadcastId,
          userId: this.twitchUserId,
          channel: s.login,
          game: state.info.game ?? null,
          gameId: state.info.gameId ?? null,
        });
        if (ok) {
          await prisma.watchSession.update({
            where: { id: state.sessionId },
            data: { minutes: { increment: 1 } },
          });
          state.lastSent = Date.now();
        }
      } catch (err: any) {
        logger.debug({ err: err?.message, login: s.login }, 'minute-watched error');
      }
    }
  }

  private async refreshPoints(): Promise<void> {
    if (!this.gql) return;
    for (const s of this.streamers) {
      try {
        const ctx = await this.gql.getChannelPointsContext(s.login);
        if (!ctx) continue;
        await prisma.pointsSnapshot.create({
          data: { accountId: this.accountId, streamerId: s.id, points: ctx.balance },
        });
        if (ctx.availableClaimId) {
          const ok = await this.gql.claimCommunityPoints(ctx.channelId, ctx.availableClaimId);
          await this.writeLog('info', 'points', `initial bonus ${ok ? 'claimed' : 'failed'} on ${s.login}`);
        }
      } catch (err: any) {
        logger.debug({ err: err.message, login: s.login }, 'points ctx failed');
      }
    }
  }

  private mapReason(reason: string): string {
    const r = (reason || '').toUpperCase();
    if (r.includes('WATCH_STREAK')) return 'WATCH_STREAK';
    if (r.includes('WATCH')) return 'WATCH';
    if (r.includes('CLAIM')) return 'CLAIM';
    if (r.includes('RAID')) return 'RAID';
    if (r.includes('PREDICTION')) return 'PREDICTION';
    if (r.includes('DROP')) return 'DROPS';
    return 'OTHER';
  }

  private async writeLog(level: 'info' | 'warn' | 'error', category: string, message: string, meta?: unknown): Promise<void> {
    await prisma.actionLog.create({
      data: { accountId: this.accountId, level, category, message, meta: meta as any },
    });
  }
}
