import { request } from 'undici';
import { USER_AGENT, TWITCH_URL } from '../constants.js';

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

export async function fetchSpadeUrl(login: string): Promise<string | null> {
  try {
    const page = await request(`${TWITCH_URL}/${login}`, {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT },
      bodyTimeout: 20_000,
      headersTimeout: 20_000,
    });
    const html = await page.body.text();
    const settingsMatch = html.match(SETTINGS_RE);
    if (!settingsMatch) return null;
    const settingsUrl = settingsMatch[1];

    const settings = await request(settingsUrl, {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT },
      bodyTimeout: 20_000,
      headersTimeout: 20_000,
    });
    const js = await settings.body.text();
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
): Promise<boolean> {
  try {
    const hlsUrl = `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?sig=${playback.signature}&token=${encodeURIComponent(
      playback.value,
    )}`;
    const hls = await request(hlsUrl, {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT },
      bodyTimeout: 20_000,
      headersTimeout: 20_000,
    });
    if (hls.statusCode !== 200) return false;
    const text = await hls.body.text();
    const lines = text.split('\n').filter(Boolean);
    const lastUrl = lines[lines.length - 1];
    if (!lastUrl?.startsWith('http')) return false;

    // Fetch the lowest-quality sub-playlist, then HEAD the segment URL it contains.
    const sub = await request(lastUrl, {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT },
      bodyTimeout: 20_000,
      headersTimeout: 20_000,
    });
    if (sub.statusCode !== 200) return false;
    const subText = await sub.body.text();
    const subLines = subText.split('\n').filter(Boolean);
    const segment = subLines[subLines.length - 1];
    if (!segment?.startsWith('http')) return false;

    const head = await request(segment, {
      method: 'HEAD',
      headers: { 'user-agent': USER_AGENT },
      bodyTimeout: 20_000,
      headersTimeout: 20_000,
    });
    await head.body.dump();
    return head.statusCode < 400;
  } catch {
    return false;
  }
}

/**
 * Send one minute-watched hit to the spade URL. Returns true on 204 No Content —
 * which is Twitch's success indicator for this event.
 */
export async function sendMinuteWatched(spadeUrl: string, props: MinuteWatchedProps): Promise<boolean> {
  try {
    const body = encodeMinuteWatchedBody(props);
    const res = await request(spadeUrl, {
      method: 'POST',
      headers: {
        'user-agent': USER_AGENT,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      bodyTimeout: 20_000,
      headersTimeout: 20_000,
    });
    await res.body.dump();
    return res.statusCode === 204;
  } catch {
    return false;
  }
}
