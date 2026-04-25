/**
 * "Human-like behaviour" helpers — jitter, exponential backoff, browser-like
 * fingerprints. The goal is to avoid robotic traffic patterns that Twitch's
 * anti-abuse systems can flag (constant-interval polling, instantaneous batch
 * requests, identical headers across sessions, etc.).
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

export function pickUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

/** Uniform integer in [minMs, maxMs]. */
export function rand(minMs: number, maxMs: number): number {
  if (maxMs < minMs) [minMs, maxMs] = [maxMs, minMs];
  return Math.floor(minMs + Math.random() * (maxMs - minMs + 1));
}

export function jitter(minMs: number, maxMs: number): Promise<void> {
  return sleep(rand(minMs, maxMs));
}

/** ~Python's `time.sleep(random.uniform(0.3, 0.7))` from the upstream miner. */
export function microJitter(): Promise<void> {
  return jitter(300, 700);
}

/** Tiny pre-request jitter so concurrent requests don't fire on the exact same tick. */
export function preRequestJitter(): Promise<void> {
  return jitter(50, 350);
}

/** Roll the dice. */
export function chance(p: number): boolean {
  return Math.random() < p;
}

/** Standard set of headers a real browser tab sends to twitch.tv. */
export function browserHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'origin': 'https://www.twitch.tv',
    'referer': 'https://www.twitch.tv/',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    ...extra,
  };
}

export type RetryableResult = { statusCode: number; headers: Record<string, string | string[] | undefined> };

/** Decide whether an HTTP response should be retried, and after how long. */
export function retryDelayForResponse(
  res: RetryableResult,
  attempt: number,
  baseMs = 800,
  capMs = 60_000,
): number | null {
  const code = res.statusCode;
  const retryable = code === 408 || code === 425 || code === 429 || (code >= 500 && code < 600);
  if (!retryable) return null;

  const ra = res.headers['retry-after'];
  const raStr = Array.isArray(ra) ? ra[0] : ra;
  const retryAfterSec = raStr ? Number(raStr) : NaN;
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return Math.min(capMs, retryAfterSec * 1000) + rand(0, 500);
  }

  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return exp + rand(0, 500);
}
