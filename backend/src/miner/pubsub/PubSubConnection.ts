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

// Twitch closes a PubSub socket if it doesn't receive a PING within ~5 min, and
// it answers every client PING with a PONG within a few seconds. We ping a bit
// under that window and, crucially, treat a missing PONG as a dead connection —
// otherwise a silently half-open socket (NAT/router timeout, dropped peer) stays
// "OPEN" forever, emits no 'close', and the miner stops receiving points with no
// way to recover short of a full process restart.
const PING_MIN_MS = 3 * 60_000;
const PING_JITTER_MS = 90_000; // 3:00 – 4:30 between pings
const PONG_TIMEOUT_MS = 12_000;

/**
 * Twitch PubSub client with auto-reconnect, ping/pong liveness, and dead-socket
 * recovery.
 * Listens to topics like:
 *   community-points-user-v1.<user_id>
 *   video-playback-by-id.<channel_id>
 *   raid.<channel_id>
 *   predictions-channel-v1.<channel_id>
 */
export class PubSubConnection {
  private ws?: WebSocket;
  private closed = false;
  private connecting = false;
  private pingTimer?: NodeJS.Timeout;
  private pongTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private topics = new Set<string>();

  constructor(
    private readonly authToken: string,
    private readonly onMessage: Handler,
  ) {}

  async connect(): Promise<void> {
    if (this.closed || this.connecting) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.connecting = true;

    return new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      const ws = new WebSocket(PUBSUB_WS_URL);
      this.ws = ws;

      ws.on('open', () => {
        this.connecting = false;
        this.reconnectAttempts = 0;
        // resubscribe to all known topics
        for (const t of this.topics) this.sendListen(t);
        this.startPing();
        settle();
      });

      ws.on('message', (raw) => {
        // Any inbound traffic proves the socket is alive — clear the pending
        // pong-timeout so liveness isn't tied to PONG alone.
        this.clearPongTimer();
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
        this.connecting = false;
        // Only the socket we currently own should drive a reconnect — a stale
        // socket we already replaced must not schedule its own.
        if (this.ws === ws && !this.closed) this.reconnect('socket closed');
        settle();
      });

      ws.on('error', (err) => {
        logger.warn({ err: err.message }, 'pubsub ws error');
        // 'close' fires after 'error' and drives the reconnect.
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
    const schedule = () => {
      const delay = PING_MIN_MS + Math.floor(Math.random() * PING_JITTER_MS);
      this.pingTimer = setTimeout(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'PING' }));
          // Expect a PONG (or any traffic) back promptly; if none, the socket is
          // silently dead — force a reconnect.
          this.clearPongTimer();
          this.pongTimer = setTimeout(() => this.reconnect('pong timeout'), PONG_TIMEOUT_MS);
        }
        schedule();
      }, delay);
    };
    schedule();
  }

  private clearPongTimer() {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
    }
  }

  private stopPing() {
    if (this.pingTimer) clearTimeout(this.pingTimer);
    this.pingTimer = undefined;
    this.clearPongTimer();
  }

  /** Drop the current socket entirely so it can't keep firing handlers. */
  private teardownSocket() {
    const ws = this.ws;
    if (!ws) return;
    this.ws = undefined;
    ws.removeAllListeners();
    try {
      ws.terminate();
    } catch {
      /* already gone */
    }
  }

  private reconnect(reason: string) {
    if (this.closed) return;
    this.stopPing();
    this.connecting = false;
    this.teardownSocket();
    // Collapse overlapping reconnect triggers (RECONNECT + close + pong timeout)
    // into a single scheduled attempt so we never fan out into many sockets.
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    // Exponential backoff with jitter — never a perfectly-predictable retry.
    const exp = Math.min(60_000, 2_000 * Math.pow(2, this.reconnectAttempts));
    const delay = exp + Math.floor(Math.random() * 2_000);
    logger.info({ reason, delay }, 'pubsub reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect().catch(() => {});
    }, delay);
  }

  close() {
    this.closed = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.teardownSocket();
  }
}
