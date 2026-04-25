import { prisma } from '../lib/prisma.js';
import { decryptSecret } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { isAccountSleeping } from '../lib/sleepWindow.js';
import { TwitchGQL, type StreamInfo } from './client/gql.js';
import { PubSubConnection } from './pubsub/PubSubConnection.js';
import { fetchSpadeUrl, sendMinuteWatched, simulatePlayerOpen } from './client/spade.js';
import { chance, microJitter, pickUserAgent, rand, sleep } from './humanize.js';

type StreamerRow = { id: string; login: string; twitchId: string };

type WatchState = {
  sessionId: string;
  spadeUrl: string | null;
  info: StreamInfo;
  startedAt: number;
  lastSent: number;
};

const MAX_WATCH = 2; // Twitch limit: you can only accrue watch progress on 2 channels simultaneously.

// Watch tick: roughly once a minute (matches Python miner's 60s pacing) but
// with ±15s jitter so two accounts on the same panel never fire on the same tick.
const WATCH_TICK_MIN_MS = 55_000;
const WATCH_TICK_MAX_MS = 80_000;

// Stream-info polling cadence. Online streamers get refreshed roughly every minute
// (PubSub also pushes viewcount, so this is mostly belt-and-suspenders).
const POLL_TICK_MIN_MS = 75_000;
const POLL_TICK_MAX_MS = 110_000;

// Cooldown for re-checking a streamer that's currently offline. PubSub pushes
// stream-up events anyway, so polling offline channels every minute is wasted
// (and noisy) traffic — exactly what anti-abuse heuristics watch for.
const OFFLINE_RECHECK_MS = 5 * 60_000;

// Probability of skipping a single "stream info" poll for a given streamer on
// a given tick. Real users do not refresh every channel every minute — this
// breaks up the perfectly-uniform polling pattern.
const POLL_SKIP_CHANCE = 0.15;

/**
 * A single Twitch account "session": holds the PubSub connection, polls online status
 * for attached streamers, keeps points snapshot up to date, persists events, and
 * performs the minute-watched pipeline so points actually accrue.
 *
 * All outbound traffic is randomised — request order, headers (per-session UA),
 * inter-request jitter, retry on 429/5xx — so the account looks like a real
 * browser tab rather than a polling bot.
 */
export class MinerSession {
  private pubsub?: PubSubConnection;
  private gql?: TwitchGQL;
  private streamers: StreamerRow[] = [];
  private twitchUserId = '';
  private pollTimer?: NodeJS.Timeout;
  private watchTimer?: NodeJS.Timeout;
  private activeWatch = new Map<string, WatchState>();
  private stopping = false;
  private readonly userAgent = pickUserAgent();

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
    this.gql = new TwitchGQL(token, this.userAgent);

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
      // Match the upstream miner: small randomised pauses between streamer init
      // calls so the GQL traffic doesn't burst all at once.
      await microJitter();
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
    await this.pollStreams();

    this.scheduleNextPoll();
    this.scheduleNextWatch();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.pubsub?.close();
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.watchTimer) clearTimeout(this.watchTimer);
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

  /**
   * Read current sleep config from DB and check whether the account should be
   * "asleep" right now. Hot-read so changes from the UI take effect on the
   * next tick without requiring a session restart.
   */
  private async isSleeping(): Promise<boolean> {
    const acc = await prisma.account.findUnique({
      where: { id: this.accountId },
      select: {
        id: true,
        sleepEnabled: true,
        timezone: true,
        activeStartMin: true,
        activeEndMin: true,
        jitterFromMin: true,
        jitterToMin: true,
      },
    });
    if (!acc) return false;
    return isAccountSleeping(acc);
  }

  /** Close every active watch session — used when the account goes to sleep. */
  private async closeAllActiveWatches(reason: string): Promise<void> {
    if (this.activeWatch.size === 0) return;
    for (const [streamerId, state] of [...this.activeWatch.entries()]) {
      await prisma.watchSession.update({ where: { id: state.sessionId }, data: { endedAt: new Date() } }).catch(() => {});
      this.activeWatch.delete(streamerId);
    }
    await this.writeLog('info', 'miner', `closed all watch sessions (${reason})`);
  }

  private scheduleNextPoll(): void {
    if (this.stopping) return;
    this.pollTimer = setTimeout(
      () =>
        this.pollStreams()
          .catch((e) => logger.warn({ e }, 'poll error'))
          .finally(() => this.scheduleNextPoll()),
      rand(POLL_TICK_MIN_MS, POLL_TICK_MAX_MS),
    );
  }

  private scheduleNextWatch(): void {
    if (this.stopping) return;
    this.watchTimer = setTimeout(
      () =>
        this.tickWatch()
          .catch((e) => logger.warn({ e }, 'watch tick error'))
          .finally(() => this.scheduleNextWatch()),
      rand(WATCH_TICK_MIN_MS, WATCH_TICK_MAX_MS),
    );
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
      // Sleeping humans don't click the chest in the moment it appears.
      if (await this.isSleeping()) return;
      // Real users don't claim within a millisecond of the bonus appearing.
      await sleep(rand(800, 3500));
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

    // Sleep window: a real human isn't refreshing channel pages at 4am.
    if (await this.isSleeping()) return;

    // Fetch current state from the DB so we know which streamers are offline
    // (and how recently we last checked them).
    const rows = await prisma.streamer.findMany({
      where: { id: { in: this.streamers.map((s) => s.id) } },
      select: { id: true, login: true, isOnline: true, lastCheckedAt: true },
    });
    const stateById = new Map(rows.map((r) => [r.id, r]));

    // Shuffle so the per-tick order isn't deterministic — anti-abuse systems
    // often look for "always polls X then Y then Z" patterns.
    const order = [...this.streamers].sort(() => Math.random() - 0.5);

    const now = Date.now();
    for (const s of order) {
      const state = stateById.get(s.id);
      const lastCheckedMs = state?.lastCheckedAt ? state.lastCheckedAt.getTime() : 0;
      const sinceCheck = now - lastCheckedMs;

      // Offline streamers: only re-check periodically (PubSub pushes stream-up).
      if (state && state.isOnline === false && sinceCheck < OFFLINE_RECHECK_MS) continue;

      // Real users don't refresh every channel on every tick.
      if (state?.isOnline && chance(POLL_SKIP_CHANCE)) continue;

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

      // Spread requests out so we don't burst the GQL endpoint.
      await microJitter();
    }
    await prisma.account.update({ where: { id: this.accountId }, data: { lastSeenAt: new Date() } });
  }

  /**
   * Core watch loop: pick up to 2 currently-online streamers (Twitch limit) ordered
   * by viewer count, then send minute-watched to each so points actually accrue.
   */
  private async tickWatch(): Promise<void> {
    if (!this.gql) return;

    // Sleep window: stop watching, close active sessions, and skip until awake.
    if (await this.isSleeping()) {
      await this.closeAllActiveWatches('account asleep');
      return;
    }

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
        const spadeUrl = await fetchSpadeUrl(s.login, this.userAgent);
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
      // Don't open all watch sessions in the same instant.
      await microJitter();
    }

    // For each active watch — send one minute-watched hit, with jitter between hits
    // so two parallel watches don't fire on the same millisecond.
    for (const s of toWatch) {
      const state = this.activeWatch.get(s.id);
      if (!state) continue;
      try {
        if (!state.spadeUrl) {
          state.spadeUrl = await fetchSpadeUrl(s.login, this.userAgent);
          if (!state.spadeUrl) continue;
        }
        const playback = await this.gql.getPlaybackAccessToken(s.login);
        if (playback) await simulatePlayerOpen(s.login, playback, this.userAgent);

        if (!state.info.broadcastId || !s.twitchId) continue;
        const ok = await sendMinuteWatched(
          state.spadeUrl,
          {
            channelId: s.twitchId,
            broadcastId: state.info.broadcastId,
            userId: this.twitchUserId,
            channel: s.login,
            game: state.info.game ?? null,
            gameId: state.info.gameId ?? null,
          },
          this.userAgent,
        );
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
      // Spread the two minute-watched hits across the tick so they don't co-fire.
      await sleep(rand(1500, 5000));
    }
  }

  private async refreshPoints(): Promise<void> {
    if (!this.gql) return;
    const sleeping = await this.isSleeping();
    for (const s of this.streamers) {
      try {
        const ctx = await this.gql.getChannelPointsContext(s.login);
        if (!ctx) continue;
        await prisma.pointsSnapshot.create({
          data: { accountId: this.accountId, streamerId: s.id, points: ctx.balance },
        });
        if (ctx.availableClaimId && !sleeping) {
          // Stagger initial bonus claims with a small human-like delay.
          await sleep(rand(500, 2500));
          const ok = await this.gql.claimCommunityPoints(ctx.channelId, ctx.availableClaimId);
          await this.writeLog('info', 'points', `initial bonus ${ok ? 'claimed' : 'failed'} on ${s.login}`);
        }
      } catch (err: any) {
        logger.debug({ err: err.message, login: s.login }, 'points ctx failed');
      }
      await microJitter();
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
