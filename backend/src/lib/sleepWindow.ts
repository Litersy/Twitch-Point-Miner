/**
 * Per-account "sleep window": treats the account like a human who is awake
 * only during a configured local-time window, with a per-day randomised jitter
 * applied to the start and the end independently.
 *
 * Each day, for both edges, we draw a magnitude from [jitterFromMin..jitterToMin]
 * and a random sign (+/-). The window therefore stretches or shrinks day to day
 * and the schedule is never identical.
 *
 * The draw is deterministic on (accountId, day, edge), so behaviour stays stable
 * within a given day and we don't need to persist anything.
 */

export type SleepConfig = {
  id: string;                // accountId — used as part of the daily-jitter seed
  sleepEnabled: boolean;
  timezone: string;          // IANA tz, e.g. "Europe/Moscow"
  activeStartMin: number;    // minutes from local midnight (0 .. 1439)
  activeEndMin: number;      // minutes from local midnight (0 .. 1439)
  jitterFromMin: number;     // lower bound of magnitude, in minutes (>= 0)
  jitterToMin: number;       // upper bound of magnitude, in minutes (>= jitterFromMin)
};

/** FNV-1a 32-bit. Cheap, deterministic, no deps. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Daily jitter for one edge of the window. Returns a signed integer in
 * [-jitterToMin, -jitterFromMin] ∪ [jitterFromMin, jitterToMin] minutes
 * (when jitterFromMin > 0 the edge always moves; when it is 0, "no shift"
 * is one possible outcome).
 */
function dailyJitter(seed: string, fromMin: number, toMin: number): number {
  const fr = Math.max(0, Math.floor(fromMin));
  const to = Math.max(fr, Math.floor(toMin));
  if (to <= 0) return 0;
  const h = fnv1a(seed);
  const span = to - fr + 1;        // inclusive [fr..to]
  const magnitude = fr + (h % span);
  // Independent bit for sign so it isn't correlated with magnitude.
  const sign = ((h >>> 17) & 1) === 0 ? -1 : 1;
  return magnitude * sign;
}

/** Get current local "minute-of-day" and YYYY-MM-DD in the given IANA tz. */
function localNow(now: Date, timezone: string): { minute: number; ymd: string } {
  // en-CA gives ISO-style YYYY-MM-DD; hourCycle h23 forces 00..23.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const ymd = `${get('year')}-${get('month')}-${get('day')}`;
  const hour = parseInt(get('hour'), 10) || 0;
  const min = parseInt(get('minute'), 10) || 0;
  return { minute: hour * 60 + min, ymd };
}

function clampMinutes(m: number): number {
  // Wrap into [0, 1439]
  return ((m % 1440) + 1440) % 1440;
}

/** Today's effective active window for a given account (with jitter applied). */
export function todaysWindow(
  cfg: SleepConfig,
  now: Date = new Date(),
): { startMin: number; endMin: number; ymd: string } {
  const { ymd } = localNow(now, safeTz(cfg.timezone));
  const jStart = dailyJitter(`${cfg.id}:${ymd}:start`, cfg.jitterFromMin, cfg.jitterToMin);
  const jEnd = dailyJitter(`${cfg.id}:${ymd}:end`, cfg.jitterFromMin, cfg.jitterToMin);
  return {
    startMin: clampMinutes(cfg.activeStartMin + jStart),
    endMin: clampMinutes(cfg.activeEndMin + jEnd),
    ymd,
  };
}

/** True if the account should be considered "asleep" (outside the active window) right now. */
export function isAccountSleeping(cfg: SleepConfig, now: Date = new Date()): boolean {
  if (!cfg.sleepEnabled) return false;
  const tz = safeTz(cfg.timezone);
  const { minute } = localNow(now, tz);
  const { startMin, endMin } = todaysWindow(cfg, now);

  // start === end → treat as always-active (avoid "always sleep" trap from a misconfig).
  if (startMin === endMin) return false;

  const isActive = startMin < endMin
    ? minute >= startMin && minute < endMin
    : minute >= startMin || minute < endMin; // overnight window (e.g. 22:00 → 06:00)
  return !isActive;
}

function safeTz(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}
