import { request } from 'undici';
import { TWITCH_URL } from '../constants.js';
import { browserHeaders, pickUserAgent, preRequestJitter, retryDelayForResponse, sleep } from '../humanize.js';
import { logger } from '../../lib/logger.js';

/**
 * Minute-watched pipeline — direct port of
 * TwitchChannelPointsMiner.classes.Twitch.send_minute_watched_events:
 *
 *   1. fetch twitch.tv/<login>, find settings.js URL, fetch it, extract spade_url
 *   2. get PlaybackAccessToken via GQL (done elsewhere)
 *   3. fetch usher.ttvnw.net m3u8 (the HLS playlist)
 *   4. parse playlist, HEAD the lowest-quality stream URL
 *   5. POST to spade_url with form-encoded data=base64(json(payload))
 *
 * Only the 204 response on step (5) is what Twitch counts as "one minute watched"
 * for the purposes of channel-points accrual.
 */

const SETTINGS_RE = /(https:\/\/static\.twitchcdn\.net\/config\/settings.*?js|https:\/\/assets\.twitch\.tv\/config\/settings.*?\.js)/;
const SPADE_RE = /"spade_url":"(.*?)"/;
const MAX_ATTEMPTS = 4;

type Method = 'GET' | 'HEAD' | 'POST';

async function httpWithRetry(
  url: string,
  init: { method: Method; headers: Record<string, string>; body?: string },
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; bodyText(): Promise<string>; dump(): Promise<void> }> {
  await preRequestJitter();
  let attempt = 0;
  while (true) {
    const res = await request(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      bodyTimeout: 20_000,
      headersTimeout: 20_000,
    });

    const delay = retryDelayForResponse(res, attempt);
    if (delay !== null && attempt < MAX_ATTEMPTS - 1) {
      attempt++;
      logger.warn({ status: res.statusCode, attempt, delay, url }, 'spade retrying');
      await res.body.dump();
      await sleep(delay);
      continue;
    }

    return {
      statusCode: res.statusCode,
      headers: res.headers,
      bodyText: () => res.body.text(),
      dump: () => res.body.dump(),
    };
  }
}

export async function fetchSpadeUrl(login: string, userAgent: string = pickUserAgent()): Promise<string | null> {
  try {
    const page = await httpWithRetry(`${TWITCH_URL}/${login}`, {
      method: 'GET',
      headers: browserHeaders({ 'user-agent': userAgent }),
    });
    if (page.statusCode >= 400) {
      await page.dump();
      return null;
    }
    const html = await page.bodyText();
    const settingsMatch = html.match(SETTINGS_RE);
    if (!settingsMatch) return null;
    const settingsUrl = settingsMatch[1];

    const settings = await httpWithRetry(settingsUrl, {
      method: 'GET',
      headers: browserHeaders({ 'user-agent': userAgent }),
    });
    if (settings.statusCode >= 400) {
      await settings.dump();
      return null;
    }
    const js = await settings.bodyText();
    const spade = js.match(SPADE_RE);
    return spade?.[1] ?? null;
  } catch {
    return null;
  }
}

export type MinuteWatchedProps = {
  channelId: string;
  broadcastId: string;
  userId: string;
  channel: string;
  game?: string | null;
  gameId?: string | null;
};

function encodeMinuteWatchedBody(props: MinuteWatchedProps): string {
  const event: Record<string, unknown> = {
    channel_id: props.channelId,
    broadcast_id: props.broadcastId,
    player: 'site',
    user_id: props.userId,
    live: true,
    channel: props.channel,
  };
  if (props.game) event.game = props.game;
  if (props.gameId) event.game_id = props.gameId;

  const payload = [{ event: 'minute-watched', properties: event }];
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  return `data=${encodeURIComponent(b64)}`;
}

/**
 * Simulate the browser opening the HLS stream: fetch playlist, then HEAD the lowest
 * quality variant. This is what the 2024/5 Twitch API fix in the Python miner does.
 */
export async function simulatePlayerOpen(
  login: string,
  playback: { signature: string; value: string },
  userAgent: string = pickUserAgent(),
): Promise<boolean> {
  try {
    const hlsUrl = `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?sig=${playback.signature}&token=${encodeURIComponent(
      playback.value,
    )}`;
    const hls = await httpWithRetry(hlsUrl, {
      method: 'GET',
      headers: browserHeaders({ 'user-agent': userAgent }),
    });
    if (hls.statusCode !== 200) {
      await hls.dump();
      return false;
    }
    const text = await hls.bodyText();
    const lines = text.split('\n').filter(Boolean);
    const lastUrl = lines[lines.length - 1];
    if (!lastUrl?.startsWith('http')) return false;

    // Fetch the lowest-quality sub-playlist, then HEAD the segment URL it contains.
    const sub = await httpWithRetry(lastUrl, {
      method: 'GET',
      headers: browserHeaders({ 'user-agent': userAgent }),
    });
    if (sub.statusCode !== 200) {
      await sub.dump();
      return false;
    }
    const subText = await sub.bodyText();
    const subLines = subText.split('\n').filter(Boolean);
    const segment = subLines[subLines.length - 1];
    if (!segment?.startsWith('http')) return false;

    const head = await httpWithRetry(segment, {
      method: 'HEAD',
      headers: browserHeaders({ 'user-agent': userAgent }),
    });
    await head.dump();
    return head.statusCode < 400;
  } catch {
    return false;
  }
}

/**
 * Send one minute-watched hit to the spade URL. Returns true on 204 No Content —
 * which is Twitch's success indicator for this event.
 */
export async function sendMinuteWatched(
  spadeUrl: string,
  props: MinuteWatchedProps,
  userAgent: string = pickUserAgent(),
): Promise<boolean> {
  try {
    const body = encodeMinuteWatchedBody(props);
    const res = await httpWithRetry(spadeUrl, {
      method: 'POST',
      headers: browserHeaders({
        'user-agent': userAgent,
        'content-type': 'application/x-www-form-urlencoded',
      }),
      body,
    });
    await res.dump();
    return res.statusCode === 204;
  } catch {
    return false;
  }
}
