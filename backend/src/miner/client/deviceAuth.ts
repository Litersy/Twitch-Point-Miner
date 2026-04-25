import { request } from 'undici';
import { CLIENT_ID } from '../constants.js';

const OAUTH_DEVICE_URL = 'https://id.twitch.tv/oauth2/device';
const OAUTH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const ANDROID_TV_UA = 'Mozilla/5.0 (Linux; Android 7.1; Smart Box C1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36';

const SCOPES = 'channel_read chat:read user_blocks_edit user_blocks_read user_follows_edit user_read';

export type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  scope?: string[];
  token_type?: string;
};

function formBody(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function tvHeaders(deviceId: string): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
    'client-id': CLIENT_ID,
    origin: 'https://android.tv.twitch.tv',
    referer: 'https://android.tv.twitch.tv/',
    'user-agent': ANDROID_TV_UA,
    'x-device-id': deviceId,
  };
}

/**
 * Step 1 of OAuth Device Flow: ask Twitch for a device_code + user-facing code.
 * Ported from TwitchLogin.py:login_flow() in the Python miner.
 */
export async function requestDeviceCode(deviceId: string): Promise<DeviceCodeResponse> {
  const res = await request(OAUTH_DEVICE_URL, {
    method: 'POST',
    headers: tvHeaders(deviceId),
    body: formBody({ client_id: CLIENT_ID, scopes: SCOPES }),
  });
  if (res.statusCode !== 200) {
    const text = await res.body.text();
    throw new Error(`device code request failed: ${res.statusCode} ${text.slice(0, 300)}`);
  }
  return (await res.body.json()) as DeviceCodeResponse;
}

export type PollResult =
  | { kind: 'pending' }
  | { kind: 'slow_down' }
  | { kind: 'success'; token: TokenResponse }
  | { kind: 'expired' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

/**
 * Step 2: poll Twitch until user approves the code on twitch.tv/activate,
 * or until the code expires.
 */
export async function pollForToken(deviceCode: string, deviceId: string): Promise<PollResult> {
  const res = await request(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: tvHeaders(deviceId),
    body: formBody({
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  const text = await res.body.text();
  let payload: any = {};
  try {
    payload = JSON.parse(text);
  } catch {
    return { kind: 'error', message: text.slice(0, 300) };
  }

  if (res.statusCode === 200 && payload?.access_token) {
    return { kind: 'success', token: payload };
  }
  // Twitch returns 400 while waiting. The precise discriminator is in `message` or `status`.
  const msg: string = (payload?.message || payload?.error || '').toString().toLowerCase();
  if (msg.includes('authorization_pending') || msg.includes('pending')) return { kind: 'pending' };
  if (msg.includes('slow_down')) return { kind: 'slow_down' };
  if (msg.includes('expired')) return { kind: 'expired' };
  if (msg.includes('denied') || msg.includes('access_denied')) return { kind: 'denied' };

  // some error wording includes "missing" or generic "invalid" while pending — treat as pending
  if (res.statusCode === 400) return { kind: 'pending' };
  return { kind: 'error', message: `${res.statusCode} ${text.slice(0, 200)}` };
}
