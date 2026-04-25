import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';
import { PUBSUB_WS_URL } from '../constants.js';
import { logger } from '../../lib/logger.js';

export type PubSubMessage = {
  type: string;
  data?: {
    topic: string;
    message: string; // inner JSON
  };
  nonce?: string;
  error?: string;
};

type Handler = (topic: string, payload: any) => void;

/**
 * Twitch PubSub client with auto-reconnect and ping loop.
 * Listens to topics like:
 *   community-points-user-v1.<user_id>
 *   video-playback-by-id.<channel_id>
 *   raid.<channel_id>
 *   predictions-channel-v1.<channel_id>
 */
export class PubSubConnection {
  private ws?: WebSocket;
  private closed = false;
  private pingTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private topics = new Set<string>();

  constructor(
    private readonly authToken: string,
    private readonly onMessage: Handler,
  ) {}

  async connect(): Promise<void> {
    if (this.closed) return;
    return new Promise((resolve) => {
      const ws = new WebSocket(PUBSUB_WS_URL);
      this.ws = ws;

      ws.on('open', () => {
        this.reconnectAttempts = 0;
        // resubscribe to all known topics
        for (const t of this.topics) this.sendListen(t);
        this.startPing();
        resolve();
      });

      ws.on('message', (raw) => {
        try {
          const parsed: PubSubMessage = JSON.parse(raw.toString());
          if (parsed.type === 'PONG') return;
          if (parsed.type === 'RECONNECT') {
            this.reconnect('server asked to reconnect');
            return;
          }
          if (parsed.type === 'MESSAGE' && parsed.data) {
            const inner = JSON.parse(parsed.data.message);
            this.onMessage(parsed.data.topic, inner);
          }
        } catch (err) {
          logger.warn({ err }, 'pubsub parse error');
        }
      });

      ws.on('close', () => {
        this.stopPing();
        if (!this.closed) this.reconnect('socket closed');
      });

      ws.on('error', (err) => {
        logger.warn({ err: err.message }, 'pubsub ws error');
      });
    });
  }

  listen(topic: string) {
    this.topics.add(topic);
    if (this.ws?.readyState === WebSocket.OPEN) this.sendListen(topic);
  }

  unlisten(topic: string) {
    this.topics.delete(topic);
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: 'UNLISTEN',
        nonce: randomBytes(8).toString('hex'),
        data: { topics: [topic] },
      }),
    );
  }

  private sendListen(topic: string) {
    this.ws?.send(
      JSON.stringify({
        type: 'LISTEN',
        nonce: randomBytes(8).toString('hex'),
        data: { topics: [topic], auth_token: this.authToken },
      }),
    );
  }

  private startPing() {
    this.stopPing();
    // Twitch requires a PING within 5 minutes; the official web client sends one
    // roughly every 4 minutes with jitter. We do the same so every account on
    // the same panel doesn't ping in lockstep.
    const schedule = () => {
      const delay = 3 * 60_000 + Math.floor(Math.random() * 90_000); // 3:00 – 4:30
      this.pingTimer = setTimeout(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'PING' }));
        }
        schedule();
      }, delay);
    };
    schedule();
  }

  private stopPing() {
    if (this.pingTimer) clearTimeout(this.pingTimer);
    this.pingTimer = undefined;
  }

  private reconnect(reason: string) {
    this.stopPing();
    this.reconnectAttempts++;
    // Exponential backoff with jitter — never a perfectly-predictable retry.
    const exp = Math.min(60_000, 2_000 * Math.pow(2, this.reconnectAttempts));
    const delay = exp + Math.floor(Math.random() * 2_000);
    logger.info({ reason, delay }, 'pubsub reconnecting');
    setTimeout(() => this.connect().catch(() => {}), delay);
  }

  close() {
    this.closed = true;
    this.stopPing();
    this.ws?.close();
  }
}
