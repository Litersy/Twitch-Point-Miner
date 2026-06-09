import { request } from 'undici';
import { CLIENT_ID, CLIENT_VERSION, GQL, GQL_URL, type GqlOpName } from '../constants.js';
import { randomBytes } from 'node:crypto';
import {
  browserHeaders,
  pickUserAgent,
  preRequestJitter,
  retryDelayForResponse,
  sleep,
} from '../humanize.js';
import { logger } from '../../lib/logger.js';

function buildOp(name: GqlOpName, variables: Record<string, unknown>) {
  return {
    operationName: GQL[name].operationName,
    variables,
    extensions: { persistedQuery: { version: 1, sha256Hash: GQL[name].sha256 } },
  };
}

export type StreamInfo = {
  isLive: boolean;
  broadcastId?: string;
  title?: string;
  game?: string | null;
  gameId?: string | null;
  viewers?: number;
};

const MAX_ATTEMPTS = 5;

export class TwitchGQL {
  readonly deviceId: string;
  readonly userAgent: string;
  private readonly sessionId: string;

  constructor(private readonly authToken: string, userAgent?: string) {
    this.deviceId = randomBytes(16).toString('hex');
    this.sessionId = randomBytes(16).toString('hex');
    this.userAgent = userAgent ?? pickUserAgent();
  }

  getAuthToken(): string {
    return this.authToken;
  }

  private async post<T = unknown>(body: unknown): Promise<T> {
    await preRequestJitter();

    let attempt = 0;
    while (true) {
      const res = await request(GQL_URL, {
        method: 'POST',
        headers: browserHeaders({
          'content-type': 'application/json',
          'authorization': `OAuth ${this.authToken}`,
          'client-id': CLIENT_ID,
          'client-session-id': this.sessionId,
          'client-version': CLIENT_VERSION,
          'user-agent': this.userAgent,
          'x-device-id': this.deviceId,
        }),
        body: JSON.stringify(body),
        bodyTimeout: 20_000,
        headersTimeout: 20_000,
      });

      const delay = retryDelayForResponse(res, attempt);
      if (delay !== null && attempt < MAX_ATTEMPTS - 1) {
        attempt++;
        logger.warn({ status: res.statusCode, attempt, delay }, 'GQL retrying');
        await res.body.dump();
        await sleep(delay);
        continue;
      }

      if (res.statusCode >= 400) {
        const text = await res.body.text();
        throw new Error(`GQL HTTP ${res.statusCode}: ${text.slice(0, 500)}`);
      }
      return (await res.body.json()) as T;
    }
  }

  async getChannelIdByLogin(login: string): Promise<string | null> {
    const data = await this.post<any>(buildOp('GetIDFromLogin', { login }));
    return data?.data?.user?.id ?? null;
  }

  async getStreamInfo(login: string): Promise<StreamInfo> {
    const data = await this.post<any>(buildOp('VideoPlayerStreamInfoOverlayChannel', { channel: login }));
    const user = data?.data?.user;
    const stream = user?.stream;
    if (!stream) return { isLive: false };
    return {
      isLive: true,
      broadcastId: stream.id,
      title: user.broadcastSettings?.title,
      game: user.broadcastSettings?.game?.name ?? null,
      gameId: user.broadcastSettings?.game?.id ?? null,
      viewers: stream.viewersCount,
    };
  }

  async getChannelPointsContext(login: string): Promise<{
    balance: number;
    availableClaimId: string | null;
    channelId: string;
  } | null> {
    const data = await this.post<any>(buildOp('ChannelPointsContext', { channelLogin: login }));
    const channel = data?.data?.community?.channel;
    if (!channel) return null;
    const cp = channel.self?.communityPoints;
    return {
      balance: cp?.balance ?? 0,
      availableClaimId: cp?.availableClaim?.id ?? null,
      channelId: channel.id,
    };
  }

  /**
   * Claim a community-points bonus chest. Returns true only when Twitch actually
   * applied the claim. A soft failure — the chest already claimed (e.g. by another
   * tab), expired, or a stale claim id — comes back as HTTP 200 with
   * `data.claimCommunityPoints === null` and NO top-level `errors`, so checking
   * only `!errors` would report a phantom success. We require a non-null payload
   * (and no in-payload error) so we never log a claim that credited nothing.
   */
  async claimCommunityPoints(channelId: string, claimId: string): Promise<boolean> {
    const data = await this.post<any>(
      buildOp('ClaimCommunityPoints', { input: { channelID: channelId, claimID: claimId } }),
    );
    if (data?.errors) return false;
    const result = data?.data?.claimCommunityPoints;
    if (result == null) return false;
    if (result.error) return false;
    return true;
  }

  async getPlaybackAccessToken(login: string): Promise<{ signature: string; value: string } | null> {
    const data = await this.post<any>(
      buildOp('PlaybackAccessToken', {
        login,
        isLive: true,
        isVod: false,
        vodID: '',
        playerType: 'site',
      }),
    );
    const t = data?.data?.streamPlaybackAccessToken;
    if (!t?.signature || !t?.value) return null;
    return { signature: t.signature, value: t.value };
  }

  /** Fetch all followed channel logins. Ported from TwitchChannelPointsMiner.get_followers */
  async getChannelFollows(maxPages = 20): Promise<string[]> {
    const logins: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const data: any = await this.post(
        buildOp('ChannelFollows', { limit: 100, order: 'ASC', cursor: cursor ?? '' }),
      );
      const follows = data?.data?.user?.follows;
      if (!follows) break;
      for (const edge of follows.edges ?? []) {
        const login = edge?.node?.login;
        if (login) logins.push(String(login).toLowerCase());
        cursor = edge?.cursor ?? cursor;
      }
      if (!follows.pageInfo?.hasNextPage) break;
    }
    return logins;
  }
}
